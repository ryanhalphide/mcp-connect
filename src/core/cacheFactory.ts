import { ResponseCache } from './cache.js';
import { serverDatabase } from '../storage/db.js';

// Singleton instance - will be initialized after migrations
let instance: ResponseCache | null = null;

export function initializeCache(): ResponseCache {
  if (!instance) {
    const db = serverDatabase.getDatabase();
    instance = new ResponseCache(db);
  }
  return instance;
}

export function getCache(): ResponseCache {
  if (!instance) {
    throw new Error('Response cache not initialized. Call initializeCache() first.');
  }
  return instance;
}

export function shutdownCache(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}
