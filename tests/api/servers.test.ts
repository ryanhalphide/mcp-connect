import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { serversApi } from '../../src/api/servers.js';

// Mock dependencies
const mockGetServer = vi.fn();
const mockGetServerByName = vi.fn();
const mockGetAllServers = vi.fn(() => []);
const mockSaveServer = vi.fn();
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
    getServerByName: (name: string) => mockGetServerByName(name),
    getAllServers: (enabledOnly?: boolean) => mockGetAllServers(enabledOnly),
    saveServer: (config: any) => mockSaveServer(config),
    updateServer: (id: string, updates: any) => mockUpdateServer(id, updates),
    deleteServer: (id: string) => mockDeleteServer(id),
  },
}));

vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    connect: (config: any) => mockConnect(config),
    disconnect: (id: string) => mockDisconnect(id),
    getConnectionStatus: (id: string) => mockGetConnectionStatus(id),
    getClient: (id: string) => mockGetClient(id),
  },
}));

vi.mock('../../src/core/resourceRegistry.js', () => ({
  resourceRegistry: {
    registerResources: (server: any, resources: any) => mockRegisterResources(server, resources),
    unregisterServer: (id: string) => mockUnregisterResources(id),
  },
}));

vi.mock('../../src/mcp/client.js', () => ({
  listResources: () => mockListResources(),
}));

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    registerServer: (config: any) => mockRegisterServer(config),
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

describe('Servers API', () => {
  let app: Hono;

  const testServer = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'test-server',
    description: 'Test server',
    transport: {
      type: 'stdio' as const,
      command: 'node',
      args: ['server.js'],
    },
    auth: { type: 'none' as const },
    healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
    rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
    metadata: { tags: [], category: 'general', version: '1.0.0' },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    app = new Hono();
    app.route('/servers', serversApi);
    vi.clearAllMocks();
  });

  describe('GET /servers', () => {
    it('should return empty array when no servers', async () => {
      mockGetAllServers.mockReturnValue([]);

      const res = await app.request('/servers');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual([]);
    });

    it('should return all servers with connection status', async () => {
      mockGetAllServers.mockReturnValue([testServer]);
      mockGetConnectionStatus.mockReturnValue('connected');
      mockGetServerToolCount.mockReturnValue(5);

      const res = await app.request('/servers');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].name).toBe('test-server');
      expect(json.data[0].connectionStatus).toBe('connected');
      expect(json.data[0].toolCount).toBe(5);
    });

    it('should filter by enabled when query param provided', async () => {
      const res = await app.request('/servers?enabled=true');
      expect(res.status).toBe(200);
      expect(mockGetAllServers).toHaveBeenCalledWith(true);
    });
  });

  describe('GET /servers/:id', () => {
    it('should return server details', async () => {
      mockGetServer.mockReturnValue(testServer);
      mockGetConnectionStatus.mockReturnValue('connected');
      mockFindToolsByServer.mockReturnValue([{ name: 'tool1' }]);

      const res = await app.request(`/servers/${testServer.id}`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.name).toBe('test-server');
      expect(json.data.connectionStatus).toBe('connected');
      expect(json.data.tools).toHaveLength(1);
    });

    it('should return 404 for non-existent server', async () => {
      mockGetServer.mockReturnValue(undefined);

      const res = await app.request('/servers/unknown-id');
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Server not found');
    });
  });

  describe('POST /servers', () => {
    it('should create a new server', async () => {
      mockGetServerByName.mockReturnValue(undefined);
      mockSaveServer.mockReturnValue({ ...testServer, id: 'new-id' });

      const res = await app.request('/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'new-server',
          transport: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
          },
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockSaveServer).toHaveBeenCalled();
    });

    it('should return 409 for duplicate server name', async () => {
      mockGetServerByName.mockReturnValue(testServer);

      const res = await app.request('/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          transport: {
            type: 'stdio',
            command: 'node',
            args: [],
          },
        }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain('already exists');
    });

    it('should return 400 for invalid request body', async () => {
      const res = await app.request('/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing required fields
          description: 'Invalid server',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Validation error');
    });
  });

  describe('PUT /servers/:id', () => {
    it('should update an existing server', async () => {
      mockUpdateServer.mockReturnValue({ ...testServer, name: 'updated-server' });

      const res = await app.request(`/servers/${testServer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated-server' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('updated-server');
    });

    it('should return 404 for non-existent server', async () => {
      mockUpdateServer.mockReturnValue(undefined);

      const res = await app.request('/servers/unknown-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /servers/:id', () => {
    it('should delete an existing server', async () => {
      mockDeleteServer.mockReturnValue(true);

      const res = await app.request(`/servers/${testServer.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      expect(mockDisconnect).toHaveBeenCalledWith(testServer.id);
      expect(mockUnregisterServer).toHaveBeenCalledWith(testServer.id);
      expect(mockDeleteServer).toHaveBeenCalledWith(testServer.id);
    });

    it('should return 404 for non-existent server', async () => {
      mockDeleteServer.mockReturnValue(false);

      const res = await app.request('/servers/unknown-id', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /servers/:id/connect', () => {
    it('should connect to server and register tools', async () => {
      mockGetServer.mockReturnValue(testServer);
      mockConnect.mockResolvedValue({ status: 'connected' });
      mockRegisterServer.mockResolvedValue([
        { name: 'tool1' },
        { name: 'tool2' },
      ]);
      mockGetConnectionStatus.mockReturnValue('connected');

      const res = await app.request(`/servers/${testServer.id}/connect`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.connected).toBe(true);
      expect(json.data.tools).toHaveLength(2);
    });

    it('should return 404 for non-existent server', async () => {
      mockGetServer.mockReturnValue(undefined);

      const res = await app.request('/servers/unknown-id/connect', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });

    it('should return 500 on connection error', async () => {
      mockGetServer.mockReturnValue(testServer);
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const res = await app.request(`/servers/${testServer.id}/connect`, {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Connection refused');
    });
  });

  describe('POST /servers/:id/disconnect', () => {
    it('should disconnect from server', async () => {
      mockGetConnectionStatus.mockReturnValue('disconnected');

      const res = await app.request(`/servers/${testServer.id}/disconnect`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockDisconnect).toHaveBeenCalledWith(testServer.id);
      expect(mockUnregisterServer).toHaveBeenCalledWith(testServer.id);

      const json = await res.json();
      expect(json.data.disconnected).toBe(true);
      expect(json.data.status).toBe('disconnected');
    });
  });

  describe('GET /servers/:id/tools', () => {
    it('should return tools for a server', async () => {
      mockGetServer.mockReturnValue(testServer);
      mockFindToolsByServer.mockReturnValue([
        { name: 'filesystem/read' },
        { name: 'filesystem/write' },
      ]);

      const res = await app.request(`/servers/${testServer.id}/tools`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data).toHaveLength(2);
    });

    it('should return 404 for non-existent server', async () => {
      mockGetServer.mockReturnValue(undefined);

      const res = await app.request('/servers/unknown-id/tools');
      expect(res.status).toBe(404);
    });
  });
});
