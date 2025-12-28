import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestLoggingMiddleware } from './observability/requestLogger.js';
import { authMiddleware } from './middleware/auth.js';
import { serversApi } from './api/servers.js';
import { toolsApi } from './api/tools.js';
import { healthApi } from './api/health.js';
import { webhookApi } from './api/webhook.js';
import { monitorApi } from './api/monitor.js';
import { keysApi } from './api/keys.js';
import { groupsApi } from './api/groups.js';
import { favoritesApi } from './api/favorites.js';
import { usageHistoryApi } from './api/usageHistory.js';
import { connectionPool } from './core/pool.js';
import { toolRegistry } from './core/registry.js';
import { serverDatabase } from './storage/db.js';
import { logger } from './observability/logger.js';
import { loadServersFromConfig } from './seed/loadServers.js';
import { initializeRateLimiter, shutdownRateLimiter } from './core/rateLimiterFactory.js';

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', requestLoggingMiddleware);

// Error handling
app.onError((err, c) => {
  logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
  return c.json(
    {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    },
    500
  );
});

// Mount public API routes (no auth required)
app.route('/api/health', healthApi);

// Mount API key management routes (master key required)
app.route('/api/keys', keysApi);

// Mount protected API routes (API key required)
app.use('/api/servers/*', authMiddleware);
app.route('/api/servers', serversApi);

app.use('/api/tools/*', authMiddleware);
app.route('/api/tools', toolsApi);

app.use('/api/webhook/invoke/*', authMiddleware);
app.route('/api/webhook', webhookApi);

app.use('/api/groups/*', authMiddleware);
app.route('/api/groups', groupsApi);

app.use('/api/favorites/*', authMiddleware);
app.route('/api/favorites', favoritesApi);

app.use('/api/usage/*', authMiddleware);
app.route('/api/usage', usageHistoryApi);

// Mount monitoring routes with optional auth (dashboard public, sensitive endpoints protected)
app.use('/api/monitor/stats', authMiddleware);
app.use('/api/monitor/requests', authMiddleware);
app.use('/api/monitor/tools', authMiddleware);
app.route('/api/monitor', monitorApi);

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public' }));

// Startup function
async function startup() {
  logger.info('Starting MCP Connect...');

  // Run database migrations
  logger.info('Running database migrations...');
  await serverDatabase.runMigrations();
  const migrationStatus = serverDatabase.getMigrationStatus();
  logger.info({
    currentVersion: migrationStatus.current,
    latestVersion: migrationStatus.latest,
    pending: migrationStatus.pending
  }, 'Database migrations complete');

  // Initialize enhanced rate limiter (after migrations)
  logger.info('Initializing enhanced rate limiter...');
  initializeRateLimiter();
  logger.info('Enhanced rate limiter initialized');

  // Load servers from config file if present
  const loadedCount = loadServersFromConfig();
  if (loadedCount > 0) {
    logger.info({ loadedCount }, 'Servers seeded from config file');
  }

  // Auto-connect to enabled servers
  const servers = serverDatabase.getAllServers(true);
  logger.info({ serverCount: servers.length }, 'Found enabled servers');

  for (const server of servers) {
    try {
      logger.info({ serverId: server.id, serverName: server.name }, 'Auto-connecting to server');
      await connectionPool.connect(server);
      await toolRegistry.registerServer(server);
    } catch (error) {
      logger.error(
        { serverId: server.id, serverName: server.name, error },
        'Failed to auto-connect to server'
      );
    }
  }

  const toolCount = toolRegistry.getToolCount();
  logger.info({ toolCount }, 'Tools registered');
}

// Shutdown function
async function shutdown() {
  logger.info('Shutting down MCP Connect...');

  // Shutdown rate limiter (flush pending writes)
  shutdownRateLimiter();

  await connectionPool.disconnectAll();
  serverDatabase.close();

  logger.info('Shutdown complete');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const port = parseInt(process.env.PORT || '3000', 10);

startup().then(() => {
  serve({ fetch: app.fetch, port }, (info) => {
    logger.info(
      {
        port: info.port,
        endpoints: {
          health: `http://localhost:${info.port}/api/health`,
          keys: `http://localhost:${info.port}/api/keys`,
          servers: `http://localhost:${info.port}/api/servers (auth required)`,
          tools: `http://localhost:${info.port}/api/tools (auth required)`,
          webhook: `http://localhost:${info.port}/api/webhook (auth required)`,
          groups: `http://localhost:${info.port}/api/groups (auth required)`,
          favorites: `http://localhost:${info.port}/api/favorites (auth required)`,
          usage: `http://localhost:${info.port}/api/usage (auth required)`,
          monitor: `http://localhost:${info.port}/api/monitor`,
          dashboard: `http://localhost:${info.port}/api/monitor/dashboard`,
        },
        authentication: {
          masterKey: process.env.MASTER_API_KEY ? 'configured' : 'NOT CONFIGURED',
          keysEndpoint: `http://localhost:${info.port}/api/keys (requires master key)`,
        },
      },
      'MCP Connect is running'
    );
  });
});

export { app };
