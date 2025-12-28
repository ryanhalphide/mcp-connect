import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { serversApi } from '../../src/api/servers.js';

// Mock dependencies
const mockGetServer = vi.fn();
const mockGetAllServers = vi.fn(() => []);
const mockUpdateServer = vi.fn();
const mockDeleteServer = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockGetConnectionStatus = vi.fn(() => 'disconnected');
const mockGetClient = vi.fn(() => null);
const mockRegisterServer = vi.fn();
const mockUnregisterServer = vi.fn();
const mockGetServerToolCount = vi.fn(() => 0);
const mockFindToolsByServer = vi.fn(() => []);
const mockRegisterResources = vi.fn();
const mockUnregisterResources = vi.fn(() => 0);
const mockListResources = vi.fn(() => Promise.resolve([]));

vi.mock('../../src/storage/db.js', () => ({
  serverDatabase: {
    getServer: (id: string) => mockGetServer(id),
    getServerByName: vi.fn(),
    getAllServers: (enabledOnly?: boolean) => mockGetAllServers(enabledOnly),
    saveServer: vi.fn(),
    updateServer: (id: string, updates: unknown) => mockUpdateServer(id, updates),
    deleteServer: (id: string) => mockDeleteServer(id),
  },
}));

vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    connect: (config: unknown) => mockConnect(config),
    disconnect: (id: string) => mockDisconnect(id),
    getConnectionStatus: (id: string) => mockGetConnectionStatus(id),
    getClient: (id: string) => mockGetClient(id),
  },
}));

vi.mock('../../src/core/resourceRegistry.js', () => ({
  resourceRegistry: {
    registerResources: (server: unknown, resources: unknown) => mockRegisterResources(server, resources),
    unregisterServer: (id: string) => mockUnregisterResources(id),
  },
}));

vi.mock('../../src/mcp/client.js', () => ({
  listResources: () => mockListResources(),
}));

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    registerServer: (config: unknown) => mockRegisterServer(config),
    unregisterServer: (id: string) => mockUnregisterServer(id),
    getServerToolCount: (id: string) => mockGetServerToolCount(id),
    findToolsByServer: (id: string) => mockFindToolsByServer(id),
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

