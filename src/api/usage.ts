/**
 * Usage Metrics API
 * REST endpoints for accessing usage and cost tracking data
 */

import { Hono } from 'hono';
import { serverDatabase } from '../storage/db.js';
import { UsageTracker } from '../observability/usageTracker.js';
import { checkPermission, checkAnyPermission } from '../rbac/enforcer.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'usage-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string) {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

export const usageApi = new Hono();

// Initialize usage tracker
const db = serverDatabase.getDatabase();
const usageTracker = new UsageTracker(db);

/**
 * Get usage summary
 * GET /api/usage/summary
 */
usageApi.get('/summary', checkPermission('usage:read'), (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const apiKeyId = c.req.query('apiKeyId');
  const tenantId = c.req.query('tenantId');
  const serverId = c.req.query('serverId');

  const summary = usageTracker.getSummary({
    startDate,
    endDate,
    apiKeyId,
    tenantId,
    serverId,
  });

  logger.info({ period: summary.period, totalCost: summary.totalCost }, 'Retrieved usage summary');

  return c.json(apiResponse(summary));
});

/**
 * Get usage time series
 * GET /api/usage/timeseries
 */
usageApi.get('/timeseries', checkPermission('usage:read'), (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const apiKeyId = c.req.query('apiKeyId');
  const tenantId = c.req.query('tenantId');
  const serverId = c.req.query('serverId');
  const interval = (c.req.query('interval') || 'day') as 'hour' | 'day' | 'week' | 'month';

  if (!['hour', 'day', 'week', 'month'].includes(interval)) {
    return c.json(
      apiResponse({
        error: 'Invalid interval parameter',
        code: 'VALIDATION_ERROR',
        details: 'interval must be one of: hour, day, week, month',
      }),
      400
    );
  }

  const timeSeries = usageTracker.getTimeSeries({
    startDate,
    endDate,
    apiKeyId,
    tenantId,
    serverId,
    interval,
  });

  logger.info({ count: timeSeries.length, interval }, 'Retrieved usage time series');

  return c.json(
    apiResponse({
      timeSeries,
      interval,
      count: timeSeries.length,
    })
  );
});

/**
 * Get top consumers
 * GET /api/usage/top/:by
 */
usageApi.get('/top/:by', checkPermission('usage:read'), (c) => {
  const by = c.req.param('by') as 'tenant' | 'api_key' | 'server';

  if (!['tenant', 'api_key', 'server'].includes(by)) {
    return c.json(
      apiResponse({
        error: 'Invalid consumer type',
        code: 'VALIDATION_ERROR',
        details: 'by must be one of: tenant, api_key, server',
      }),
      400
    );
  }

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  const topConsumers = usageTracker.getTopConsumers(by, {
    startDate,
    endDate,
    limit,
  });

  logger.info({ by, count: topConsumers.length }, 'Retrieved top consumers');

  return c.json(
    apiResponse({
      by,
      consumers: topConsumers,
      count: topConsumers.length,
    })
  );
});

/**
 * Get usage for specific tenant
 * GET /api/usage/tenant/:id
 */
usageApi.get('/tenant/:id', checkAnyPermission(['usage:read', 'tenants:read']), (c) => {
  const tenantId = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const interval = (c.req.query('interval') || 'day') as 'hour' | 'day' | 'week' | 'month';

  // Get summary
  const summary = usageTracker.getSummary({
    tenantId,
    startDate,
    endDate,
  });

  // Get time series
  const timeSeries = usageTracker.getTimeSeries({
    tenantId,
    startDate,
    endDate,
    interval,
  });

  logger.info({ tenantId, totalCost: summary.totalCost }, 'Retrieved tenant usage');

  return c.json(
    apiResponse({
      tenantId,
      summary,
      timeSeries,
      interval,
    })
  );
});

/**
 * Get usage for specific API key
 * GET /api/usage/key/:id
 */
usageApi.get('/key/:id', checkAnyPermission(['usage:read', 'keys:read']), (c) => {
  const apiKeyId = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const interval = (c.req.query('interval') || 'day') as 'hour' | 'day' | 'week' | 'month';

  // Get summary
  const summary = usageTracker.getSummary({
    apiKeyId,
    startDate,
    endDate,
  });

  // Get time series
  const timeSeries = usageTracker.getTimeSeries({
    apiKeyId,
    startDate,
    endDate,
    interval,
  });

  logger.info({ apiKeyId, totalCost: summary.totalCost }, 'Retrieved API key usage');

  return c.json(
    apiResponse({
      apiKeyId,
      summary,
      timeSeries,
      interval,
    })
  );
});

/**
 * Get usage for specific server
 * GET /api/usage/server/:id
 */
usageApi.get('/server/:id', checkAnyPermission(['usage:read', 'servers:read']), (c) => {
  const serverId = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const interval = (c.req.query('interval') || 'day') as 'hour' | 'day' | 'week' | 'month';

  // Get summary
  const summary = usageTracker.getSummary({
    serverId,
    startDate,
    endDate,
  });

  // Get time series
  const timeSeries = usageTracker.getTimeSeries({
    serverId,
    startDate,
    endDate,
    interval,
  });

  logger.info({ serverId, totalCost: summary.totalCost }, 'Retrieved server usage');

  return c.json(
    apiResponse({
      serverId,
      summary,
      timeSeries,
      interval,
    })
  );
});

/**
 * Export usage data as CSV
 * GET /api/usage/export
 */
usageApi.get('/export', checkPermission('usage:read'), (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const tenantId = c.req.query('tenantId');
  const interval = (c.req.query('interval') || 'day') as 'hour' | 'day' | 'week' | 'month';

  const timeSeries = usageTracker.getTimeSeries({
    startDate,
    endDate,
    tenantId,
    interval,
  });

  // Generate CSV
  const headers = ['Period', 'Actions', 'Tokens', 'Cost (Credits)'];
  const rows = timeSeries.map((item) => [item.period, item.actions.toString(), item.tokens.toString(), item.cost.toFixed(4)]);

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  logger.info({ count: timeSeries.length }, 'Exported usage metrics');

  return c.text(csv, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="usage-metrics-${new Date().toISOString().split('T')[0]}.csv"`,
  });
});

/**
 * Clean up old usage metrics
 * DELETE /api/usage/cleanup
 */
usageApi.delete('/cleanup', checkPermission('usage:read'), async (c) => {
  const daysToKeep = parseInt(c.req.query('daysToKeep') || '90', 10);

  if (daysToKeep < 7) {
    return c.json(
      apiResponse({
        error: 'Invalid daysToKeep parameter',
        code: 'VALIDATION_ERROR',
        details: 'Must keep at least 7 days of usage metrics',
      }),
      400
    );
  }

  const deletedCount = usageTracker.cleanup(daysToKeep);

  logger.info({ deletedCount, daysToKeep }, 'Cleaned up usage metrics');

  return c.json(
    apiResponse({
      message: 'Usage metrics cleaned up successfully',
      deletedCount,
      daysToKeep,
    })
  );
});
