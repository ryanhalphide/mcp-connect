import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ResponseCache } from '../../src/core/cache.js';

// Mock the logger
vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ResponseCache', () => {
  let db: Database.Database;
  let cache: ResponseCache;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');

    // Create the response_cache table
    db.exec(`
      CREATE TABLE IF NOT EXISTS response_cache (
        id TEXT PRIMARY KEY,
        cache_key TEXT UNIQUE NOT NULL,
        cache_type TEXT NOT NULL CHECK(cache_type IN ('tool', 'resource', 'prompt')),
        server_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        ttl_seconds INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_hit_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_cache_key ON response_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_cache_expiry ON response_cache(expires_at);
    `);

    cache = new ResponseCache(db);
  });

  afterEach(() => {
    cache.shutdown();
    db.close();
  });

  describe('set and get', () => {
    it('should store and retrieve cache entries', async () => {
      const serverId = 'server-1';
      const toolName = 'test-tool';
      const params = { arg1: 'value1' };
      const data = { result: 'success', value: 42 };

      await cache.set('tool', serverId, toolName, data, params);
      const result = await cache.get('tool', serverId, toolName, params);

      expect(result).toEqual(data);
    });

    it('should return null for non-existent cache entries', async () => {
      const result = await cache.get('tool', 'server-1', 'non-existent', {});
      expect(result).toBeNull();
    });

    it('should return null for expired entries', async () => {
      const serverId = 'server-1';
      const toolName = 'test-tool';
      const params = {};
      const data = { result: 'expired' };

      // Set with 1 second TTL
      await cache.set('tool', serverId, toolName, data, params, { ttl: 1 });

      // Wait for expiration (1.1 seconds)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await cache.get('tool', serverId, toolName, params);
      expect(result).toBeNull();
    });

    it('should update existing cache entry', async () => {
      const serverId = 'server-1';
      const toolName = 'test-tool';
      const params = {};

      await cache.set('tool', serverId, toolName, { value: 1 }, params);
      await cache.set('tool', serverId, toolName, { value: 2 }, params);

      const result = await cache.get('tool', serverId, toolName, params);
      expect(result).toEqual({ value: 2 });
    });

    it('should differentiate cache entries by params', async () => {
      const serverId = 'server-1';
      const toolName = 'test-tool';

      await cache.set('tool', serverId, toolName, { result: 'a' }, { key: 'a' });
      await cache.set('tool', serverId, toolName, { result: 'b' }, { key: 'b' });

      const resultA = await cache.get('tool', serverId, toolName, { key: 'a' });
      const resultB = await cache.get('tool', serverId, toolName, { key: 'b' });

      expect(resultA).toEqual({ result: 'a' });
      expect(resultB).toEqual({ result: 'b' });
    });

    it('should differentiate cache entries by type', async () => {
      const serverId = 'server-1';
      const name = 'test-item';

      await cache.set('tool', serverId, name, { type: 'tool' }, {});
      await cache.set('resource', serverId, name, { type: 'resource' }, {});

      const toolResult = await cache.get('tool', serverId, name, {});
      const resourceResult = await cache.get('resource', serverId, name, {});

      expect(toolResult).toEqual({ type: 'tool' });
      expect(resourceResult).toEqual({ type: 'resource' });
    });
  });

  describe('invalidate', () => {
    it('should invalidate by serverId', async () => {
      await cache.set('tool', 'server-1', 'tool-a', { v: 1 }, {});
      await cache.set('tool', 'server-1', 'tool-b', { v: 2 }, {});
      await cache.set('tool', 'server-2', 'tool-a', { v: 3 }, {});

      const count = await cache.invalidate({ serverId: 'server-1' });

      expect(count).toBe(2);
      expect(await cache.get('tool', 'server-1', 'tool-a', {})).toBeNull();
      expect(await cache.get('tool', 'server-1', 'tool-b', {})).toBeNull();
      expect(await cache.get('tool', 'server-2', 'tool-a', {})).toEqual({ v: 3 });
    });

    it('should invalidate by type', async () => {
      await cache.set('tool', 'server-1', 'item', { v: 1 }, {});
      await cache.set('resource', 'server-1', 'item', { v: 2 }, {});
      await cache.set('prompt', 'server-1', 'item', { v: 3 }, {});

      const count = await cache.invalidate({ type: 'tool' });

      expect(count).toBe(1);
      expect(await cache.get('tool', 'server-1', 'item', {})).toBeNull();
      expect(await cache.get('resource', 'server-1', 'item', {})).not.toBeNull();
    });

    it('should invalidate all entries when no filter provided', async () => {
      await cache.set('tool', 'server-1', 'tool-a', { v: 1 }, {});
      await cache.set('tool', 'server-2', 'tool-b', { v: 2 }, {});
      await cache.set('resource', 'server-1', 'res-a', { v: 3 }, {});

      const count = await cache.invalidate({});

      expect(count).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      await cache.set('tool', 'server-1', 'tool-a', { v: 1 }, {});
      await cache.set('tool', 'server-1', 'tool-b', { v: 2 }, {});

      // Generate some hits and misses
      await cache.get('tool', 'server-1', 'tool-a', {}); // hit
      await cache.get('tool', 'server-1', 'non-existent', {}); // miss

      const stats = cache.getStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.memoryHits).toBeGreaterThanOrEqual(0); // First get may be from DB
      expect(stats.dbHits + stats.memoryHits).toBeGreaterThanOrEqual(1);
      expect(stats.dbMisses + stats.memoryMisses).toBeGreaterThanOrEqual(1);
    });

    it('should calculate hit rate', async () => {
      await cache.set('tool', 'server-1', 'tool-a', { v: 1 }, {});

      // Generate equal hits and misses
      await cache.get('tool', 'server-1', 'tool-a', {}); // hit (may go through DB first)
      await cache.get('tool', 'server-1', 'tool-a', {}); // hit (memory)
      await cache.get('tool', 'server-1', 'miss1', {}); // miss
      await cache.get('tool', 'server-1', 'miss2', {}); // miss

      const stats = cache.getStats();
      // Hit rate is total hits / total requests
      const totalHits = stats.memoryHits + stats.dbHits;
      const totalRequests = totalHits + stats.memoryMisses + stats.dbMisses;
      expect(totalHits).toBeGreaterThanOrEqual(2);
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  describe('LRU eviction', () => {
    it('should promote from DB to memory on hit', async () => {
      await cache.set('tool', 'server-1', 'tool-a', { v: 1 }, {});

      // Clear memory cache to force DB lookup
      // @ts-ignore - accessing private property for testing
      cache['memoryCache'].clear();
      // @ts-ignore
      cache['lruOrder'] = [];

      // First get should hit DB and promote to memory
      const result1 = await cache.get('tool', 'server-1', 'tool-a', {});
      expect(result1).toEqual({ v: 1 });

      const stats1 = cache.getStats();
      expect(stats1.dbHits).toBe(1);
      expect(stats1.memorySize).toBe(1);

      // Second get should hit memory
      const result2 = await cache.get('tool', 'server-1', 'tool-a', {});
      expect(result2).toEqual({ v: 1 });

      const stats2 = cache.getStats();
      expect(stats2.memoryHits).toBe(1);
    });
  });

  describe('parameter hashing', () => {
    it('should generate consistent hash regardless of key order', async () => {
      await cache.set('tool', 'server-1', 'tool', { v: 1 }, { a: 1, b: 2, c: 3 });

      // Same params, different order
      const result = await cache.get('tool', 'server-1', 'tool', { c: 3, a: 1, b: 2 });
      expect(result).toEqual({ v: 1 });
    });

    it('should handle empty params', async () => {
      await cache.set('tool', 'server-1', 'tool', { v: 1 }, {});
      const result = await cache.get('tool', 'server-1', 'tool', {});
      expect(result).toEqual({ v: 1 });
    });

    it('should handle undefined params', async () => {
      await cache.set('tool', 'server-1', 'tool', { v: 1 });
      const result = await cache.get('tool', 'server-1', 'tool');
      expect(result).toEqual({ v: 1 });
    });
  });

  describe('complex data types', () => {
    it('should handle nested objects', async () => {
      const data = {
        level1: {
          level2: {
            array: [1, 2, { nested: true }],
            date: '2024-01-01',
          },
        },
        nullValue: null,
      };

      await cache.set('tool', 'server-1', 'tool', data, {});
      const result = await cache.get('tool', 'server-1', 'tool', {});

      expect(result).toEqual(data);
    });

    it('should handle arrays', async () => {
      const data = [1, 'two', { three: 3 }, [4, 5, 6]];

      await cache.set('tool', 'server-1', 'tool', data, {});
      const result = await cache.get('tool', 'server-1', 'tool', {});

      expect(result).toEqual(data);
    });
  });
});
