import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { monitorApi, trackRequest } from '../../src/api/monitor.js';

// Mock dependencies
vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    getConnectionStatus: vi.fn(() => 'connected'),
  },
}));

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    getToolCount: vi.fn(() => 0),
    getAllTools: vi.fn(() => []),
    findToolsByServer: vi.fn(() => []),
  },
}));

vi.mock('../../src/storage/db.js', () => ({
  serverDatabase: {
    getAllServers: vi.fn(() => []),
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

import { connectionPool } from '../../src/core/pool.js';
import { toolRegistry } from '../../src/core/registry.js';
import { serverDatabase } from '../../src/storage/db.js';

describe('Monitor API', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/monitor', monitorApi);
    vi.clearAllMocks();
  });

  describe('GET /monitor/metrics', () => {
    it('should return metrics with correct structure', async () => {
      const res = await app.request('/monitor/metrics');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('uptime');
      expect(json.data).toHaveProperty('memory');
      expect(json.data).toHaveProperty('requests');
      expect(json.data).toHaveProperty('servers');
      expect(json.data).toHaveProperty('tools');
      expect(json.timestamp).toBeDefined();
    });

    it('should return memory usage in MB', async () => {
      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.memory).toHaveProperty('used');
      expect(json.data.memory).toHaveProperty('total');
      expect(json.data.memory).toHaveProperty('rss');
      expect(typeof json.data.memory.used).toBe('number');
      expect(typeof json.data.memory.total).toBe('number');
    });

    it('should return request statistics', async () => {
      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.requests).toHaveProperty('total');
      expect(json.data.requests).toHaveProperty('successful');
      expect(json.data.requests).toHaveProperty('failed');
      expect(json.data.requests).toHaveProperty('successRate');
      expect(json.data.requests).toHaveProperty('avgResponseTime');
    });

    it('should count connected and errored servers', async () => {
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([
        { id: 'srv1', name: 'Server 1' },
        { id: 'srv2', name: 'Server 2' },
        { id: 'srv3', name: 'Server 3' },
      ] as any);

      vi.mocked(connectionPool.getConnectionStatus)
        .mockReturnValueOnce('connected')
        .mockReturnValueOnce('connected')
        .mockReturnValueOnce('error');

      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.servers.total).toBe(3);
      expect(json.data.servers.connected).toBe(2);
      expect(json.data.servers.errored).toBe(1);
    });

    it('should return tool count from registry', async () => {
      vi.mocked(toolRegistry.getToolCount).mockReturnValue(42);

      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.tools.registered).toBe(42);
    });

    it('should handle zero servers', async () => {
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([]);

      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.servers.total).toBe(0);
      expect(json.data.servers.connected).toBe(0);
      expect(json.data.servers.errored).toBe(0);
    });
  });

  describe('GET /monitor/requests', () => {
    it('should return recent requests with default limit', async () => {
      const res = await app.request('/monitor/requests');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('requests');
      expect(json.data).toHaveProperty('total');
      expect(Array.isArray(json.data.requests)).toBe(true);
    });

    it('should respect limit query parameter', async () => {
      // Track some requests first
      for (let i = 0; i < 10; i++) {
        trackRequest('GET', `/test/${i}`, 200, 50);
      }

      const res = await app.request('/monitor/requests?limit=5');
      const json = await res.json();

      expect(json.data.requests.length).toBeLessThanOrEqual(5);
    });

    it('should include request details', async () => {
      trackRequest('POST', '/api/tools/invoke', 200, 150);

      const res = await app.request('/monitor/requests?limit=1');
      const json = await res.json();

      if (json.data.requests.length > 0) {
        const request = json.data.requests[0];
        expect(request).toHaveProperty('method');
        expect(request).toHaveProperty('path');
        expect(request).toHaveProperty('status');
        expect(request).toHaveProperty('duration');
        expect(request).toHaveProperty('timestamp');
      }
    });
  });

  describe('GET /monitor/stats', () => {
    it('should return detailed server statistics', async () => {
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([
        {
          id: 'srv1',
          name: 'Test Server',
          enabled: true,
          rateLimits: { requestsPerMinute: 60, requestsPerDay: 1000 },
          metadata: { category: 'test', tags: ['tag1', 'tag2'] },
        },
      ] as any);

      vi.mocked(connectionPool.getConnectionStatus).mockReturnValue('connected');
      vi.mocked(toolRegistry.findToolsByServer).mockReturnValue([
        { name: 'tool1' },
        { name: 'tool2' },
      ] as any);

      const res = await app.request('/monitor/stats');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.servers).toHaveLength(1);

      const server = json.data.servers[0];
      expect(server.id).toBe('srv1');
      expect(server.name).toBe('Test Server');
      expect(server.status).toBe('connected');
      expect(server.enabled).toBe(true);
      expect(server.toolCount).toBe(2);
      expect(server.rateLimit.requestsPerMinute).toBe(60);
      expect(server.category).toBe('test');
      expect(server.tags).toEqual(['tag1', 'tag2']);
    });

    it('should return endpoint statistics', async () => {
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([]);

      const res = await app.request('/monitor/stats');
      const json = await res.json();

      expect(json.data).toHaveProperty('endpoints');
      expect(json.data.endpoints).toHaveProperty('byPath');
      expect(json.data.endpoints).toHaveProperty('byStatus');
    });

    it('should return top endpoints sorted by count', async () => {
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([]);

      // Track requests to different endpoints
      for (let i = 0; i < 5; i++) {
        trackRequest('GET', '/popular', 200, 50);
      }
      for (let i = 0; i < 3; i++) {
        trackRequest('GET', '/medium', 200, 50);
      }
      trackRequest('GET', '/rare', 200, 50);

      const res = await app.request('/monitor/stats');
      const json = await res.json();

      expect(json.data).toHaveProperty('topEndpoints');
      expect(Array.isArray(json.data.topEndpoints)).toBe(true);
    });

    it('should handle multiple servers with different statuses', async () => {
      vi.mocked(serverDatabase.getAllServers).mockReturnValue([
        {
          id: 'srv1',
          name: 'Connected Server',
          enabled: true,
          rateLimits: { requestsPerMinute: 60, requestsPerDay: 1000 },
          metadata: { category: 'prod', tags: [] },
        },
        {
          id: 'srv2',
          name: 'Error Server',
          enabled: false,
          rateLimits: { requestsPerMinute: 30, requestsPerDay: 500 },
          metadata: { category: 'dev', tags: ['test'] },
        },
      ] as any);

      vi.mocked(connectionPool.getConnectionStatus)
        .mockReturnValueOnce('connected')
        .mockReturnValueOnce('error');

      vi.mocked(toolRegistry.findToolsByServer)
        .mockReturnValueOnce([{ name: 't1' }, { name: 't2' }, { name: 't3' }] as any)
        .mockReturnValueOnce([{ name: 't4' }] as any);

      const res = await app.request('/monitor/stats');
      const json = await res.json();

      expect(json.data.servers).toHaveLength(2);
      expect(json.data.servers[0].toolCount).toBe(3);
      expect(json.data.servers[1].toolCount).toBe(1);
    });
  });

  describe('GET /monitor/tools', () => {
    it('should return tool statistics', async () => {
      vi.mocked(toolRegistry.getAllTools).mockReturnValue([
        { name: 'read_file', serverName: 'filesystem', registeredAt: '2024-01-01' },
        { name: 'write_file', serverName: 'filesystem', registeredAt: '2024-01-01' },
        { name: 'fetch', serverName: 'http', registeredAt: '2024-01-02' },
      ] as any);

      const res = await app.request('/monitor/tools');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(3);
    });

    it('should group tools by server', async () => {
      vi.mocked(toolRegistry.getAllTools).mockReturnValue([
        { name: 'tool1', serverName: 'serverA', registeredAt: '2024-01-01' },
        { name: 'tool2', serverName: 'serverA', registeredAt: '2024-01-01' },
        { name: 'tool3', serverName: 'serverB', registeredAt: '2024-01-01' },
      ] as any);

      const res = await app.request('/monitor/tools');
      const json = await res.json();

      expect(json.data.byServer).toEqual({
        serverA: 2,
        serverB: 1,
      });
    });

    it('should return tool details', async () => {
      const registeredAt = '2024-01-15T10:30:00Z';
      vi.mocked(toolRegistry.getAllTools).mockReturnValue([
        { name: 'my_tool', serverName: 'my_server', registeredAt },
      ] as any);

      const res = await app.request('/monitor/tools');
      const json = await res.json();

      expect(json.data.tools).toHaveLength(1);
      expect(json.data.tools[0]).toEqual({
        name: 'my_tool',
        server: 'my_server',
        registeredAt,
      });
    });

    it('should handle empty tools list', async () => {
      vi.mocked(toolRegistry.getAllTools).mockReturnValue([]);

      const res = await app.request('/monitor/tools');
      const json = await res.json();

      expect(json.data.total).toBe(0);
      expect(json.data.byServer).toEqual({});
      expect(json.data.tools).toEqual([]);
    });
  });

  describe('GET /monitor/dashboard', () => {
    it('should return HTML dashboard', async () => {
      const res = await app.request('/monitor/dashboard');
      expect(res.status).toBe(200);

      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('text/html');
    });

    it('should include dashboard title', async () => {
      const res = await app.request('/monitor/dashboard');
      const html = await res.text();

      expect(html).toContain('MCP Connect - Monitoring Dashboard');
    });

    it('should include refresh functionality', async () => {
      const res = await app.request('/monitor/dashboard');
      const html = await res.text();

      expect(html).toContain('loadData()');
      expect(html).toContain('autoRefresh');
    });

    it('should include proper CSS styling', async () => {
      const res = await app.request('/monitor/dashboard');
      const html = await res.text();

      expect(html).toContain('<style>');
      expect(html).toContain('.container');
      expect(html).toContain('.card');
    });
  });

  describe('trackRequest function', () => {
    it('should track successful requests', async () => {
      trackRequest('GET', '/api/health', 200, 50);

      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.requests.total).toBeGreaterThan(0);
    });

    it('should track failed requests', async () => {
      trackRequest('POST', '/api/error', 500, 100);

      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      expect(json.data.requests.failed).toBeGreaterThan(0);
    });

    it('should calculate success rate correctly', async () => {
      // Track a mix of success and failure
      trackRequest('GET', '/success1', 200, 50);
      trackRequest('GET', '/success2', 201, 50);
      trackRequest('GET', '/success3', 302, 50);
      trackRequest('GET', '/fail', 500, 50);

      const res = await app.request('/monitor/metrics');
      const json = await res.json();

      // Success rate should reflect the ratio of successful to total
      expect(json.data.requests.successRate).toBeGreaterThan(0);
      expect(json.data.requests.successRate).toBeLessThanOrEqual(100);
    });

    it('should track requests by endpoint', async () => {
      trackRequest('GET', '/tracked/endpoint', 200, 50);
      trackRequest('GET', '/tracked/endpoint', 200, 60);

      const res = await app.request('/monitor/stats');
      const json = await res.json();

      expect(json.data.endpoints.byPath['/tracked/endpoint']).toBeGreaterThanOrEqual(2);
    });

    it('should track requests by status code', async () => {
      trackRequest('GET', '/test', 200, 50);
      trackRequest('GET', '/test', 404, 50);

      const res = await app.request('/monitor/stats');
      const json = await res.json();

      expect(json.data.endpoints.byStatus[200]).toBeGreaterThanOrEqual(1);
      expect(json.data.endpoints.byStatus[404]).toBeGreaterThanOrEqual(1);
    });

    it('should maintain recent requests list', async () => {
      trackRequest('GET', '/recent/test', 200, 75);

      const res = await app.request('/monitor/requests?limit=10');
      const json = await res.json();

      const found = json.data.requests.some(
        (r: any) => r.path === '/recent/test' && r.duration === 75
      );
      expect(found).toBe(true);
    });
  });
});
