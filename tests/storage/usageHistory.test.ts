import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { UsageHistoryStore } from '../../src/storage/usageHistory.js';

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('UsageHistoryStore', () => {
  let db: Database.Database;
  let store: UsageHistoryStore;
  const testApiKeyId = 'test-api-key-123';
  const testApiKeyId2 = 'test-api-key-456';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new UsageHistoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('recordUsage', () => {
    it('should record a successful tool usage', () => {
      const record = store.recordUsage(
        testApiKeyId,
        'filesystem/read_file',
        'server-123',
        true,
        42
      );

      expect(record.id).toBeDefined();
      expect(record.apiKeyId).toBe(testApiKeyId);
      expect(record.toolName).toBe('filesystem/read_file');
      expect(record.serverId).toBe('server-123');
      expect(record.success).toBe(true);
      expect(record.durationMs).toBe(42);
      expect(record.errorMessage).toBeUndefined();
      expect(record.createdAt).toBeInstanceOf(Date);
    });

    it('should record a failed tool usage with error message', () => {
      const record = store.recordUsage(
        testApiKeyId,
        'filesystem/read_file',
        'server-123',
        false,
        15,
        'File not found'
      );

      expect(record.success).toBe(false);
      expect(record.errorMessage).toBe('File not found');
    });

    it('should record usage with params', () => {
      const params = { path: '/test.txt', encoding: 'utf8' };
      const record = store.recordUsage(
        testApiKeyId,
        'filesystem/read_file',
        'server-123',
        true,
        50,
        undefined,
        params
      );

      expect(record.params).toEqual(params);
    });
  });

  describe('getRecentUsage', () => {
    it('should return empty array when no usage', () => {
      const usage = store.getRecentUsage(testApiKeyId);
      expect(usage).toEqual([]);
    });

    it('should return recent usage ordered by date (newest first)', async () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.recordUsage(testApiKeyId, 'tool2', 'srv1', true, 20);
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.recordUsage(testApiKeyId, 'tool3', 'srv1', true, 30);

      const usage = store.getRecentUsage(testApiKeyId);

      expect(usage).toHaveLength(3);
      expect(usage[0].toolName).toBe('tool3');
      expect(usage[2].toolName).toBe('tool1');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        store.recordUsage(testApiKeyId, `tool${i}`, 'srv1', true, 10);
      }

      const usage = store.getRecentUsage(testApiKeyId, 5);
      expect(usage).toHaveLength(5);
    });

    it('should only return usage for specified API key', () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      store.recordUsage(testApiKeyId2, 'tool2', 'srv1', true, 10);

      const usage = store.getRecentUsage(testApiKeyId);

      expect(usage).toHaveLength(1);
      expect(usage[0].toolName).toBe('tool1');
    });
  });

  describe('getToolHistory', () => {
    it('should return history for a specific tool', () => {
      store.recordUsage(testApiKeyId, 'target_tool', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'other_tool', 'srv1', true, 20);
      store.recordUsage(testApiKeyId, 'target_tool', 'srv1', false, 30);

      const history = store.getToolHistory('target_tool', testApiKeyId);

      expect(history).toHaveLength(2);
      expect(history.every((r) => r.toolName === 'target_tool')).toBe(true);
    });

    it('should return history across all users when no API key specified', () => {
      store.recordUsage(testApiKeyId, 'shared_tool', 'srv1', true, 10);
      store.recordUsage(testApiKeyId2, 'shared_tool', 'srv1', true, 20);

      const history = store.getToolHistory('shared_tool');

      expect(history).toHaveLength(2);
    });
  });

  describe('getRecentlyUsedTools', () => {
    it('should return recently used tools ordered by last use', async () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.recordUsage(testApiKeyId, 'tool2', 'srv1', true, 20);
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 15); // Use tool1 again

      const recentTools = store.getRecentlyUsedTools(testApiKeyId);

      expect(recentTools).toHaveLength(2);
      expect(recentTools[0].toolName).toBe('tool1'); // Most recently used
      expect(recentTools[0].count).toBe(2);
      expect(recentTools[1].toolName).toBe('tool2');
      expect(recentTools[1].count).toBe(1);
    });
  });

  describe('getMostUsedTools', () => {
    it('should return tools ordered by usage count', () => {
      store.recordUsage(testApiKeyId, 'popular', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'popular', 'srv1', true, 15);
      store.recordUsage(testApiKeyId, 'popular', 'srv1', true, 20);
      store.recordUsage(testApiKeyId, 'medium', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'medium', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'rare', 'srv1', true, 10);

      const mostUsed = store.getMostUsedTools(testApiKeyId);

      expect(mostUsed).toHaveLength(3);
      expect(mostUsed[0].toolName).toBe('popular');
      expect(mostUsed[0].count).toBe(3);
      expect(mostUsed[0].avgDurationMs).toBe(15); // (10+15+20)/3
      expect(mostUsed[1].toolName).toBe('medium');
      expect(mostUsed[1].count).toBe(2);
      expect(mostUsed[2].toolName).toBe('rare');
      expect(mostUsed[2].count).toBe(1);
    });
  });

  describe('getUsageStats', () => {
    it('should return usage statistics', () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 20);
      store.recordUsage(testApiKeyId, 'tool2', 'srv1', false, 5, 'Error');

      const stats = store.getUsageStats(testApiKeyId);

      expect(stats.totalInvocations).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.errorCount).toBe(1);
      expect(stats.averageDurationMs).toBe(12); // (10+20+5)/3 = 11.67 rounded
      expect(stats.toolBreakdown).toHaveLength(2);
    });

    it('should filter by since date', async () => {
      store.recordUsage(testApiKeyId, 'old_tool', 'srv1', true, 10);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cutoffTime = new Date();
      await new Promise((resolve) => setTimeout(resolve, 50));
      store.recordUsage(testApiKeyId, 'new_tool', 'srv1', true, 20);

      const stats = store.getUsageStats(testApiKeyId, cutoffTime);

      expect(stats.totalInvocations).toBe(1);
      expect(stats.toolBreakdown[0].toolName).toBe('new_tool');
    });
  });

  describe('getGlobalStats', () => {
    it('should return global statistics across all users', () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'tool2', 'srv1', true, 20);
      store.recordUsage(testApiKeyId2, 'tool1', 'srv1', false, 5);

      const stats = store.getGlobalStats();

      expect(stats.totalInvocations).toBe(3);
      expect(stats.uniqueUsers).toBe(2);
      expect(stats.uniqueTools).toBe(2);
      expect(stats.successRate).toBeCloseTo(66.67, 1);
      expect(stats.topTools).toHaveLength(2);
    });
  });

  describe('clearHistory', () => {
    it('should clear all history for a user', () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      store.recordUsage(testApiKeyId, 'tool2', 'srv1', true, 20);

      const count = store.clearHistory(testApiKeyId);

      expect(count).toBe(2);
      expect(store.getRecentUsage(testApiKeyId)).toHaveLength(0);
    });

    it('should not affect other users', () => {
      store.recordUsage(testApiKeyId, 'tool1', 'srv1', true, 10);
      store.recordUsage(testApiKeyId2, 'tool2', 'srv1', true, 20);

      store.clearHistory(testApiKeyId);

      expect(store.getRecentUsage(testApiKeyId)).toHaveLength(0);
      expect(store.getRecentUsage(testApiKeyId2)).toHaveLength(1);
    });

    it('should clear only records older than specified date', async () => {
      store.recordUsage(testApiKeyId, 'old_tool', 'srv1', true, 10);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cutoffTime = new Date();
      await new Promise((resolve) => setTimeout(resolve, 50));
      store.recordUsage(testApiKeyId, 'new_tool', 'srv1', true, 20);

      const count = store.clearHistory(testApiKeyId, cutoffTime);

      expect(count).toBe(1);
      const remaining = store.getRecentUsage(testApiKeyId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].toolName).toBe('new_tool');
    });
  });

  describe('edge cases', () => {
    it('should handle zero duration', () => {
      const record = store.recordUsage(testApiKeyId, 'fast_tool', 'srv1', true, 0);
      expect(record.durationMs).toBe(0);
    });

    it('should handle very long tool names', () => {
      const longName = 'a'.repeat(200) + '/tool';
      const record = store.recordUsage(testApiKeyId, longName, 'srv1', true, 10);
      expect(record.toolName).toBe(longName);
    });

    it('should handle complex params', () => {
      const complexParams = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        string: 'hello',
        null: null,
        boolean: true,
      };
      const record = store.recordUsage(
        testApiKeyId,
        'tool',
        'srv1',
        true,
        10,
        undefined,
        complexParams
      );

      expect(record.params).toEqual(complexParams);

      const history = store.getRecentUsage(testApiKeyId);
      expect(history[0].params).toEqual(complexParams);
    });
  });
});
