import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { healthApi } from '../../src/api/health.js';

// Mock dependencies
vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    getAllConnections: vi.fn(() => []),
  },
}));

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    getToolCount: vi.fn(() => 0),
  },
}));

vi.mock('../../src/storage/db.js', () => ({
  serverDatabase: {
    getAllServers: vi.fn(() => []),
  },
}));

import { connectionPool } from '../../src/core/pool.js';
import { toolRegistry } from '../../src/core/registry.js';
import { serverDatabase } from '../../src/storage/db.js';

describe('Health API', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/health', healthApi);
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy status when no connections', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('healthy');
      expect(json.data.servers.total).toBe(0);
      expect(json.data.servers.connected).toBe(0);
      expect(json.data.tools.registered).toBe(0);
      expect(json.data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return healthy status when all servers connected', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([
        { serverId: 'srv1', status: 'connected', client: {} },
        { serverId: 'srv2', status: 'connected', client: {} },
      ] as any);
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([{}, {}] as any);
      vi.mocked(toolRegistry.getToolCount).mockReturnValue(10);

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.status).toBe('healthy');
      expect(json.data.servers.connected).toBe(2);
      expect(json.data.servers.errored).toBe(0);
      expect(json.data.tools.registered).toBe(10);
    });

    it('should return degraded status when some servers have errors', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([
        { serverId: 'srv1', status: 'connected', client: {} },
        { serverId: 'srv2', status: 'error', error: 'Connection failed' },
      ] as any);

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.status).toBe('degraded');
      expect(json.data.servers.connected).toBe(1);
      expect(json.data.servers.errored).toBe(1);
    });

    it('should return unhealthy status and 503 when all servers errored', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([
        { serverId: 'srv1', status: 'error', error: 'Error 1' },
        { serverId: 'srv2', status: 'error', error: 'Error 2' },
      ] as any);

      const res = await app.request('/health');
      expect(res.status).toBe(503);

      const json = await res.json();
      expect(json.data.status).toBe('unhealthy');
    });
  });

  describe('GET /health/live', () => {
    it('should always return ok status', async () => {
      const res = await app.request('/health/live');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.status).toBe('ok');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('GET /health/ready', () => {
    it('should return ready when no servers configured', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([]);

      const res = await app.request('/health/ready');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.status).toBe('ready');
    });

    it('should return ready when at least one server connected', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([
        { serverId: 'srv1', status: 'connected', client: {} },
        { serverId: 'srv2', status: 'error', error: 'Error' },
      ] as any);

      const res = await app.request('/health/ready');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.status).toBe('ready');
    });

    it('should return not_ready and 503 when servers configured but none connected', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([
        { serverId: 'srv1', status: 'error', error: 'Error' },
      ] as any);

      const res = await app.request('/health/ready');
      expect(res.status).toBe(503);

      const json = await res.json();
      expect(json.status).toBe('not_ready');
      expect(json.reason).toBe('No servers connected');
    });
  });

  describe('GET /health/connections', () => {
    it('should return detailed connection status', async () => {
      const now = new Date();
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([
        { serverId: 'srv1', status: 'connected', client: {}, lastHealthCheck: now },
        { serverId: 'srv2', status: 'error', error: 'Connection refused' },
        { serverId: 'srv3', status: 'connecting', client: null },
      ] as any);

      const res = await app.request('/health/connections');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.connections).toHaveLength(3);
      expect(json.data.summary).toEqual({
        total: 3,
        connected: 1,
        connecting: 1,
        error: 1,
        disconnected: 0,
      });
    });

    it('should return empty connections array when no connections', async () => {
      vi.mocked(connectionPool.getAllConnections).mockReturnValue([]);

      const res = await app.request('/health/connections');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.connections).toEqual([]);
      expect(json.data.summary.total).toBe(0);
    });
  });
});
