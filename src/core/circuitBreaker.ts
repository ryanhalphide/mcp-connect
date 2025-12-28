import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'circuit-breaker' });

export enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation, requests pass through
  OPEN = 'OPEN',          // Failing, requests are rejected immediately
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;     // Number of failures before opening
  successThreshold: number;     // Number of successes in half-open to close
  timeout: number;              // Time in ms before trying half-open
  volumeThreshold: number;      // Minimum requests before evaluating
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastStateChange: number;
  requestCount: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000, // 30 seconds
  volumeThreshold: 5,
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastStateChange: number = Date.now();
  private requestCount = 0;
  private config: CircuitBreakerConfig;
  private readonly serverId: string;

  constructor(serverId: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.serverId = serverId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info({ serverId, config: this.config }, 'Circuit breaker initialized');
  }

  /**
   * Check if the circuit allows requests
   */
  canExecute(): boolean {
    this.updateState();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        return false;
      case CircuitState.HALF_OPEN:
        // Allow a limited number of requests in half-open state
        return true;
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const error = new CircuitBreakerOpenError(this.serverId, this.getTimeUntilRetry());
      logger.warn({ serverId: this.serverId, timeUntilRetry: this.getTimeUntilRetry() }, 'Circuit breaker is open');
      throw error;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.requestCount++;
    this.successCount++;
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        logger.info({ serverId: this.serverId }, 'Circuit breaker closed after recovery');
      }
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.requestCount++;
    this.failureCount++;
    this.successCount = 0;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
      logger.warn({ serverId: this.serverId }, 'Circuit breaker opened after half-open failure');
    } else if (
      this.state === CircuitState.CLOSED &&
      this.requestCount >= this.config.volumeThreshold &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
      logger.warn({
        serverId: this.serverId,
        failureCount: this.failureCount,
        threshold: this.config.failureThreshold
      }, 'Circuit breaker opened due to failures');
    }
  }

  /**
   * Update state based on timeout
   */
  private updateState(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);
      if (timeSinceLastFailure >= this.config.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
        this.successCount = 0;
        logger.info({ serverId: this.serverId }, 'Circuit breaker entering half-open state');
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.requestCount = 0;
    }

    logger.info({
      serverId: this.serverId,
      oldState,
      newState
    }, 'Circuit breaker state changed');
  }

  /**
   * Get time until circuit breaker allows retry (in ms)
   */
  getTimeUntilRetry(): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }
    const elapsed = Date.now() - (this.lastFailureTime || 0);
    return Math.max(0, this.config.timeout - elapsed);
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    this.updateState();
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      requestCount: this.requestCount,
    };
  }

  /**
   * Force the circuit to close (for admin/reset purposes)
   */
  forceClose(): void {
    this.transitionTo(CircuitState.CLOSED);
    logger.info({ serverId: this.serverId }, 'Circuit breaker force closed');
  }

  /**
   * Force the circuit to open (for maintenance purposes)
   */
  forceOpen(): void {
    this.transitionTo(CircuitState.OPEN);
    this.lastFailureTime = Date.now();
    logger.info({ serverId: this.serverId }, 'Circuit breaker force opened');
  }

  /**
   * Get the server ID this circuit breaker is for
   */
  getServerId(): string {
    return this.serverId;
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  public readonly serverId: string;
  public readonly retryAfterMs: number;

  constructor(serverId: string, retryAfterMs: number) {
    super(`Circuit breaker is open for server ${serverId}. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitBreakerOpenError';
    this.serverId = serverId;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Registry to manage circuit breakers for multiple servers
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a circuit breaker for a server
   */
  getBreaker(serverId: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let breaker = this.breakers.get(serverId);
    if (!breaker) {
      breaker = new CircuitBreaker(serverId, { ...this.defaultConfig, ...config });
      this.breakers.set(serverId, breaker);
    }
    return breaker;
  }

  /**
   * Check if circuit allows execution for a server
   */
  canExecute(serverId: string): boolean {
    const breaker = this.breakers.get(serverId);
    if (!breaker) {
      return true; // No breaker means no restrictions
    }
    return breaker.canExecute();
  }

  /**
   * Record a success for a server
   */
  recordSuccess(serverId: string): void {
    const breaker = this.breakers.get(serverId);
    if (breaker) {
      breaker.recordSuccess();
    }
  }

  /**
   * Record a failure for a server
   */
  recordFailure(serverId: string): void {
    const breaker = this.getBreaker(serverId);
    breaker.recordFailure();
  }

  /**
   * Get all circuit breaker states
   */
  getAllStates(): Map<string, CircuitBreakerState> {
    const states = new Map<string, CircuitBreakerState>();
    for (const [serverId, breaker] of this.breakers) {
      states.set(serverId, breaker.getState());
    }
    return states;
  }

  /**
   * Get state for a specific server
   */
  getState(serverId: string): CircuitBreakerState | undefined {
    const breaker = this.breakers.get(serverId);
    return breaker?.getState();
  }

  /**
   * Force close a circuit breaker
   */
  forceClose(serverId: string): boolean {
    const breaker = this.breakers.get(serverId);
    if (breaker) {
      breaker.forceClose();
      return true;
    }
    return false;
  }

  /**
   * Force open a circuit breaker
   */
  forceOpen(serverId: string): boolean {
    const breaker = this.breakers.get(serverId);
    if (breaker) {
      breaker.forceOpen();
      return true;
    }
    return false;
  }

  /**
   * Remove a circuit breaker
   */
  removeBreaker(serverId: string): boolean {
    return this.breakers.delete(serverId);
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.breakers.clear();
    logger.info('All circuit breakers cleared');
  }

  /**
   * Get count of circuit breakers in each state
   */
  getStateCounts(): { closed: number; open: number; halfOpen: number } {
    let closed = 0;
    let open = 0;
    let halfOpen = 0;

    for (const breaker of this.breakers.values()) {
      const state = breaker.getState().state;
      switch (state) {
        case CircuitState.CLOSED:
          closed++;
          break;
        case CircuitState.OPEN:
          open++;
          break;
        case CircuitState.HALF_OPEN:
          halfOpen++;
          break;
      }
    }

    return { closed, open, halfOpen };
  }
}

// Singleton instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
