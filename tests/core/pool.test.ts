import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConnectionPool } from '../../src/core/pool.js';
import type { MCPServerConfig } from '../../src/core/types.js';

// Mock the MCP client
const mockDisconnect = vi.fn();
const mockListTools = vi.fn();
const mockClient = {
  listTools: mockListTools,
};
const mockCreateMCPClient = vi.fn();

vi.mock('../../src/mcp/client.js', () => ({
  createMCPClient: (config: MCPServerConfig) => mockCreateMCPClient(config),
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  const createTestConfig = (overrides: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'test-server',
    description: 'Test server',
    transport: {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    },
    auth: { type: 'none' },
    healthCheck: {
      enabled: false, // Disable health checks for most tests
      intervalMs: 30000,
      timeoutMs: 5000,
    },
    rateLimits: {
      requestsPerMinute: 60,
      requestsPerDay: 10000,
    },
    metadata: {
      tags: [],
      category: 'general',
      version: '1.0.0',
    },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    pool = new ConnectionPool();
    vi.clearAllMocks();

    mockCreateMCPClient.mockResolvedValue({
      client: mockClient,
      disconnect: mockDisconnect,
    });
  });

  afterEach(async () => {
    await pool.disconnectAll();
  });

  describe('connect', () => {
    it('should establish a new connection', async () => {
      const config = createTestConfig();

      const connection = await pool.connect(config);

      expect(connection.serverId).toBe(config.id);
      expect(connection.status).toBe('connected');
      expect(connection.lastHealthCheck).toBeDefined();
      expect(mockCreateMCPClient).toHaveBeenCalledWith(config);
    });

    it('should reuse existing connected connection', async () => {
      const config = createTestConfig();

      const first = await pool.connect(config);
      const second = await pool.connect(config);

      expect(first).toBe(second);
      expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
    });

    it('should handle connection errors', async () => {
      const config = createTestConfig();
      mockCreateMCPClient.mockRejectedValue(new Error('Connection refused'));

      await expect(pool.connect(config)).rejects.toThrow('Connection refused');

      const connection = pool.getConnection(config.id);
      expect(connection?.status).toBe('error');
      expect(connection?.error).toBe('Connection refused');
    });

    it('should set status to connecting during connection attempt', async () => {
      const config = createTestConfig();

      // Make connection slow
      mockCreateMCPClient.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ client: mockClient, disconnect: mockDisconnect }), 100))
      );

      const connectPromise = pool.connect(config);

      // Check status immediately
      const connection = pool.getConnection(config.id);
      expect(connection?.status).toBe('connecting');

      await connectPromise;
    });
  });

  describe('disconnect', () => {
    it('should disconnect an existing connection', async () => {
      const config = createTestConfig();
      await pool.connect(config);

      await pool.disconnect(config.id);

      expect(mockDisconnect).toHaveBeenCalled();
      expect(pool.getConnection(config.id)).toBeUndefined();
    });

    it('should handle disconnecting non-existent connection', async () => {
      await expect(pool.disconnect('non-existent')).resolves.not.toThrow();
    });

    it('should handle disconnect errors gracefully', async () => {
      const config = createTestConfig();
      await pool.connect(config);

      mockDisconnect.mockRejectedValue(new Error('Disconnect failed'));

      await expect(pool.disconnect(config.id)).resolves.not.toThrow();
      expect(pool.getConnection(config.id)).toBeUndefined();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connections', async () => {
      const config1 = createTestConfig({ id: '123e4567-e89b-12d3-a456-426614174001', name: 'server1' });
      const config2 = createTestConfig({ id: '223e4567-e89b-12d3-a456-426614174002', name: 'server2' });

      await pool.connect(config1);
      await pool.connect(config2);

      expect(pool.getAllConnections()).toHaveLength(2);

      await pool.disconnectAll();

      expect(pool.getAllConnections()).toHaveLength(0);
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
    });

    it('should handle empty pool', async () => {
      await expect(pool.disconnectAll()).resolves.not.toThrow();
    });
  });

  describe('getClient', () => {
    it('should return client for connected server', async () => {
      const config = createTestConfig();
      await pool.connect(config);

      const client = pool.getClient(config.id);

      expect(client).toBe(mockClient);
    });

    it('should return undefined for disconnected server', () => {
      const client = pool.getClient('non-existent');
      expect(client).toBeUndefined();
    });

    it('should return undefined for server in error state', async () => {
      const config = createTestConfig();
      mockCreateMCPClient.mockRejectedValue(new Error('Failed'));

      try {
        await pool.connect(config);
      } catch {
        // Expected to fail
      }

      const client = pool.getClient(config.id);
      expect(client).toBeUndefined();
    });
  });

  describe('getConnectionStatus', () => {
    it('should return connected for active connection', async () => {
      const config = createTestConfig();
      await pool.connect(config);

      expect(pool.getConnectionStatus(config.id)).toBe('connected');
    });

    it('should return disconnected for unknown server', () => {
      expect(pool.getConnectionStatus('unknown')).toBe('disconnected');
    });

    it('should return error for failed connection', async () => {
      const config = createTestConfig();
      mockCreateMCPClient.mockRejectedValue(new Error('Failed'));

      try {
        await pool.connect(config);
      } catch {
        // Expected
      }

      expect(pool.getConnectionStatus(config.id)).toBe('error');
    });
  });

  describe('getAllConnections', () => {
    it('should return all connections', async () => {
      const config1 = createTestConfig({ id: '123e4567-e89b-12d3-a456-426614174001', name: 'server1' });
      const config2 = createTestConfig({ id: '223e4567-e89b-12d3-a456-426614174002', name: 'server2' });

      await pool.connect(config1);
      await pool.connect(config2);

      const connections = pool.getAllConnections();

      expect(connections).toHaveLength(2);
      expect(connections.map((c) => c.serverId)).toContain(config1.id);
      expect(connections.map((c) => c.serverId)).toContain(config2.id);
    });

    it('should return empty array when no connections', () => {
      expect(pool.getAllConnections()).toEqual([]);
    });
  });

  describe('health checks', () => {
    it('should start health check when enabled', async () => {
      vi.useFakeTimers();

      const config = createTestConfig({
        healthCheck: {
          enabled: true,
          intervalMs: 1000,
          timeoutMs: 500,
        },
      });

      mockListTools.mockResolvedValue({ tools: [] });

      await pool.connect(config);

      // Fast forward past the health check interval
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockListTools).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not start health check when disabled', async () => {
      vi.useFakeTimers();

      const config = createTestConfig({
        healthCheck: {
          enabled: false,
          intervalMs: 1000,
          timeoutMs: 500,
        },
      });

      await pool.connect(config);

      await vi.advanceTimersByTimeAsync(2000);

      expect(mockListTools).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
