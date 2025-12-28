import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { usageHistoryApi } from '../../src/api/usageHistory.js';

// Mock dependencies
const mockGetRecentUsage = vi.fn(() => []);
const mockGetRecentlyUsedTools = vi.fn(() => []);
const mockGetMostUsedTools = vi.fn(() => []);
const mockGetUsageStats = vi.fn(() => ({
  totalInvocations: 0,
  successCount: 0,
  errorCount: 0,
  averageDurationMs: 0,
  toolBreakdown: [],
}));
const mockGetGlobalStats = vi.fn(() => ({
  totalInvocations: 0,
  uniqueUsers: 0,
  uniqueTools: 0,
  successRate: 0,
  topTools: [],
}));
const mockGetToolHistory = vi.fn(() => []);
const mockClearHistory = vi.fn(() => 0);

vi.mock('../../src/storage/usageHistory.js', () => ({
  usageHistoryStore: {
    getRecentUsage: (apiKeyId: string, limit: number) => mockGetRecentUsage(apiKeyId, limit),
    getRecentlyUsedTools: (apiKeyId: string, limit: number) => mockGetRecentlyUsedTools(apiKeyId, limit),
    getMostUsedTools: (apiKeyId: string, limit: number) => mockGetMostUsedTools(apiKeyId, limit),
    getUsageStats: (apiKeyId: string, since?: Date) => mockGetUsageStats(apiKeyId, since),
    getGlobalStats: (since?: Date) => mockGetGlobalStats(since),
    getToolHistory: (toolName: string, apiKeyId?: string, limit?: number) =>
      mockGetToolHistory(toolName, apiKeyId, limit),
    clearHistory: (apiKeyId: string, olderThan?: Date) => mockClearHistory(apiKeyId, olderThan),
  },
}));

