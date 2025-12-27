import type { RateLimitConfig } from './types.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'rate-limiter' });

interface RateLimitState {
  minuteCount: number;
  minuteResetAt: number;
  dayCount: number;
  dayResetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: {
    perMinute: number;
    perDay: number;
  };
  resetAt: {
    minute: Date;
    day: Date;
  };
  retryAfterMs?: number;
}

export class RateLimiter {
  private state: Map<string, RateLimitState> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();

  /**
   * Register rate limit config for a server
   */
  register(serverId: string, config: RateLimitConfig): void {
    this.configs.set(serverId, config);
    logger.debug(
      { serverId, requestsPerMinute: config.requestsPerMinute, requestsPerDay: config.requestsPerDay },
      'Rate limit config registered'
    );
  }

  /**
   * Unregister a server (clears its rate limit state)
   */
  unregister(serverId: string): void {
    this.state.delete(serverId);
    this.configs.delete(serverId);
    logger.debug({ serverId }, 'Rate limit config unregistered');
  }

  /**
   * Check if a request is allowed and consume a token if so
   */
  consume(serverId: string): RateLimitResult {
    const config = this.configs.get(serverId);
    if (!config) {
      // No config means no rate limiting
      return {
        allowed: true,
        remaining: { perMinute: Infinity, perDay: Infinity },
        resetAt: { minute: new Date(), day: new Date() },
      };
    }

    const now = Date.now();
    let state = this.state.get(serverId);

    // Initialize or reset state as needed
    if (!state) {
      state = this.createInitialState(now);
      this.state.set(serverId, state);
    } else {
      state = this.maybeResetCounters(state, now);
    }

    // Check limits
    const minuteExceeded = config.requestsPerMinute > 0 && state.minuteCount >= config.requestsPerMinute;
    const dayExceeded = config.requestsPerDay > 0 && state.dayCount >= config.requestsPerDay;

    if (minuteExceeded || dayExceeded) {
      const retryAfterMs = minuteExceeded
        ? state.minuteResetAt - now
        : state.dayResetAt - now;

      logger.warn(
        {
          serverId,
          minuteCount: state.minuteCount,
          dayCount: state.dayCount,
          minuteExceeded,
          dayExceeded,
        },
        'Rate limit exceeded'
      );

      return {
        allowed: false,
        remaining: {
          perMinute: Math.max(0, config.requestsPerMinute - state.minuteCount),
          perDay: Math.max(0, config.requestsPerDay - state.dayCount),
        },
        resetAt: {
          minute: new Date(state.minuteResetAt),
          day: new Date(state.dayResetAt),
        },
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Consume token
    state.minuteCount++;
    state.dayCount++;

    logger.debug(
      {
        serverId,
        minuteCount: state.minuteCount,
        dayCount: state.dayCount,
        remainingPerMinute: config.requestsPerMinute - state.minuteCount,
        remainingPerDay: config.requestsPerDay - state.dayCount,
      },
      'Rate limit token consumed'
    );

    return {
      allowed: true,
      remaining: {
        perMinute: Math.max(0, config.requestsPerMinute - state.minuteCount),
        perDay: Math.max(0, config.requestsPerDay - state.dayCount),
      },
      resetAt: {
        minute: new Date(state.minuteResetAt),
        day: new Date(state.dayResetAt),
      },
    };
  }

  /**
   * Check rate limit status without consuming a token
   */
  check(serverId: string): RateLimitResult {
    const config = this.configs.get(serverId);
    if (!config) {
      return {
        allowed: true,
        remaining: { perMinute: Infinity, perDay: Infinity },
        resetAt: { minute: new Date(), day: new Date() },
      };
    }

    const now = Date.now();
    let state = this.state.get(serverId);

    if (!state) {
      return {
        allowed: true,
        remaining: {
          perMinute: config.requestsPerMinute,
          perDay: config.requestsPerDay,
        },
        resetAt: {
          minute: new Date(now + 60000),
          day: new Date(this.getEndOfDay(now)),
        },
      };
    }

    state = this.maybeResetCounters(state, now);

    const minuteExceeded = config.requestsPerMinute > 0 && state.minuteCount >= config.requestsPerMinute;
    const dayExceeded = config.requestsPerDay > 0 && state.dayCount >= config.requestsPerDay;

    return {
      allowed: !minuteExceeded && !dayExceeded,
      remaining: {
        perMinute: Math.max(0, config.requestsPerMinute - state.minuteCount),
        perDay: Math.max(0, config.requestsPerDay - state.dayCount),
      },
      resetAt: {
        minute: new Date(state.minuteResetAt),
        day: new Date(state.dayResetAt),
      },
      retryAfterMs: minuteExceeded || dayExceeded
        ? Math.max(0, (minuteExceeded ? state.minuteResetAt : state.dayResetAt) - now)
        : undefined,
    };
  }

  /**
   * Get rate limit status for a server
   */
  getStatus(serverId: string): {
    config: RateLimitConfig | undefined;
    current: { minuteCount: number; dayCount: number } | undefined;
  } {
    return {
      config: this.configs.get(serverId),
      current: this.state.get(serverId)
        ? {
            minuteCount: this.state.get(serverId)!.minuteCount,
            dayCount: this.state.get(serverId)!.dayCount,
          }
        : undefined,
    };
  }

  /**
   * Reset rate limit counters for a server
   */
  reset(serverId: string): void {
    this.state.delete(serverId);
    logger.info({ serverId }, 'Rate limit counters reset');
  }

  /**
   * Reset all rate limit counters
   */
  resetAll(): void {
    this.state.clear();
    logger.info('All rate limit counters reset');
  }

  private createInitialState(now: number): RateLimitState {
    return {
      minuteCount: 0,
      minuteResetAt: now + 60000, // 1 minute from now
      dayCount: 0,
      dayResetAt: this.getEndOfDay(now),
    };
  }

  private maybeResetCounters(state: RateLimitState, now: number): RateLimitState {
    // Reset minute counter if window expired
    if (now >= state.minuteResetAt) {
      state.minuteCount = 0;
      state.minuteResetAt = now + 60000;
    }

    // Reset day counter if window expired
    if (now >= state.dayResetAt) {
      state.dayCount = 0;
      state.dayResetAt = this.getEndOfDay(now);
    }

    return state;
  }

  private getEndOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime() + 1; // Start of next day
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Error class for rate limit exceeded
export class RateLimitExceededError extends Error {
  constructor(
    public serverId: string,
    public retryAfterMs: number,
    public remaining: { perMinute: number; perDay: number }
  ) {
    super(`Rate limit exceeded for server ${serverId}. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'RateLimitExceededError';
  }
}
