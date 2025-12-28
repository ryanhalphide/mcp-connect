import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../observability/logger.js';
import type { MCPServerConfig } from './types.js';

const logger = createChildLogger({ module: 'rateLimiter' });

interface RateLimitConfig {
  perMinute: number;
  perDay: number;
}

interface RateLimitState {
  id: string;
  apiKeyId: string;
  serverId: string | null;
  minuteCount: number;
  minuteResetAt: number;
  dayCount: number;
  dayResetAt: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RateLimitResult {
  allowed: boolean;
  minuteRemaining: number;
  minuteResetAt: number;
  dayRemaining: number;
  dayResetAt: number;
}

export class EnhancedRateLimiter {
  private db: Database.Database;
  private pendingWrites: Map<string, RateLimitState>;
  private flushInterval: NodeJS.Timeout;
  private defaultConfig: RateLimitConfig;

  constructor(
    db: Database.Database,
    defaultConfig: RateLimitConfig = { perMinute: 60, perDay: 1000 }
  ) {
    this.db = db;
    this.defaultConfig = defaultConfig;
    this.pendingWrites = new Map();

    // Flush pending writes every 5 seconds to reduce DB load
    this.flushInterval = setInterval(() => this.flush(), 5000);

    logger.info({ defaultConfig }, 'Enhanced rate limiter initialized');
  }

  /**
   * Check if a request is allowed under rate limits
   * @param apiKeyId - API key making the request
   * @param serverId - Server being accessed (null for global limit)
   * @param config - Custom rate limit config (overrides default)
   */
  checkLimit(
    apiKeyId: string,
    serverId: string | null,
    config?: RateLimitConfig
  ): RateLimitResult {
    const limits = config || this.defaultConfig;
    const stateKey = this.getStateKey(apiKeyId, serverId);

    // Get current state (from pending writes or DB)
    let state = this.pendingWrites.get(stateKey) || this.loadState(apiKeyId, serverId);

    if (!state) {
      // Create new state
      state = this.createState(apiKeyId, serverId);
    }

    const now = Date.now();

    // Reset minute counter if window expired
    if (now >= state.minuteResetAt) {
      state.minuteCount = 0;
      state.minuteResetAt = now + 60 * 1000; // 1 minute from now
    }

    // Reset day counter if window expired
    if (now >= state.dayResetAt) {
      state.dayCount = 0;
      state.dayResetAt = now + 24 * 60 * 60 * 1000; // 24 hours from now
    }

    // Check if limits exceeded
    const allowed = state.minuteCount < limits.perMinute && state.dayCount < limits.perDay;

    if (allowed) {
      // Increment counters
      state.minuteCount++;
      state.dayCount++;
      state.updatedAt = new Date();

      // Queue for batched write
      this.pendingWrites.set(stateKey, state);
    }

    return {
      allowed,
      minuteRemaining: Math.max(0, limits.perMinute - state.minuteCount),
      minuteResetAt: state.minuteResetAt,
      dayRemaining: Math.max(0, limits.perDay - state.dayCount),
      dayResetAt: state.dayResetAt,
    };
  }

  /**
   * Reset rate limits for an API key (useful for testing or admin overrides)
   */
  resetLimits(apiKeyId: string, serverId: string | null = null): void {
    const stateKey = this.getStateKey(apiKeyId, serverId);

    // Remove from pending writes
    this.pendingWrites.delete(stateKey);

    // Delete from DB
    const stmt = serverId
      ? this.db.prepare('DELETE FROM rate_limit_state WHERE api_key_id = ? AND server_id = ?')
      : this.db.prepare('DELETE FROM rate_limit_state WHERE api_key_id = ? AND server_id IS NULL');

    serverId ? stmt.run(apiKeyId, serverId) : stmt.run(apiKeyId);

    logger.info({ apiKeyId, serverId }, 'Rate limits reset');
  }

  /**
   * Get current rate limit state for an API key
   */
  getState(apiKeyId: string, serverId: string | null = null): RateLimitState | null {
    const stateKey = this.getStateKey(apiKeyId, serverId);
    return this.pendingWrites.get(stateKey) || this.loadState(apiKeyId, serverId);
  }

  /**
   * Flush pending writes to database
   */
  flush(): void {
    if (this.pendingWrites.size === 0) {
      return;
    }

    const states = Array.from(this.pendingWrites.values());

    try {
      const upsertStmt = this.db.prepare(`
        INSERT INTO rate_limit_state (
          id, api_key_id, server_id, minute_count, minute_reset_at,
          day_count, day_reset_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          minute_count = excluded.minute_count,
          minute_reset_at = excluded.minute_reset_at,
          day_count = excluded.day_count,
          day_reset_at = excluded.day_reset_at,
          updated_at = excluded.updated_at
      `);

      const transaction = this.db.transaction((states: RateLimitState[]) => {
        for (const state of states) {
          upsertStmt.run(
            state.id,
            state.apiKeyId,
            state.serverId,
            state.minuteCount,
            state.minuteResetAt,
            state.dayCount,
            state.dayResetAt,
            state.createdAt.toISOString(),
            state.updatedAt.toISOString()
          );
        }
      });

      transaction(states);

      logger.debug({ count: states.length }, 'Rate limit states flushed to DB');

      // Clear pending writes
      this.pendingWrites.clear();
    } catch (error) {
      logger.error({ error }, 'Failed to flush rate limit states');
    }
  }

  /**
   * Cleanup method - flush pending writes and stop interval
   */
  shutdown(): void {
    clearInterval(this.flushInterval);
    this.flush();
    logger.info('Enhanced rate limiter shutdown complete');
  }

  private getStateKey(apiKeyId: string, serverId: string | null): string {
    return serverId ? `${apiKeyId}:${serverId}` : `${apiKeyId}:global`;
  }

  private loadState(apiKeyId: string, serverId: string | null): RateLimitState | null {
    const stmt = serverId
      ? this.db.prepare('SELECT * FROM rate_limit_state WHERE api_key_id = ? AND server_id = ?')
      : this.db.prepare('SELECT * FROM rate_limit_state WHERE api_key_id = ? AND server_id IS NULL');

    const row = (serverId ? stmt.get(apiKeyId, serverId) : stmt.get(apiKeyId)) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      apiKeyId: row.api_key_id as string,
      serverId: row.server_id as string | null,
      minuteCount: row.minute_count as number,
      minuteResetAt: row.minute_reset_at as number,
      dayCount: row.day_count as number,
      dayResetAt: row.day_reset_at as number,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private createState(apiKeyId: string, serverId: string | null): RateLimitState {
    const now = Date.now();

    return {
      id: uuidv4(),
      apiKeyId,
      serverId,
      minuteCount: 0,
      minuteResetAt: now + 60 * 1000,
      dayCount: 0,
      dayResetAt: now + 24 * 60 * 60 * 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

/**
 * Helper function to get rate limit config for a server
 */
export function getServerRateLimitConfig(server: MCPServerConfig): RateLimitConfig {
  return {
    perMinute: server.rateLimits.requestsPerMinute,
    perDay: server.rateLimits.requestsPerDay,
  };
}
