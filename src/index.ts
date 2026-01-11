import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { requestLoggingMiddleware } from './observability/requestLogger.js';
import { authMiddleware, optionalAuthMiddleware } from './middleware/auth.js';
import { errorHandlerMiddleware, requestIdMiddleware, notFoundHandler } from './middleware/errorHandler.js';
import { shutdownManager, shutdownMiddleware } from './core/gracefulShutdown.js';
import { serversApi } from './api/servers.js';
import { toolsApi } from './api/tools.js';
import { resourcesApi } from './api/resources.js';
import { promptsApi } from './api/prompts.js';
import { searchApi } from './api/search.js';
import { samplingApi } from './api/sampling.js';
import { workflowsApi } from './api/workflows.js';
import { healthApi } from './api/health.js';
import { webhookApi } from './api/webhook.js';
import { monitorApi } from './api/monitor.js';
import { keysApi } from './api/keys.js';
import { groupsApi } from './api/groups.js';
import { favoritesApi } from './api/favorites.js';
import { usageHistoryApi } from './api/usageHistory.js';
import { cacheApi } from './api/cache.js';
import { auditApi } from './api/audit.js';
import { templatesApi } from './api/templates.js';
import { webhookSubscriptionsApi } from './api/webhookSubscriptions.js';
import { sseApi } from './api/sse.js';
import { prometheusApi } from './api/prometheus.js';
import { tenantsApi } from './api/tenants.js';
import { rbacApi } from './api/rbac.js';
import { usageApi } from './api/usage.js';
import { dockerApi } from './api/docker.js';
import { analyticsApi } from './api/analytics.js';
import { connectionPool } from './core/pool.js';
import { toolRegistry } from './core/registry.js';
import { resourceRegistry } from './core/resourceRegistry.js';
import { promptRegistry } from './core/promptRegistry.js';
import { serverDatabase } from './storage/db.js';
import { logger } from './observability/logger.js';
import { loadServersFromConfig } from './seed/loadServers.js';
import { initializeRateLimiter, shutdownRateLimiter } from './core/rateLimiterFactory.js';
import { initializeCache, shutdownCache } from './core/cacheFactory.js';
import { initializeCircuitBreaker } from './core/circuitBreakerFactory.js';
import { initializeAuditLogger } from './observability/auditLog.js';
import { registerBuiltInTemplates } from './seed/builtInTemplates.js';
import { initializeWebhookStore } from './storage/webhooks.js';
import { webhookDeliveryService } from './core/webhookDelivery.js';
import { initializeRBAC } from './rbac/policy.js';

const app = new Hono();

// Production middleware stack
app.use('*', requestIdMiddleware);        // Generate/propagate request IDs
app.use('*', secureHeaders());            // Security headers (X-Frame-Options, etc.)
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  credentials: true,
  maxAge: 86400,
}));
app.use('*', compress());                 // Gzip compression
app.use('*', shutdownMiddleware());       // Reject requests during shutdown
app.use('*', requestLoggingMiddleware);   // Request logging
app.use('*', errorHandlerMiddleware);     // Centralized error handling

// Mount public API routes (no auth required)
app.route('/api/health', healthApi);

// Mount API key management routes (master key required)
app.route('/api/keys', keysApi);

// Mount servers API (optional auth for read, required for write)
app.use('/api/servers/*', optionalAuthMiddleware);
app.route('/api/servers', serversApi);

app.use('/api/tools/*', optionalAuthMiddleware);
app.route('/api/tools', toolsApi);

app.use('/api/resources/*', authMiddleware);
app.route('/api/resources', resourcesApi);

app.use('/api/prompts/*', authMiddleware);
app.route('/api/prompts', promptsApi);

app.use('/api/search/*', authMiddleware);
app.route('/api/search', searchApi);

app.use('/api/sampling/*', authMiddleware);
app.route('/api/sampling', samplingApi);

app.use('/api/workflows/*', authMiddleware);
app.route('/api/workflows', workflowsApi);

app.use('/api/webhook/invoke/*', authMiddleware);
app.route('/api/webhook', webhookApi);

