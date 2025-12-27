import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { toolsApi } from '../../src/api/tools.js';

// Mock dependencies
const mockGetAllTools = vi.fn(() => []);
const mockSearchTools = vi.fn(() => []);
const mockFindTool = vi.fn();
const mockGetToolCount = vi.fn(() => 0);
const mockInvoke = vi.fn();
const mockInvokeBatch = vi.fn();

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    getAllTools: () => mockGetAllTools(),
    searchTools: (query: string) => mockSearchTools(query),
    findTool: (name: string) => mockFindTool(name),
    getToolCount: () => mockGetToolCount(),
  },
}));

vi.mock('../../src/core/router.js', () => ({
  toolRouter: {
    invoke: (name: string, params: any) => mockInvoke(name, params),
    invokeBatch: (invocations: any[]) => mockInvokeBatch(invocations),
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

describe('Tools API', () => {
  let app: Hono;

  const testTool = {
    name: 'filesystem/read_file',
    serverId: '123e4567-e89b-12d3-a456-426614174000',
    serverName: 'filesystem',
    description: 'Read a file from disk',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    registeredAt: new Date(),
  };

  beforeEach(() => {
    app = new Hono();
    app.route('/tools', toolsApi);
    vi.clearAllMocks();
  });

  describe('GET /tools', () => {
    it('should return all tools', async () => {
      mockGetAllTools.mockReturnValue([testTool]);
      mockGetToolCount.mockReturnValue(1);

      const res = await app.request('/tools');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(json.data.totalRegistered).toBe(1);
    });

    it('should return empty array when no tools registered', async () => {
      mockGetAllTools.mockReturnValue([]);
      mockGetToolCount.mockReturnValue(0);

      const res = await app.request('/tools');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.tools).toEqual([]);
      expect(json.data.count).toBe(0);
    });

    it('should search tools when query param provided', async () => {
      mockSearchTools.mockReturnValue([testTool]);
      mockGetToolCount.mockReturnValue(5);

      const res = await app.request('/tools?q=file');
      expect(res.status).toBe(200);

      expect(mockSearchTools).toHaveBeenCalledWith('file');
      const json = await res.json();
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(json.data.totalRegistered).toBe(5);
    });
  });

  describe('GET /tools/:name', () => {
    it('should return tool details by exact name', async () => {
      mockFindTool.mockReturnValue(testTool);

      const res = await app.request('/tools/filesystem/read_file');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.name).toBe('filesystem/read_file');
      expect(json.data.description).toBe('Read a file from disk');
    });

    it('should return 404 for non-existent tool', async () => {
      mockFindTool.mockReturnValue(undefined);

      const res = await app.request('/tools/unknown/tool');
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Tool not found');
    });
  });

  describe('POST /tools/:name/invoke', () => {
    it('should successfully invoke a tool', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { content: [{ type: 'text', text: 'file contents' }] },
        serverId: testTool.serverId,
        toolName: testTool.name,
        durationMs: 42,
      });

      const res = await app.request('/tools/filesystem/read_file/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { path: '/tmp/test.txt' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.result).toEqual({ content: [{ type: 'text', text: 'file contents' }] });
      expect(json.data.durationMs).toBe(42);
    });

    it('should handle tool invocation failure', async () => {
      mockInvoke.mockResolvedValue({
        success: false,
        error: 'File not found',
        serverId: testTool.serverId,
        toolName: testTool.name,
        durationMs: 10,
      });

      const res = await app.request('/tools/filesystem/read_file/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { path: '/missing.txt' } }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('File not found');
    });

    it('should use empty params when not provided', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: {},
        serverId: 'srv1',
        toolName: 'tool1',
        durationMs: 5,
      });

      const res = await app.request('/tools/some/tool/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockInvoke).toHaveBeenCalledWith('some/tool', {});
    });

    it('should return 400 for invalid request body', async () => {
      const res = await app.request('/tools/some/tool/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: 'not-an-object' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Validation error');
    });

    it('should return 429 when rate limit exceeded', async () => {
      const futureDate = new Date(Date.now() + 30000).toISOString();
      mockInvoke.mockResolvedValue({
        success: false,
        error: 'Rate limit exceeded for server srv1. Retry after 30s',
        serverId: 'srv1',
        toolName: 'test/tool',
        durationMs: 1,
        rateLimit: {
          remaining: { perMinute: 0, perDay: 50 },
          resetAt: { minute: futureDate, day: futureDate },
        },
      });

      const res = await app.request('/tools/test/tool/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      });

      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Remaining-Minute')).toBe('0');
      expect(res.headers.get('X-RateLimit-Remaining-Day')).toBe('50');

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Rate limit exceeded');
      expect(json.rateLimit).toBeDefined();
    });

    it('should include rate limit headers on successful response', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { result: 'ok' },
        serverId: 'srv1',
        toolName: 'test/tool',
        durationMs: 10,
        rateLimit: {
          remaining: { perMinute: 9, perDay: 99 },
          resetAt: { minute: new Date().toISOString(), day: new Date().toISOString() },
        },
      });

      const res = await app.request('/tools/test/tool/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining-Minute')).toBe('9');
      expect(res.headers.get('X-RateLimit-Remaining-Day')).toBe('99');

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.rateLimit).toBeDefined();
    });
  });

  describe('POST /tools/batch', () => {
    it('should invoke multiple tools in batch', async () => {
      mockInvokeBatch.mockResolvedValue([
        { success: true, data: { result: 1 }, serverId: 's1', toolName: 't1', durationMs: 10 },
        { success: true, data: { result: 2 }, serverId: 's2', toolName: 't2', durationMs: 15 },
        { success: false, error: 'Failed', serverId: 's3', toolName: 't3', durationMs: 5 },
      ]);

      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invocations: [
            { toolName: 't1', params: {} },
            { toolName: 't2', params: { key: 'value' } },
            { toolName: 't3', params: {} },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results).toHaveLength(3);
      expect(json.data.summary).toEqual({
        total: 3,
        success: 2,
        failed: 1,
      });
    });

    it('should handle empty batch', async () => {
      mockInvokeBatch.mockResolvedValue([]);

      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocations: [] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results).toEqual([]);
      expect(json.data.summary.total).toBe(0);
    });

    it('should return 400 for invalid batch format', async () => {
      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invocations: [
            { params: {} }, // Missing toolName
          ],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Validation error');
    });
  });
});
