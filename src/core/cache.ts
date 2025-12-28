import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'cache' });

interface CacheEntry {
  id: string;
  cacheKey: string;
  cacheType: 'tool' | 'resource' | 'prompt';
  serverId: string;
  requestHash: string;
  responseJson: string;
  hitCount: number;
  ttlSeconds: number;
  expiresAt: number;
  createdAt: Date;
  lastHitAt: Date | null;
}

interface CacheOptions {
  ttl?: number; // TTL in seconds, default 300 (5 minutes)
}

interface CacheStats {
  memorySize: number;
  memoryHits: number;
  memoryMisses: number;
  dbHits: number;
  dbMisses: number;
  totalEntries: number;
  hitRate: number;
}

/**
 * Two-tier cache implementation:
 * - Tier 1: In-memory LRU cache (1000 entries) for hot data
 * - Tier 2: SQLite persistence for overflow and cold data
 */
export class ResponseCache {
  private db: Database.Database;
  private memoryCache: Map<string, { data: unknown; expiresAt: number }>;
  private lruOrder: string[]; // Tracks access order for LRU eviction
  private readonly maxMemoryEntries = 1000;
  private cleanupInterval: NodeJS.Timeout;
  private stats = {
    memoryHits: 0,
    memoryMisses: 0,
    dbHits: 0,
    dbMisses: 0,
  };

  constructor(db: Database.Database) {
    this.db = db;
    this.memoryCache = new Map();
    this.lruOrder = [];

    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);

