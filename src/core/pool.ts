import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { MCPServerConfig, ConnectionStatus, MCPConnection } from './types.js';
import { createMCPClient, type MCPClientWrapper } from '../mcp/client.js';
import { createChildLogger } from '../observability/logger.js';
import { rateLimiter } from './rateLimiter.js';

const logger = createChildLogger({ module: 'connection-pool' });

interface PooledConnection extends MCPConnection {
  wrapper: MCPClientWrapper;
}

export class ConnectionPool {
  private connections: Map<string, PooledConnection> = new Map();
  private healthChecks: Map<string, NodeJS.Timeout> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();

  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const existing = this.connections.get(config.id);
    if (existing && existing.status === 'connected') {
      logger.debug({ serverId: config.id }, 'Reusing existing connection');
      return existing;
    }

    logger.info({ serverId: config.id, serverName: config.name }, 'Establishing new connection');

    const connection: PooledConnection = {
      serverId: config.id,
      status: 'connecting',
      client: null as unknown as Client,
      wrapper: null as unknown as MCPClientWrapper,
    };

    this.connections.set(config.id, connection);
    this.configs.set(config.id, config);

    try {
      const wrapper = await createMCPClient(config);
      connection.wrapper = wrapper;
      connection.client = wrapper.client;
      connection.status = 'connected';
      connection.lastHealthCheck = new Date();

      if (config.healthCheck.enabled) {
        this.startHealthCheck(config);
      }

      // Register rate limit config if specified
      if (config.rateLimits) {
        rateLimiter.register(config.id, config.rateLimits);
      }

      logger.info({ serverId: config.id, serverName: config.name }, 'Connection established');
      return connection;
    } catch (error) {
      connection.status = 'error';
      connection.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ serverId: config.id, error: connection.error }, 'Connection failed');
      throw error;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      logger.warn({ serverId }, 'No connection found to disconnect');
      return;
    }

    this.stopHealthCheck(serverId);
    rateLimiter.unregister(serverId);

    if (connection.wrapper) {
      try {
        await connection.wrapper.disconnect();
      } catch (error) {
        logger.error({ serverId, error }, 'Error during disconnect');
      }
    }

    this.connections.delete(serverId);
    this.configs.delete(serverId);
    logger.info({ serverId }, 'Connection disconnected');
  }

  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.connections.keys());
    await Promise.all(serverIds.map((id) => this.disconnect(id)));
    logger.info('All connections disconnected');
  }

  getConnection(serverId: string): MCPConnection | undefined {
    return this.connections.get(serverId);
  }

  getClient(serverId: string): Client | undefined {
    const connection = this.connections.get(serverId);
    return connection?.status === 'connected' ? (connection.client as Client) : undefined;
  }

  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values());
  }

  getConnectionStatus(serverId: string): ConnectionStatus {
    const connection = this.connections.get(serverId);
    return connection?.status ?? 'disconnected';
  }

  private startHealthCheck(config: MCPServerConfig): void {
    this.stopHealthCheck(config.id);

    const interval = setInterval(async () => {
      await this.performHealthCheck(config.id);
    }, config.healthCheck.intervalMs);

    this.healthChecks.set(config.id, interval);
    logger.debug({ serverId: config.id, intervalMs: config.healthCheck.intervalMs }, 'Health check started');
  }

  private stopHealthCheck(serverId: string): void {
    const interval = this.healthChecks.get(serverId);
    if (interval) {
      clearInterval(interval);
      this.healthChecks.delete(serverId);
      logger.debug({ serverId }, 'Health check stopped');
    }
  }

  private async performHealthCheck(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    const config = this.configs.get(serverId);

    if (!connection || !config) {
      return;
    }

    try {
      const client = connection.client as Client;
      // Simple ping - list tools to verify connection is alive
      await Promise.race([
        client.listTools(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), config.healthCheck.timeoutMs)
        ),
      ]);

      connection.lastHealthCheck = new Date();
      if (connection.status !== 'connected') {
        connection.status = 'connected';
        connection.error = undefined;
        logger.info({ serverId }, 'Connection recovered');
      }
    } catch (error) {
      connection.status = 'error';
      connection.error = error instanceof Error ? error.message : 'Health check failed';
      logger.warn({ serverId, error: connection.error }, 'Health check failed');

      // Attempt reconnection
      try {
        await this.reconnect(serverId);
      } catch (reconnectError) {
        logger.error({ serverId, error: reconnectError }, 'Reconnection failed');
      }
    }
  }

  private async reconnect(serverId: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`No config found for server ${serverId}`);
    }

    logger.info({ serverId }, 'Attempting reconnection');

    const connection = this.connections.get(serverId);
    if (connection?.wrapper) {
      try {
        await connection.wrapper.disconnect();
      } catch {
        // Ignore disconnect errors during reconnection
      }
    }

    await this.connect(config);
  }
}

// Singleton instance
export const connectionPool = new ConnectionPool();
