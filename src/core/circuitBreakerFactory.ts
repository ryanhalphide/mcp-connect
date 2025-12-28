import { EnhancedCircuitBreakerRegistry } from './circuitBreakerEnhanced.js';
import { serverDatabase } from '../storage/db.js';

// Singleton instance - will be initialized after migrations
let instance: EnhancedCircuitBreakerRegistry | null = null;

export function initializeCircuitBreaker(): EnhancedCircuitBreakerRegistry {
  if (!instance) {
    const db = serverDatabase.getDatabase();

    instance = new EnhancedCircuitBreakerRegistry(db, {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000, // 60 seconds
      volumeThreshold: 10,
    });
  }
  return instance;
}

export function getEnhancedCircuitBreaker(): EnhancedCircuitBreakerRegistry {
  if (!instance) {
    throw new Error('Enhanced circuit breaker not initialized. Call initializeCircuitBreaker() first.');
  }
  return instance;
}
