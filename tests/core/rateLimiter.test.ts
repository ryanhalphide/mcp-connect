import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter, RateLimitExceededError } from '../../src/core/rateLimiter.js';

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('register/unregister', () => {
    it('should register rate limit config for a server', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 60, requestsPerDay: 1000 });

      const status = rateLimiter.getStatus('server-1');
      expect(status.config).toEqual({ requestsPerMinute: 60, requestsPerDay: 1000 });
    });

    it('should unregister rate limit config for a server', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 60, requestsPerDay: 1000 });
      rateLimiter.unregister('server-1');

      const status = rateLimiter.getStatus('server-1');
      expect(status.config).toBeUndefined();
    });
  });

  describe('consume', () => {
    it('should allow requests when no config is registered', () => {
      const result = rateLimiter.consume('unknown-server');

      expect(result.allowed).toBe(true);
      expect(result.remaining.perMinute).toBe(Infinity);
      expect(result.remaining.perDay).toBe(Infinity);
    });

    it('should allow requests within rate limits', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 10, requestsPerDay: 100 });

      const result = rateLimiter.consume('server-1');

      expect(result.allowed).toBe(true);
      expect(result.remaining.perMinute).toBe(9);
      expect(result.remaining.perDay).toBe(99);
    });

    it('should track multiple requests', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 10, requestsPerDay: 100 });

      for (let i = 0; i < 5; i++) {
        rateLimiter.consume('server-1');
      }

      const result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining.perMinute).toBe(4);
      expect(result.remaining.perDay).toBe(94);
    });

    it('should block requests when per-minute limit exceeded', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 3, requestsPerDay: 100 });

      // Exhaust the per-minute limit
      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');

      const result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining.perMinute).toBe(0);
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should block requests when per-day limit exceeded', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 100, requestsPerDay: 3 });

      // Exhaust the per-day limit
      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');

      const result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining.perDay).toBe(0);
    });

    it('should reset minute counter after 1 minute', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 2, requestsPerDay: 100 });

      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');

      // Should be blocked
      let result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(false);

      // Advance time by 1 minute
      vi.advanceTimersByTime(60001);

      // Should be allowed now
      result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining.perMinute).toBe(1);
    });

    it('should reset day counter at end of day', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 100, requestsPerDay: 2 });

      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');

      // Should be blocked
      let result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(false);

      // Advance time by 24 hours
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

      // Should be allowed now
      result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining.perDay).toBe(1);
    });

    it('should track separate limits for different servers', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 2, requestsPerDay: 100 });
      rateLimiter.register('server-2', { requestsPerMinute: 10, requestsPerDay: 100 });

      // Exhaust server-1 limit
      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');
      const result1 = rateLimiter.consume('server-1');
      expect(result1.allowed).toBe(false);

      // server-2 should still work
      const result2 = rateLimiter.consume('server-2');
      expect(result2.allowed).toBe(true);
    });
  });

  describe('check', () => {
    it('should return status without consuming a token', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 10, requestsPerDay: 100 });

      rateLimiter.consume('server-1');

      const check1 = rateLimiter.check('server-1');
      const check2 = rateLimiter.check('server-1');

      // Both checks should show same remaining (token not consumed)
      expect(check1.remaining.perMinute).toBe(9);
      expect(check2.remaining.perMinute).toBe(9);
    });

    it('should return allowed=false when limit exceeded', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 1, requestsPerDay: 100 });

      rateLimiter.consume('server-1');

      const result = rateLimiter.check('server-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should return full limits for uninitialized server', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 10, requestsPerDay: 100 });

      const result = rateLimiter.check('server-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining.perMinute).toBe(10);
      expect(result.remaining.perDay).toBe(100);
    });
  });

  describe('getStatus', () => {
    it('should return config and current state', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 10, requestsPerDay: 100 });
      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');

      const status = rateLimiter.getStatus('server-1');

      expect(status.config).toEqual({ requestsPerMinute: 10, requestsPerDay: 100 });
      expect(status.current).toEqual({ minuteCount: 2, dayCount: 2 });
    });

    it('should return undefined for unregistered server', () => {
      const status = rateLimiter.getStatus('unknown');

      expect(status.config).toBeUndefined();
      expect(status.current).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should reset counters for a specific server', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 2, requestsPerDay: 100 });

      rateLimiter.consume('server-1');
      rateLimiter.consume('server-1');

      // Should be blocked
      let result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(false);

      // Reset
      rateLimiter.reset('server-1');

      // Should be allowed now
      result = rateLimiter.consume('server-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('should reset counters for all servers', () => {
      rateLimiter.register('server-1', { requestsPerMinute: 1, requestsPerDay: 100 });
      rateLimiter.register('server-2', { requestsPerMinute: 1, requestsPerDay: 100 });

      rateLimiter.consume('server-1');
      rateLimiter.consume('server-2');

      // Both should be blocked
      expect(rateLimiter.consume('server-1').allowed).toBe(false);
      expect(rateLimiter.consume('server-2').allowed).toBe(false);

      // Reset all
      rateLimiter.resetAll();

      // Both should be allowed now
      expect(rateLimiter.consume('server-1').allowed).toBe(true);
      expect(rateLimiter.consume('server-2').allowed).toBe(true);
    });
  });
});

describe('RateLimitExceededError', () => {
  it('should create error with proper message and properties', () => {
    const error = new RateLimitExceededError('server-1', 30000, {
      perMinute: 0,
      perDay: 50,
    });

    expect(error.name).toBe('RateLimitExceededError');
    expect(error.message).toContain('server-1');
    expect(error.message).toContain('30s');
    expect(error.serverId).toBe('server-1');
    expect(error.retryAfterMs).toBe(30000);
    expect(error.remaining).toEqual({ perMinute: 0, perDay: 50 });
  });
});