    logger.info('Response cache initialized');
  }

  /**
   * Get cached response
   */
  async get(
    type: 'tool' | 'resource' | 'prompt',
    serverId: string,
    name: string,
    params?: Record<string, unknown>
  ): Promise<unknown | null> {
    const cacheKey = this.generateCacheKey(type, serverId, name, params);
    const now = Date.now();

    // Check memory cache first (Tier 1)
    const memoryEntry = this.memoryCache.get(cacheKey);
    if (memoryEntry && memoryEntry.expiresAt > now) {
      this.stats.memoryHits++;
      this.updateLRU(cacheKey);
      logger.debug({ cacheKey, type }, 'Memory cache hit');
      return memoryEntry.data;
    }

    this.stats.memoryMisses++;

    // Check database cache (Tier 2)
    const dbEntry = this.getFromDb(cacheKey);
    if (dbEntry && dbEntry.expiresAt > now) {
      this.stats.dbHits++;

      // Promote to memory cache
      const data = JSON.parse(dbEntry.responseJson);
      this.setInMemory(cacheKey, data, dbEntry.expiresAt);

      // Update hit count and last hit time in DB
      this.updateHitStats(dbEntry.id);

      logger.debug({ cacheKey, type }, 'Database cache hit (promoted to memory)');
      return data;
    }

    this.stats.dbMisses++;
    logger.debug({ cacheKey, type }, 'Cache miss');
    return null;
  }

  /**
   * Set cache entry
   */
  async set(
    type: 'tool' | 'resource' | 'prompt',
    serverId: string,
    name: string,
    data: unknown,
    params?: Record<string, unknown>,
    options: CacheOptions = {}
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(type, serverId, name, params);
    const ttl = options.ttl || 300; // Default 5 minutes
    const expiresAt = Date.now() + ttl * 1000;

    // Store in memory cache
    this.setInMemory(cacheKey, data, expiresAt);

    // Store in database for persistence
    const requestHash = this.hashParams(params);
    const entry: Omit<CacheEntry, 'id' | 'createdAt' | 'lastHitAt'> = {
      cacheKey,
      cacheType: type,
      serverId,
      requestHash,
      responseJson: JSON.stringify(data),
      hitCount: 0,
      ttlSeconds: ttl,
      expiresAt,
    };

    this.saveToDb(entry);

    logger.debug({ cacheKey, type, ttl }, 'Cache entry stored');
  }

  /**
   * Invalidate cache entries
   */
  async invalidate(options: {
    serverId?: string;
    type?: 'tool' | 'resource' | 'prompt';
    name?: string;
  }): Promise<number> {
    let deletedCount = 0;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.serverId) {
      conditions.push('server_id = ?');
      params.push(options.serverId);
    }

    if (options.type) {
      conditions.push('cache_type = ?');
      params.push(options.type);
    }

    if (options.name) {
      // Cache key contains the name, so use LIKE
      conditions.push('cache_key LIKE ?');
      params.push(`%:${options.name}:%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Delete from database
    const stmt = this.db.prepare(`DELETE FROM response_cache ${whereClause}`);
    const result = stmt.run(...params);
    deletedCount = result.changes;

    // Clear memory cache (simple approach: clear all since we can't easily filter)
    if (deletedCount > 0) {
      this.memoryCache.clear();
      this.lruOrder = [];
    }

    logger.info({ deletedCount, options }, 'Cache invalidated');
    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests =
      this.stats.memoryHits + this.stats.memoryMisses + this.stats.dbHits + this.stats.dbMisses;

    const totalHits = this.stats.memoryHits + this.stats.dbHits;
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM response_cache');
    const { count } = countStmt.get() as { count: number };

    return {
      memorySize: this.memoryCache.size,
      memoryHits: this.stats.memoryHits,
      memoryMisses: this.stats.memoryMisses,
      dbHits: this.stats.dbHits,
      dbMisses: this.stats.dbMisses,
      totalEntries: count,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();

    // Cleanup memory cache
    let expiredMemory = 0;
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryCache.delete(key);
        this.lruOrder = this.lruOrder.filter((k) => k !== key);
        expiredMemory++;
      }
    }

    // Cleanup database
    const stmt = this.db.prepare('DELETE FROM response_cache WHERE expires_at <= ?');
    const result = stmt.run(now);
    const expiredDb = result.changes;

    if (expiredMemory > 0 || expiredDb > 0) {
      logger.info({ expiredMemory, expiredDb }, 'Cleaned up expired cache entries');
    }
  }

  /**
   * Shutdown - cleanup interval
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
    this.cleanup();
    logger.info('Response cache shutdown complete');
  }

  /**
   * Generate cache key from request parameters
   */
  private generateCacheKey(
    type: 'tool' | 'resource' | 'prompt',
    serverId: string,
    name: string,
    params?: Record<string, unknown>
  ): string {
    const paramsHash = this.hashParams(params);
    return `${type}:${serverId}:${name}:${paramsHash}`;
  }

  /**
   * Hash parameters for cache key
   */
  private hashParams(params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return 'none';
    }

    // Sort keys for consistent hashing
    const sorted = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {} as Record<string, unknown>);

    const hash = createHash('sha256');
    hash.update(JSON.stringify(sorted));
    return hash.digest('hex').substring(0, 16); // Use first 16 chars
  }

  /**
   * Store in memory cache with LRU eviction
   */
  private setInMemory(cacheKey: string, data: unknown, expiresAt: number): void {
    // Update existing entry
    if (this.memoryCache.has(cacheKey)) {
      this.memoryCache.set(cacheKey, { data, expiresAt });
      this.updateLRU(cacheKey);
      return;
    }

    // Evict oldest entry if at capacity
    if (this.memoryCache.size >= this.maxMemoryEntries) {
      const oldestKey = this.lruOrder.shift();
      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    // Add new entry
    this.memoryCache.set(cacheKey, { data, expiresAt });
    this.lruOrder.push(cacheKey);
  }

  /**
   * Update LRU order on access
   */
  private updateLRU(cacheKey: string): void {
    this.lruOrder = this.lruOrder.filter((k) => k !== cacheKey);
    this.lruOrder.push(cacheKey);
  }

  /**
   * Get entry from database
   */
  private getFromDb(cacheKey: string): CacheEntry | null {
    const stmt = this.db.prepare('SELECT * FROM response_cache WHERE cache_key = ?');
    const row = stmt.get(cacheKey) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      cacheKey: row.cache_key as string,
      cacheType: row.cache_type as 'tool' | 'resource' | 'prompt',
      serverId: row.server_id as string,
      requestHash: row.request_hash as string,
      responseJson: row.response_json as string,
      hitCount: row.hit_count as number,
      ttlSeconds: row.ttl_seconds as number,
      expiresAt: row.expires_at as number,
      createdAt: new Date(row.created_at as string),
      lastHitAt: row.last_hit_at ? new Date(row.last_hit_at as string) : null,
    };
  }

  /**
   * Save entry to database
   */
  private saveToDb(entry: Omit<CacheEntry, 'id' | 'createdAt' | 'lastHitAt'>): void {
    const id = uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO response_cache (
        id, cache_key, cache_type, server_id, request_hash,
        response_json, hit_count, ttl_seconds, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        response_json = excluded.response_json,
        expires_at = excluded.expires_at,
        ttl_seconds = excluded.ttl_seconds
    `);

    stmt.run(
      id,
      entry.cacheKey,
      entry.cacheType,
      entry.serverId,
      entry.requestHash,
      entry.responseJson,
      entry.hitCount,
      entry.ttlSeconds,
      entry.expiresAt
    );
  }

  /**
   * Update hit statistics in database
   */
  private updateHitStats(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE response_cache
      SET hit_count = hit_count + 1,
          last_hit_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(id);
  }
}
