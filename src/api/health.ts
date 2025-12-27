import { Hono } from 'hono';
import type { ApiResponse } from '../core/types.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { serverDatabase } from '../storage/db.js';

export const healthApi = new Hono();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  servers: {
    total: number;
    connected: number;
    errored: number;
  };
  tools: {
    registered: number;
  };
  timestamp: string;
}

const startTime = Date.now();

function apiResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

// GET /health - Basic health check
healthApi.get('/', (c) => {
  const connections = connectionPool.getAllConnections();
  const connectedCount = connections.filter((conn) => conn.status === 'connected').length;
  const erroredCount = connections.filter((conn) => conn.status === 'error').length;

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (erroredCount > 0 && connectedCount === 0) {
    status = 'unhealthy';
  } else if (erroredCount > 0) {
    status = 'degraded';
  }

  const health: HealthStatus = {
    status,
    version: process.env.npm_package_version || '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    servers: {
      total: serverDatabase.getAllServers().length,
      connected: connectedCount,
      errored: erroredCount,
    },
    tools: {
      registered: toolRegistry.getToolCount(),
    },
    timestamp: new Date().toISOString(),
  };

  if (status === 'unhealthy') {
    c.status(503);
  }

  return c.json(apiResponse(health));
});

// GET /health/live - Kubernetes liveness probe
healthApi.get('/live', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /health/ready - Kubernetes readiness probe
healthApi.get('/ready', (c) => {
  const connections = connectionPool.getAllConnections();
  const hasConnectedServers = connections.some((conn) => conn.status === 'connected');

  if (connections.length > 0 && !hasConnectedServers) {
    c.status(503);
    return c.json({
      status: 'not_ready',
      reason: 'No servers connected',
      timestamp: new Date().toISOString(),
    });
  }

  return c.json({ status: 'ready', timestamp: new Date().toISOString() });
});

// GET /health/connections - Detailed connection status
healthApi.get('/connections', (c) => {
  const connections = connectionPool.getAllConnections();

  const details = connections.map((conn) => ({
    serverId: conn.serverId,
    status: conn.status,
    lastHealthCheck: conn.lastHealthCheck?.toISOString(),
    error: conn.error,
  }));

  return c.json(apiResponse({
    connections: details,
    summary: {
      total: details.length,
      connected: details.filter((d) => d.status === 'connected').length,
      connecting: details.filter((d) => d.status === 'connecting').length,
      error: details.filter((d) => d.status === 'error').length,
      disconnected: details.filter((d) => d.status === 'disconnected').length,
    },
  }));
});
