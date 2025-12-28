import { Hono } from 'hono';
import { z } from 'zod';
import { getCache } from '../core/cacheFactory.js';
import { createChildLogger } from '../observability/logger.js';
import type { ApiResponse } from '../core/types.js';

const logger = createChildLogger({ module: 'api-cache' });

export const cacheApi = new Hono();

// Helper to create API response
function apiResponse<T>(data: T, success = true): ApiResponse<T> {
  return {
    success,
    data,
    timestamp: new Date().toISOString(),
  };
}

function errorResponse(error: string): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Invalidate cache schema
const InvalidateCacheSchema = z.object({
  serverId: z.string().optional(),
  type: z.enum(['tool', 'resource', 'prompt']).optional(),
  name: z.string().optional(),
});

// GET /cache/stats - Get cache statistics
cacheApi.get('/stats', (c) => {
  try {
    const cache = getCache();
    const stats = cache.getStats();

    return c.json(
      apiResponse({
        ...stats,
        memoryCapacity: 1000,
        memoryUtilization: Math.round((stats.memorySize / 1000) * 100),
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get cache stats');
    c.status(500);
    return c.json(errorResponse('Failed to get cache statistics'));
  }
});

// POST /cache/invalidate - Invalidate cache entries
cacheApi.post('/invalidate', async (c) => {
  try {
    const body = await c.req.json();
    const options = InvalidateCacheSchema.parse(body);

    const cache = getCache();
    const deletedCount = await cache.invalidate(options);

    logger.info({ deletedCount, options }, 'Cache invalidated via API');

    return c.json(
      apiResponse({
        deletedCount,
        message: `Invalidated ${deletedCount} cache entries`,
      })
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to invalidate cache');
    c.status(500);
    return c.json(errorResponse('Failed to invalidate cache'));
  }
});

// POST /cache/clear - Clear all cache entries (admin only)
cacheApi.post('/clear', async (c) => {
  try {
    const cache = getCache();
    const deletedCount = await cache.invalidate({});

    logger.warn({ deletedCount }, 'All cache cleared via API');

    return c.json(
      apiResponse({
        deletedCount,
        message: `Cleared all ${deletedCount} cache entries`,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to clear cache');
    c.status(500);
    return c.json(errorResponse('Failed to clear cache'));
  }
});