app.use('/api/groups/*', authMiddleware);
app.route('/api/groups', groupsApi);

app.use('/api/favorites/*', authMiddleware);
app.route('/api/favorites', favoritesApi);

app.use('/api/usage/*', authMiddleware);
app.route('/api/usage', usageHistoryApi);

// Mount cache management routes (requires auth)
app.use('/api/cache/*', authMiddleware);
app.route('/api/cache', cacheApi);

// Mount audit log routes (requires auth)
app.use('/api/audit/*', authMiddleware);
app.route('/api/audit', auditApi);

// Mount templates API (requires auth for write operations)
app.use('/api/templates/*', authMiddleware);
app.route('/api/templates', templatesApi);

// Mount webhook subscriptions API (requires auth)
app.use('/api/webhooks/subscriptions/*', authMiddleware);
app.route('/api/webhooks/subscriptions', webhookSubscriptionsApi);

// Mount SSE streaming API (optional auth - allows public event streaming)
app.use('/api/sse/events', optionalAuthMiddleware);
app.route('/api/sse', sseApi);

// Mount enterprise APIs (requires auth and permissions)
app.use('/api/tenants/*', authMiddleware);
app.route('/api/tenants', tenantsApi);

app.use('/api/rbac/*', authMiddleware);
app.route('/api/rbac', rbacApi);

app.use('/api/usage-metrics/*', authMiddleware);
app.route('/api/usage-metrics', usageApi);

// Mount Docker MCP management routes (requires auth)
app.use('/api/docker/*', authMiddleware);
app.route('/api/docker', dockerApi);

app.use('/api/analytics/*', authMiddleware);
app.route('/api/analytics', analyticsApi);

// Mount Prometheus metrics endpoint (public - standard for metrics scraping)
app.route('/metrics', prometheusApi);

// Mount monitoring routes (public for dashboard visibility)
app.use('/api/monitor/*', optionalAuthMiddleware);
app.route('/api/monitor', monitorApi);

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public' }));

// 404 handler for unmatched API routes
app.notFound(notFoundHandler);

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

  // Initialize response cache (after migrations)
  logger.info('Initializing response cache...');
  initializeCache();
  logger.info('Response cache initialized');

  // Initialize enhanced circuit breaker (after migrations)
  logger.info('Initializing enhanced circuit breaker...');
  initializeCircuitBreaker();
  logger.info('Enhanced circuit breaker initialized');

  // Initialize audit logger (after migrations)
  logger.info('Initializing audit logger...');
  initializeAuditLogger(serverDatabase.getDatabase());
  logger.info('Audit logger initialized');

  // Initialize RBAC system (after migrations)
  logger.info('Initializing RBAC system...');
  initializeRBAC(serverDatabase.getDatabase());
  logger.info('RBAC system initialized');

  // Initialize webhook store and delivery service (after migrations)
  logger.info('Initializing webhook service...');
  initializeWebhookStore(serverDatabase.getDatabase());
  webhookDeliveryService.start();
  logger.info('Webhook service initialized');

  // Register built-in server templates
  logger.info('Registering built-in templates...');
  registerBuiltInTemplates();
  logger.info('Built-in templates registered');

  // Load servers from config file if present
  const loadedCount = loadServersFromConfig();
  if (loadedCount > 0) {
    logger.info({ loadedCount }, 'Servers seeded from config file');
  }

  // Auto-connect to enabled servers
  const servers = serverDatabase.getAllServers(true);
  logger.info({ serverCount: servers.length }, 'Found enabled servers');

  for (const server of servers) {
    // Check for required environment variables before attempting to connect
    const requiredEnvVars = server.metadata.requiresEnv as string[] | undefined;
    if (requiredEnvVars && requiredEnvVars.length > 0) {
      const missingVars = requiredEnvVars.filter((v) => !process.env[v] || process.env[v]?.startsWith('your_'));
      if (missingVars.length > 0) {
        logger.warn(
          { serverId: server.id, serverName: server.name, missingVars },
          'Skipping server - missing required environment variables'
        );
        continue;
      }
    }

    try {
      logger.info({ serverId: server.id, serverName: server.name }, 'Auto-connecting to server');
      await connectionPool.connect(server);
      await toolRegistry.registerServer(server);

      // Discover and register resources and prompts
      const client = connectionPool.getClient(server.id);
      if (client) {
        // Register resources
        try {
          const { listResources } = await import('./mcp/client.js');
          const resources = await listResources(client);
          resourceRegistry.registerResources(server, resources);
          logger.info(
            { serverId: server.id, serverName: server.name, resourceCount: resources.length },
            'Resources registered'
          );
        } catch (error) {
          logger.warn(
            { serverId: server.id, serverName: server.name, error },
            'Failed to register resources (server may not support resources)'
          );
        }

        // Register prompts
        try {
          const { listPrompts } = await import('./mcp/client.js');
          const prompts = await listPrompts(client);
          promptRegistry.registerPrompts(server, prompts);
          logger.info(
            { serverId: server.id, serverName: server.name, promptCount: prompts.length },
            'Prompts registered'
          );
        } catch (error) {
          logger.warn(
            { serverId: server.id, serverName: server.name, error },
            'Failed to register prompts (server may not support prompts)'
          );
        }
      }
    } catch (error) {
      logger.error(
        { serverId: server.id, serverName: server.name, error },
        'Failed to auto-connect to server'
      );
    }
  }

  const toolCount = toolRegistry.getToolCount();
  const resourceCount = resourceRegistry.getResourceCount();
  const promptCount = promptRegistry.getPromptCount();
  logger.info({ toolCount, resourceCount, promptCount }, 'Tools, resources, and prompts registered');
}

