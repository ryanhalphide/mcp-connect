import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRouter } from '../../src/core/router.js';

// Mock dependencies
const mockGetClient = vi.fn();
const mockFindTool = vi.fn();
const mockCallTool = vi.fn();

vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    getClient: () => mockGetClient(),
  },
}));

const mockRecordUsage = vi.fn();

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    findTool: (name: string) => mockFindTool(name),
    recordUsage: (name: string) => mockRecordUsage(name),
  },
}));

vi.mock('../../src/mcp/client.js', () => ({
  callTool: (client: unknown, name: string, args: unknown) => mockCallTool(client, name, args),
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ToolRouter', () => {
  let router: ToolRouter;

  beforeEach(() => {
    router = new ToolRouter();
    vi.clearAllMocks();
  });

  describe('invoke', () => {
    it('should return error when tool is not found', async () => {
      mockFindTool.mockReturnValue(undefined);

      const result = await router.invoke('unknown-tool', { param: 'value' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool not found: unknown-tool');
      expect(result.toolName).toBe('unknown-tool');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return error when server is not connected', async () => {
      mockFindTool.mockReturnValue({
        name: 'filesystem/read_file',
        serverId: 'server-123',
        serverName: 'filesystem',
      });
      mockGetClient.mockReturnValue(undefined);

      const result = await router.invoke('read_file', { path: '/test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server server-123 is not connected');
      expect(result.serverId).toBe('server-123');
    });

    it('should successfully invoke a tool', async () => {
      const mockClient = { id: 'mock-client' };
      mockFindTool.mockReturnValue({
        name: 'filesystem/read_file',
        serverId: 'server-123',
        serverName: 'filesystem',
      });
      mockGetClient.mockReturnValue(mockClient);
      mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'file content' }] });

      const result = await router.invoke('read_file', { path: '/test.txt' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ content: [{ type: 'text', text: 'file content' }] });
      expect(result.serverId).toBe('server-123');
      expect(result.toolName).toBe('filesystem/read_file');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      expect(mockCallTool).toHaveBeenCalledWith(mockClient, 'read_file', { path: '/test.txt' });
    });

    it('should handle tool invocation errors', async () => {
      const mockClient = { id: 'mock-client' };
      mockFindTool.mockReturnValue({
        name: 'filesystem/read_file',
        serverId: 'server-123',
        serverName: 'filesystem',
      });
      mockGetClient.mockReturnValue(mockClient);
      mockCallTool.mockRejectedValue(new Error('File not found'));

      const result = await router.invoke('read_file', { path: '/missing.txt' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
      expect(result.serverId).toBe('server-123');
    });

    it('should handle non-Error exceptions', async () => {
      const mockClient = { id: 'mock-client' };
      mockFindTool.mockReturnValue({
        name: 'filesystem/read_file',
        serverId: 'server-123',
        serverName: 'filesystem',
      });
      mockGetClient.mockReturnValue(mockClient);
      mockCallTool.mockRejectedValue('string error');

      const result = await router.invoke('read_file', { path: '/test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('invokeOnServer', () => {
    it('should return error when server is not connected', async () => {
      mockGetClient.mockReturnValue(undefined);

      const result = await router.invokeOnServer('server-123', 'read_file', { path: '/test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server server-123 is not connected');
      expect(result.serverId).toBe('server-123');
    });

    it('should successfully invoke a tool on specific server', async () => {
      const mockClient = { id: 'mock-client' };
      mockGetClient.mockReturnValue(mockClient);
      mockCallTool.mockResolvedValue({ result: 'success' });

      const result = await router.invokeOnServer('server-123', 'custom_tool', { data: 'test' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 'success' });
      expect(result.serverId).toBe('server-123');
      expect(result.toolName).toBe('custom_tool');
    });

    it('should handle errors when invoking on specific server', async () => {
      const mockClient = { id: 'mock-client' };
      mockGetClient.mockReturnValue(mockClient);
      mockCallTool.mockRejectedValue(new Error('Server error'));

      const result = await router.invokeOnServer('server-123', 'failing_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server error');
    });
  });

  describe('invokeBatch', () => {
    it('should invoke multiple tools in parallel', async () => {
      const mockClient = { id: 'mock-client' };
      mockFindTool.mockReturnValue({
        name: 'filesystem/read_file',
        serverId: 'server-123',
        serverName: 'filesystem',
      });
      mockGetClient.mockReturnValue(mockClient);
      mockCallTool.mockResolvedValue({ content: 'data' });

      const invocations = [
        { toolName: 'read_file', params: { path: '/file1.txt' } },
        { toolName: 'read_file', params: { path: '/file2.txt' } },
        { toolName: 'read_file', params: { path: '/file3.txt' } },
      ];

      const results = await router.invokeBatch(invocations);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(mockCallTool).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures in batch', async () => {
      const mockClient = { id: 'mock-client' };
      mockFindTool.mockReturnValue({
        name: 'filesystem/read_file',
        serverId: 'server-123',
        serverName: 'filesystem',
      });
      mockGetClient.mockReturnValue(mockClient);

      mockCallTool
        .mockResolvedValueOnce({ content: 'success1' })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ content: 'success2' });

      const invocations = [
        { toolName: 'read_file', params: { path: '/file1.txt' } },
        { toolName: 'read_file', params: { path: '/file2.txt' } },
        { toolName: 'read_file', params: { path: '/file3.txt' } },
      ];

      const results = await router.invokeBatch(invocations);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Failed');
      expect(results[2].success).toBe(true);
    });

    it('should handle empty batch', async () => {
      const results = await router.invokeBatch([]);

      expect(results).toEqual([]);
    });
  });
});
