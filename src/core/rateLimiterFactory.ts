import { EnhancedRateLimiter } from './rateLimiterEnhanced.js';
import { serverDatabase } from '../storage/db.js';

// Singleton instance - will be initialized after migrations
let instance: EnhancedRateLimiter | null = null;

export function initializeRateLimiter(): EnhancedRateLimiter {
  if (!instance) {
    // Access the database instance using the public method
    const db = serverDatabase.getDatabase();

    instance = new EnhancedRateLimiter(db, {
      perMinute: 60,
      perDay: 1000,
    });
  }
  return instance;
}

export function getEnhancedRateLimiter(): EnhancedRateLimiter {
  if (!instance) {
    throw new Error('Enhanced rate limiter not initialized. Call initializeRateLimiter() first.');
  }
  return instance;
}

export function shutdownRateLimiter(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}
