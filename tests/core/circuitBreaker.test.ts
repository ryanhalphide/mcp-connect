import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitState,
  CircuitBreakerOpenError,
} from '../../src/core/circuitBreaker.js';

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-server', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      volumeThreshold: 3,
    });
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
    });

    it('should allow execution initially', () => {
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('failure handling', () => {
    it('should stay closed after failures below threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
      expect(breaker.getState().failureCount).toBe(2);
    });

    it('should open after failures exceed threshold with sufficient volume', () => {
      // Need volume threshold (3) requests first
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();

      // Now add failures
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getState().state).toBe(CircuitState.OPEN);
    });

    it('should not open if volume threshold not met', () => {
      // Create a breaker with high volume threshold
      const lowVolumeBreaker = new CircuitBreaker('low-volume-test', {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000,
        volumeThreshold: 10, // High volume threshold
      });

      // Only 2 requests (below volume threshold of 10)
      lowVolumeBreaker.recordFailure();
      lowVolumeBreaker.recordFailure();

      // Still closed because we haven't hit volume threshold (need 10 requests)
      expect(lowVolumeBreaker.getState().state).toBe(CircuitState.CLOSED);
      expect(lowVolumeBreaker.getState().failureCount).toBe(2);
    });
  });

  describe('success handling', () => {
    it('should reset failure count on success', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();

      expect(breaker.getState().failureCount).toBe(0);
    });
  });

  describe('state transitions', () => {
    it('should transition from OPEN to HALF_OPEN after timeout', async () => {
      // Get to OPEN state
      for (let i = 0; i < 6; i++) {
        breaker.recordFailure();
      }

      expect(breaker.getState().state).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should transition to HALF_OPEN
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState().state).toBe(CircuitState.HALF_OPEN);
    });

    it('should close from HALF_OPEN after successes', async () => {
      // Get to OPEN state
      for (let i = 0; i < 6; i++) {
        breaker.recordFailure();
      }

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be in HALF_OPEN now
      expect(breaker.getState().state).toBe(CircuitState.HALF_OPEN);

      // Record successes to close
      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
    });

    it('should reopen from HALF_OPEN on failure', async () => {
      // Get to OPEN state
      for (let i = 0; i < 6; i++) {
        breaker.recordFailure();
      }

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be in HALF_OPEN now
      expect(breaker.getState().state).toBe(CircuitState.HALF_OPEN);

      // Record a failure
      breaker.recordFailure();

      expect(breaker.getState().state).toBe(CircuitState.OPEN);
    });
  });

  describe('execute', () => {
    it('should execute function when circuit is closed', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should throw CircuitBreakerOpenError when circuit is open', async () => {
      // Get to OPEN state
      for (let i = 0; i < 6; i++) {
        breaker.recordFailure();
      }

      const fn = vi.fn().mockResolvedValue('success');

      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
    });

    it('should record success on successful execution', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await breaker.execute(fn);

      expect(breaker.getState().successCount).toBe(1);
    });

    it('should record failure on failed execution', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('test error'));

      await expect(breaker.execute(fn)).rejects.toThrow('test error');
      expect(breaker.getState().failureCount).toBe(1);
    });
  });

  describe('force operations', () => {
    it('should force close the circuit', () => {
      // Get to OPEN state
      for (let i = 0; i < 6; i++) {
        breaker.recordFailure();
      }

      expect(breaker.getState().state).toBe(CircuitState.OPEN);

      breaker.forceClose();

      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
      expect(breaker.getState().failureCount).toBe(0);
    });

    it('should force open the circuit', () => {
      expect(breaker.getState().state).toBe(CircuitState.CLOSED);

      breaker.forceOpen();

      expect(breaker.getState().state).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);
    });
  });

  describe('getTimeUntilRetry', () => {
    it('should return 0 when circuit is closed', () => {
      expect(breaker.getTimeUntilRetry()).toBe(0);
    });

    it('should return remaining timeout when circuit is open', () => {
      // Get to OPEN state
      for (let i = 0; i < 6; i++) {
        breaker.recordFailure();
      }

      const timeUntilRetry = breaker.getTimeUntilRetry();

      expect(timeUntilRetry).toBeGreaterThan(0);
      expect(timeUntilRetry).toBeLessThanOrEqual(1000);
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  describe('getBreaker', () => {
    it('should create a new breaker for unknown server', () => {
      const breaker = registry.getBreaker('new-server');

      expect(breaker).toBeDefined();
      expect(breaker.getServerId()).toBe('new-server');
    });

    it('should return existing breaker for known server', () => {
      const breaker1 = registry.getBreaker('server1');
      const breaker2 = registry.getBreaker('server1');

      expect(breaker1).toBe(breaker2);
    });

    it('should apply custom config', () => {
      const breaker = registry.getBreaker('server1', { failureThreshold: 10 });

      // The breaker should be created with custom config
      expect(breaker).toBeDefined();
    });
  });

  describe('canExecute', () => {
    it('should return true for unknown server', () => {
      expect(registry.canExecute('unknown-server')).toBe(true);
    });

    it('should return false for open circuit', () => {
      const breaker = registry.getBreaker('server1', {
        failureThreshold: 2,
        volumeThreshold: 2,
      });

      // Trigger failures
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(registry.canExecute('server1')).toBe(false);
    });
  });

  describe('recordSuccess/recordFailure', () => {
    it('should record success for existing breaker', () => {
      const breaker = registry.getBreaker('server1');
      registry.recordSuccess('server1');

      expect(breaker.getState().successCount).toBe(1);
    });

    it('should record failure and create breaker if needed', () => {
      registry.recordFailure('new-server');

      const state = registry.getState('new-server');
      expect(state).toBeDefined();
      expect(state?.failureCount).toBe(1);
    });
  });

  describe('getAllStates', () => {
    it('should return states for all breakers', () => {
      registry.getBreaker('server1');
      registry.getBreaker('server2');
      registry.getBreaker('server3');

      const states = registry.getAllStates();

      expect(states.size).toBe(3);
      expect(states.has('server1')).toBe(true);
      expect(states.has('server2')).toBe(true);
      expect(states.has('server3')).toBe(true);
    });
  });

  describe('getStateCounts', () => {
    it('should count breakers by state', () => {
      registry.getBreaker('closed1');
      registry.getBreaker('closed2');

      const openBreaker = registry.getBreaker('open1', {
        failureThreshold: 2,
        volumeThreshold: 2,
      });
      openBreaker.recordFailure();
      openBreaker.recordFailure();
      openBreaker.recordFailure();
      openBreaker.recordFailure();

      const counts = registry.getStateCounts();

      expect(counts.closed).toBe(2);
      expect(counts.open).toBe(1);
      expect(counts.halfOpen).toBe(0);
    });
  });

  describe('forceClose/forceOpen', () => {
    it('should force close existing breaker', () => {
      const breaker = registry.getBreaker('server1');
      breaker.forceOpen();

      const success = registry.forceClose('server1');

      expect(success).toBe(true);
      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
    });

    it('should return false for unknown server on forceClose', () => {
      const success = registry.forceClose('unknown');

      expect(success).toBe(false);
    });

    it('should force open existing breaker', () => {
      registry.getBreaker('server1');

      const success = registry.forceOpen('server1');

      expect(success).toBe(true);
    });
  });

  describe('removeBreaker', () => {
    it('should remove breaker', () => {
      registry.getBreaker('server1');

      const removed = registry.removeBreaker('server1');

      expect(removed).toBe(true);
      expect(registry.getState('server1')).toBeUndefined();
    });

    it('should return false for unknown server', () => {
      const removed = registry.removeBreaker('unknown');

      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all breakers', () => {
      registry.getBreaker('server1');
      registry.getBreaker('server2');
      registry.getBreaker('server3');

      registry.clear();

      expect(registry.getAllStates().size).toBe(0);
    });
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should have correct properties', () => {
    const error = new CircuitBreakerOpenError('test-server', 5000);

    expect(error.name).toBe('CircuitBreakerOpenError');
    expect(error.serverId).toBe('test-server');
    expect(error.retryAfterMs).toBe(5000);
    expect(error.message).toContain('test-server');
    expect(error.message).toContain('5s');
  });
});