const mockFindTool = vi.fn();

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    findTool: (name: string) => mockFindTool(name),
  },
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Usage History API', () => {
  let app: Hono;
  const testApiKeyId = 'test-api-key-123';

  const testUsageRecord = {
    id: 1,
    apiKeyId: testApiKeyId,
    toolName: 'filesystem/read_file',
    serverId: 'server-123',
    success: true,
    durationMs: 42,
    createdAt: new Date(),
  };

  const testTool = {
    name: 'filesystem/read_file',
    serverName: 'filesystem',
    description: 'Read a file from disk',
    category: 'filesystem',
  };

  beforeEach(() => {
    app = new Hono();
    // Add middleware to set apiKeyId
    app.use('*', async (c, next) => {
      c.set('apiKeyId', testApiKeyId);
      await next();
    });
    app.route('/usage', usageHistoryApi);
    vi.clearAllMocks();
  });

  describe('GET /usage/recent', () => {
    it('should return recent usage', async () => {
      mockGetRecentUsage.mockReturnValue([testUsageRecord]);
      mockFindTool.mockReturnValue(testTool);

      const res = await app.request('/usage/recent');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.usage).toHaveLength(1);
      expect(json.data.usage[0].toolName).toBe('filesystem/read_file');
      expect(json.data.usage[0].tool).toBeDefined();
    });

    it('should respect limit parameter', async () => {
      mockGetRecentUsage.mockReturnValue([]);

      await app.request('/usage/recent?limit=25');

      expect(mockGetRecentUsage).toHaveBeenCalledWith(testApiKeyId, 25);
    });

    it('should cap limit at 100', async () => {
      mockGetRecentUsage.mockReturnValue([]);

      await app.request('/usage/recent?limit=500');

      expect(mockGetRecentUsage).toHaveBeenCalledWith(testApiKeyId, 100);
    });

    it('should return 401 when no API key', async () => {
      const appWithoutAuth = new Hono();
      appWithoutAuth.route('/usage', usageHistoryApi);

      const res = await appWithoutAuth.request('/usage/recent');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /usage/tools/recent', () => {
    it('should return recently used tools', async () => {
      mockGetRecentlyUsedTools.mockReturnValue([
        { toolName: 'filesystem/read_file', lastUsed: new Date(), count: 5 },
      ]);
      mockFindTool.mockReturnValue(testTool);

      const res = await app.request('/usage/tools/recent');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.tools[0].count).toBe(5);
    });
  });

  describe('GET /usage/tools/most-used', () => {
    it('should return most used tools', async () => {
      mockGetMostUsedTools.mockReturnValue([
        { toolName: 'filesystem/read_file', count: 100, avgDurationMs: 15 },
        { toolName: 'memory/store', count: 50, avgDurationMs: 8 },
      ]);
      mockFindTool.mockReturnValue(testTool);

      const res = await app.request('/usage/tools/most-used');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(2);
      expect(json.data.tools[0].count).toBe(100);
    });
  });

  describe('GET /usage/stats', () => {
    it('should return usage statistics', async () => {
      mockGetUsageStats.mockReturnValue({
        totalInvocations: 100,
        successCount: 95,
        errorCount: 5,
        averageDurationMs: 25,
        toolBreakdown: [{ toolName: 'tool1', count: 50, avgDurationMs: 20 }],
      });

      const res = await app.request('/usage/stats');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.totalInvocations).toBe(100);
      expect(json.data.successCount).toBe(95);
    });

    it('should accept since parameter', async () => {
      mockGetUsageStats.mockReturnValue({
        totalInvocations: 0,
        successCount: 0,
        errorCount: 0,
        averageDurationMs: 0,
        toolBreakdown: [],
      });

      const since = new Date().toISOString();
      await app.request(`/usage/stats?since=${since}`);

      expect(mockGetUsageStats).toHaveBeenCalledWith(testApiKeyId, expect.any(Date));
    });

    it('should return 400 for invalid since date', async () => {
      const res = await app.request('/usage/stats?since=not-a-date');
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain('Invalid date format');
    });
  });

  describe('GET /usage/global', () => {
    it('should return global statistics', async () => {
      mockGetGlobalStats.mockReturnValue({
        totalInvocations: 1000,
        uniqueUsers: 50,
        uniqueTools: 25,
        successRate: 98.5,
        topTools: [{ toolName: 'tool1', count: 200 }],
      });

      const res = await app.request('/usage/global');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.totalInvocations).toBe(1000);
      expect(json.data.uniqueUsers).toBe(50);
    });
  });

  describe('GET /usage/tool/:toolName', () => {
    it('should return tool history', async () => {
      mockGetToolHistory.mockReturnValue([testUsageRecord]);
      mockFindTool.mockReturnValue(testTool);

      const res = await app.request('/usage/tool/filesystem/read_file');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.toolName).toBe('filesystem/read_file');
      expect(json.data.history).toHaveLength(1);
      expect(json.data.tool).toBeDefined();
    });

    it('should filter by API key by default', async () => {
      mockGetToolHistory.mockReturnValue([]);

      await app.request('/usage/tool/filesystem/read_file');

      expect(mockGetToolHistory).toHaveBeenCalledWith('filesystem/read_file', testApiKeyId, 50);
    });

    it('should allow all users with all=true', async () => {
      mockGetToolHistory.mockReturnValue([]);

      await app.request('/usage/tool/filesystem/read_file?all=true');

      expect(mockGetToolHistory).toHaveBeenCalledWith('filesystem/read_file', undefined, 50);
    });
  });

  describe('DELETE /usage', () => {
    it('should clear usage history', async () => {
      mockClearHistory.mockReturnValue(10);

      const res = await app.request('/usage', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.cleared).toBe(true);
      expect(json.data.count).toBe(10);
    });

    it('should accept olderThan parameter', async () => {
      mockClearHistory.mockReturnValue(5);

      const olderThan = new Date().toISOString();
      await app.request(`/usage?olderThan=${olderThan}`, { method: 'DELETE' });

      expect(mockClearHistory).toHaveBeenCalledWith(testApiKeyId, expect.any(Date));
    });

    it('should return 400 for invalid olderThan date', async () => {
      const res = await app.request('/usage?olderThan=invalid', { method: 'DELETE' });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain('Invalid date format');
    });
  });
});