describe('Bulk Operations API', () => {
  let app: Hono;

  const testServer1 = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    name: 'Test Server 1',
    description: 'Test server 1',
    transport: { type: 'stdio' as const, command: 'test', args: [] },
    auth: { type: 'none' as const },
    enabled: true,
  };

  const testServer2 = {
    id: '123e4567-e89b-12d3-a456-426614174002',
    name: 'Test Server 2',
    description: 'Test server 2',
    transport: { type: 'stdio' as const, command: 'test', args: [] },
    auth: { type: 'none' as const },
    enabled: true,
  };

  const testServer3 = {
    id: '123e4567-e89b-12d3-a456-426614174003',
    name: 'Test Server 3',
    description: 'Test server 3',
    transport: { type: 'stdio' as const, command: 'test', args: [] },
    auth: { type: 'none' as const },
    enabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockGetServer.mockImplementation((id: string) => {
      if (id === testServer1.id) return testServer1;
      if (id === testServer2.id) return testServer2;
      if (id === testServer3.id) return testServer3;
      return undefined;
    });

    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockRegisterServer.mockResolvedValue([{ name: 'test-tool' }]);
    mockUpdateServer.mockImplementation((id: string, updates: unknown) => {
      const server = mockGetServer(id);
      if (!server) return undefined;
      return { ...server, ...(updates as object) };
    });
    mockDeleteServer.mockImplementation((id: string) => {
      const server = mockGetServer(id);
      return !!server;
    });

    app = new Hono();
    app.route('/api/servers', serversApi);
  });

  describe('POST /api/servers/bulk/connect', () => {
    it('should connect to multiple servers', async () => {
      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, testServer2.id, testServer3.id],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.results).toHaveLength(3);
      expect(json.data.summary.total).toBe(3);
      expect(json.data.summary.success).toBe(3);
      expect(json.data.summary.failed).toBe(0);
      expect(mockConnect).toHaveBeenCalledTimes(3);
      expect(mockRegisterServer).toHaveBeenCalledTimes(3);
    });

    it('should handle non-existent servers', async () => {
      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: ['00000000-0000-0000-0000-000000000000'],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.results[0].success).toBe(false);
      expect(json.data.results[0].error).toBe('Server not found');
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('should handle connection failures', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id],
        }),
      });
      const json = await res.json();

      expect(json.data.results[0].success).toBe(false);
      expect(json.data.results[0].error).toBe('Connection refused');
    });

    it('should return tool count on successful connection', async () => {
      mockRegisterServer.mockResolvedValue([
        { name: 'tool-1' },
        { name: 'tool-2' },
        { name: 'tool-3' },
      ]);

      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id],
        }),
      });
      const json = await res.json();

      expect(json.data.results[0].toolCount).toBe(3);
    });

    it('should validate empty server IDs array', async () => {
      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe('POST /api/servers/bulk/disconnect', () => {
    it('should disconnect from multiple servers', async () => {
      const res = await app.request('/api/servers/bulk/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, testServer2.id],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.summary.success).toBe(2);
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
      expect(mockUnregisterServer).toHaveBeenCalledTimes(2);
    });

    it('should handle non-existent servers gracefully', async () => {
      const res = await app.request('/api/servers/bulk/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: ['00000000-0000-0000-0000-000000000000'],
        }),
      });
      const json = await res.json();

      // Should still succeed as disconnect is idempotent
      expect(res.status).toBe(200);
      expect(json.data.summary.success).toBe(1);
    });
  });

  describe('PUT /api/servers/bulk', () => {
    it('should update multiple servers', async () => {
      const res = await app.request('/api/servers/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, testServer2.id],
          updates: {
            description: 'Bulk updated description',
          },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.summary.success).toBe(2);
      expect(mockUpdateServer).toHaveBeenCalledTimes(2);
    });

    it('should handle partial failures', async () => {
      const res = await app.request('/api/servers/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, '00000000-0000-0000-0000-000000000000'],
          updates: { description: 'Updated' },
        }),
      });
      const json = await res.json();

      expect(json.data.summary.success).toBe(1);
      expect(json.data.summary.failed).toBe(1);
    });
  });

  describe('DELETE /api/servers/bulk', () => {
    it('should delete multiple servers', async () => {
      const res = await app.request('/api/servers/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, testServer2.id],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.summary.success).toBe(2);
      expect(mockDeleteServer).toHaveBeenCalledTimes(2);
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
    });

    it('should handle non-existent servers', async () => {
      const res = await app.request('/api/servers/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: ['00000000-0000-0000-0000-000000000000'],
        }),
      });
      const json = await res.json();

      expect(json.data.summary.failed).toBe(1);
    });
  });

  describe('POST /api/servers/bulk/enable', () => {
    it('should enable multiple servers', async () => {
      const res = await app.request('/api/servers/bulk/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, testServer3.id],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.summary.success).toBe(2);
      expect(mockUpdateServer).toHaveBeenCalledWith(testServer1.id, { enabled: true });
      expect(mockUpdateServer).toHaveBeenCalledWith(testServer3.id, { enabled: true });
    });
  });

  describe('POST /api/servers/bulk/disable', () => {
    it('should disable multiple servers and disconnect them', async () => {
      const res = await app.request('/api/servers/bulk/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id, testServer2.id],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.summary.success).toBe(2);
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
      expect(mockUnregisterServer).toHaveBeenCalledTimes(2);
      expect(mockUpdateServer).toHaveBeenCalledWith(testServer1.id, { enabled: false });
      expect(mockUpdateServer).toHaveBeenCalledWith(testServer2.id, { enabled: false });
    });
  });

  describe('input validation', () => {
    it('should reject non-UUID server IDs', async () => {
      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: ['not-a-uuid'],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it('should reject more than 100 servers', async () => {
      const manyIds = Array(101)
        .fill(null)
        .map(() => '00000000-0000-0000-0000-000000000000');

      const res = await app.request('/api/servers/bulk/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverIds: manyIds }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it('should validate bulk update schema', async () => {
      const res = await app.request('/api/servers/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIds: [testServer1.id],
          // Missing updates field
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });
});