// Register shutdown handlers with priority (lower = first)
shutdownManager.register('webhook-service', async () => {
  webhookDeliveryService.stop();
}, 10, 5000);

shutdownManager.register('cache', async () => {
  shutdownCache();
}, 20, 3000);

shutdownManager.register('rate-limiter', async () => {
  shutdownRateLimiter();
}, 30, 3000);

shutdownManager.register('connection-pool', async () => {
  await connectionPool.disconnectAll();
}, 40, 10000);

shutdownManager.register('database', async () => {
  serverDatabase.close();
}, 50, 5000);

// Setup signal handlers for graceful shutdown
shutdownManager.setupSignalHandlers();

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
          resources: `http://localhost:${info.port}/api/resources (auth required)`,
          prompts: `http://localhost:${info.port}/api/prompts (auth required)`,
          search: `http://localhost:${info.port}/api/search (auth required)`,
          sampling: `http://localhost:${info.port}/api/sampling (auth required)`,
          workflows: `http://localhost:${info.port}/api/workflows (auth required)`,
          webhook: `http://localhost:${info.port}/api/webhook (auth required)`,
          groups: `http://localhost:${info.port}/api/groups (auth required)`,
          favorites: `http://localhost:${info.port}/api/favorites (auth required)`,
          usage: `http://localhost:${info.port}/api/usage (auth required)`,
          cache: `http://localhost:${info.port}/api/cache (auth required)`,
          audit: `http://localhost:${info.port}/api/audit (auth required)`,
          templates: `http://localhost:${info.port}/api/templates (auth required)`,
          webhooks: `http://localhost:${info.port}/api/webhooks/subscriptions (auth required)`,
          sse: `http://localhost:${info.port}/api/sse/events (auth required)`,
          tenants: `http://localhost:${info.port}/api/tenants (auth + tenants:read)`,
          rbac: `http://localhost:${info.port}/api/rbac (auth + rbac:read)`,
          usageMetrics: `http://localhost:${info.port}/api/usage-metrics (auth + usage:read)`,
          analytics: `http://localhost:${info.port}/api/analytics (auth + analytics:read)`,
          metrics: `http://localhost:${info.port}/metrics`,
          monitor: `http://localhost:${info.port}/api/monitor`,
          dashboard: `http://localhost:${info.port}/api/monitor/dashboard`,
          analyticsDashboard: `http://localhost:${info.port}/analytics.html`,
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
