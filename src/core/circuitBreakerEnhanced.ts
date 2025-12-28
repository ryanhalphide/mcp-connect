import Database from 'better-sqlite3';
import { createChildLogger } from '../observability/logger.js';
import {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerOpenError,
} from './circuitBreaker.js';

const logger = createChildLogger({ module: 'circuit-breaker-enhanced' });

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 60 seconds
  volumeThreshold: 10,
};

interface PersistedState {
  serverId: string;
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  lastStateChange: number;
  consecutiveSuccesses: number;
}

/**
 * Enhanced circuit breaker with SQLite persistence
 * State survives server restarts
 */
export class EnhancedCircuitBreaker {
  private db: Database.Database;
  private config: CircuitBreakerConfig;
  private serverId: string;

  // In-memory cache of current state
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private consecutiveSuccesses = 0;
  private lastFailureAt: number | null = null;
  private openedAt: number | null = null;
  private lastStateChange: number = Date.now();
  private requestCount = 0;

  constructor(db: Database.Database, serverId: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.db = db;
    this.serverId = serverId;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Load persisted state
    this.loadState();

    logger.info({ serverId, config: this.config }, 'Enhanced circuit breaker initialized');
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
        // Allow limited requests in half-open state
        return true;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.requestCount++;
    this.consecutiveSuccesses++;
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        logger.info({ serverId: this.serverId }, 'Circuit breaker closed after recovery');
      } else {
        this.persistState();
      }
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.requestCount++;
    this.failureCount++;
    this.consecutiveSuccesses = 0;
    this.lastFailureAt = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
      logger.warn({ serverId: this.serverId }, 'Circuit breaker opened after half-open failure');
    } else if (
      this.state === CircuitState.CLOSED &&
      this.requestCount >= this.config.volumeThreshold &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
      logger.warn(
        {
          serverId: this.serverId,
          failureCount: this.failureCount,
          threshold: this.config.failureThreshold,
        },
        'Circuit breaker opened due to failures'
      );
    } else {
      // Persist failure state even if not transitioning
      this.persistState();
    }
  }

  /**
   * Update state based on timeout
   */
  private updateState(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceOpened = Date.now() - (this.openedAt || this.lastStateChange);
      if (timeSinceOpened >= this.config.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
        this.consecutiveSuccesses = 0;
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

    if (newState === CircuitState.OPEN) {
      this.openedAt = this.lastStateChange;
    } else if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.consecutiveSuccesses = 0;
      this.requestCount = 0;
      this.openedAt = null;
      this.lastFailureAt = null;
    }

    // Persist state change
    this.persistState();

    logger.info(
      {
        serverId: this.serverId,
        oldState,
        newState,
      },
      'Circuit breaker state changed'
    );
  }

  /**
   * Get time until circuit breaker allows retry (in ms)
   */
  getTimeUntilRetry(): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }
    const elapsed = Date.now() - (this.openedAt || this.lastStateChange);
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
      successCount: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureAt,
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
    this.lastFailureAt = Date.now();
    logger.info({ serverId: this.serverId }, 'Circuit breaker force opened');
  }

  /**
   * Get the server ID
   */
  getServerId(): string {
    return this.serverId;
  }

  /**
   * Load state from database
   */
  private loadState(): void {
    const stmt = this.db.prepare('SELECT * FROM circuit_breaker_state WHERE server_id = ?');
    const row = stmt.get(this.serverId) as PersistedState | undefined;

    if (row) {
      this.state = row.state as CircuitState;
      this.failureCount = row.failureCount;
      this.consecutiveSuccesses = row.consecutiveSuccesses;
      this.lastFailureAt = row.lastFailureAt;
      this.openedAt = row.openedAt;
      this.lastStateChange = row.lastStateChange;

      logger.debug({ serverId: this.serverId, state: this.state }, 'Loaded circuit breaker state from DB');
    } else {
      // Initialize new state
      this.persistState();
    }
  }

  /**
   * Persist state to database
   */
  private persistState(): void {
    const stmt = this.db.prepare(`
      INSERT INTO circuit_breaker_state (
        server_id, state, failure_count, last_failure_at,
        opened_at, last_state_change, consecutive_successes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        state = excluded.state,
        failure_count = excluded.failure_count,
        last_failure_at = excluded.last_failure_at,
        opened_at = excluded.opened_at,
        last_state_change = excluded.last_state_change,
        consecutive_successes = excluded.consecutive_successes
    `);

    stmt.run(
      this.serverId,
      this.state,
      this.failureCount,
      this.lastFailureAt,
      this.openedAt,
      this.lastStateChange,
      this.consecutiveSuccesses
    );
  }
}

/**
 * Registry to manage enhanced circuit breakers for multiple servers
 */
export class EnhancedCircuitBreakerRegistry {
  private db: Database.Database;
  private breakers: Map<string, EnhancedCircuitBreaker> = new Map();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(db: Database.Database, defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.db = db;
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a circuit breaker for a server
   */
  getBreaker(serverId: string, config?: Partial<CircuitBreakerConfig>): EnhancedCircuitBreaker {
    let breaker = this.breakers.get(serverId);
    if (!breaker) {
      breaker = new EnhancedCircuitBreaker(this.db, serverId, { ...this.defaultConfig, ...config });
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
    const breaker = this.getBreaker(serverId);
    breaker.recordSuccess();
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
    const breaker = this.getBreaker(serverId);
    breaker.forceClose();
    return true;
  }

  /**
   * Force open a circuit breaker
   */
  forceOpen(serverId: string): boolean {
    const breaker = this.getBreaker(serverId);
    breaker.forceOpen();
    return true;
  }

  /**
   * Remove a circuit breaker from memory (state persists in DB)
   */
  removeBreaker(serverId: string): boolean {
    return this.breakers.delete(serverId);
  }

  /**
   * Clear all circuit breakers from memory (states persist in DB)
   */
  clear(): void {
    this.breakers.clear();
    logger.info('All circuit breakers cleared from memory');
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

export { CircuitBreakerOpenError, CircuitState };
