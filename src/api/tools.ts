import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse, ToolSearchOptions } from '../core/types.js';
import { toolRegistry } from '../core/registry.js';
import { toolRouter } from '../core/router.js';
import { usageHistoryStore } from '../storage/usageHistory.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-tools' });

export const toolsApi = new Hono();

// Tool invocation schema
const InvokeToolSchema = z.object({
  params: z.record(z.unknown()).default({}),
});

// Batch invocation schema
const BatchInvokeSchema = z.object({
  invocations: z.array(
    z.object({
      toolName: z.string(),
      params: z.record(z.unknown()).default({}),
    })
  ),
});

// Search query params schema
const SearchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  server: z.string().optional(),
  sortBy: z.enum(['name', 'usage', 'recent']).optional().default('name'),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

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

// Extract API key ID from context (set by auth middleware)
function getApiKeyId(c: any): string | null {
  const apiKey = c.get('apiKey');
  return apiKey?.id || null;
}

// GET /tools/categories - Get all categories with counts
toolsApi.get('/categories', (c) => {
  const categories = toolRegistry.getCategories();
  return c.json(apiResponse({
    categories,
    count: categories.length,
  }));
});

// GET /tools/tags - Get all tags with counts
toolsApi.get('/tags', (c) => {
  const tags = toolRegistry.getAllTags();
  return c.json(apiResponse({
    tags,
    count: tags.length,
  }));
});

// GET /tools/stats - Get tool statistics
toolsApi.get('/stats', (c) => {
  const stats = toolRegistry.getStats();
  return c.json(apiResponse(stats));
});

// GET /tools - List all tools with optional filters
toolsApi.get('/', (c) => {
  try {
    const rawQuery = {
      q: c.req.query('q'),
      category: c.req.query('category'),
      tags: c.req.query('tags'),
      server: c.req.query('server'),
      sortBy: c.req.query('sortBy') || 'name',
      limit: c.req.query('limit') || '50',
      offset: c.req.query('offset') || '0',
    };

    const params = SearchQuerySchema.parse(rawQuery);

    const searchOptions: ToolSearchOptions = {
      query: params.q,
      category: params.category,
      tags: params.tags ? params.tags.split(',').map((t) => t.trim()) : undefined,
      server: params.server,
      sortBy: params.sortBy,
      limit: params.limit,
      offset: params.offset,
    };

    const result = toolRegistry.searchToolsAdvanced(searchOptions);

    return c.json(apiResponse({
      tools: result.tools,
      count: result.tools.length,
      total: result.total,
      categories: result.categories,
      pagination: {
        limit: params.limit,
        offset: params.offset,
        hasMore: params.offset + result.tools.length < result.total,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Invalid query parameters: ${error.message}`));
    }
    throw error;
  }
});

// GET /tools/:name - Get tool by name
toolsApi.get('/:name{.+}', (c) => {
  const name = c.req.param('name');
  const tool = toolRegistry.findTool(name);

  if (!tool) {
    c.status(404);
    return c.json(errorResponse(`Tool not found: ${name}`));
  }

  return c.json(apiResponse(tool));
});

// POST /tools/:name/invoke - Invoke a tool
toolsApi.post('/:name{.+}/invoke', async (c) => {
  const name = c.req.param('name');
  const apiKeyId = getApiKeyId(c);

  try {
    const body = await c.req.json();
    const { params } = InvokeToolSchema.parse(body);

    logger.info({ toolName: name, apiKeyId }, 'Tool invocation requested via API');

    const result = await toolRouter.invoke(name, params as Record<string, unknown>, apiKeyId || undefined);

    // Record usage history if we have an API key
    if (apiKeyId && result.serverId) {
      try {
        usageHistoryStore.recordUsage(
          apiKeyId,
          result.toolName || name,
          result.serverId,
          result.success,
          result.durationMs,
          result.error,
          params as Record<string, unknown>
        );
      } catch (usageError) {
        // Log but don't fail the request if usage recording fails
        logger.warn({ error: usageError }, 'Failed to record usage history');
      }
    }

    if (!result.success) {
      // Check if this is a rate limit error
      if (result.error?.includes('Rate limit exceeded')) {
        c.status(429);
        if (result.rateLimit) {
          c.header('Retry-After', String(Math.ceil((new Date(result.rateLimit.resetAt.minute).getTime() - Date.now()) / 1000)));
          c.header('X-RateLimit-Remaining-Minute', String(result.rateLimit.remaining.perMinute));
          c.header('X-RateLimit-Remaining-Day', String(result.rateLimit.remaining.perDay));
        }
        return c.json({
          success: false,
          error: result.error,
          rateLimit: result.rateLimit,
          timestamp: new Date().toISOString(),
        });
      }
      c.status(500);
      return c.json(errorResponse(result.error || 'Tool invocation failed'));
    }

    // Include rate limit info in successful responses
    const response: Record<string, unknown> = {
      result: result.data,
      serverId: result.serverId,
      toolName: result.toolName,
      durationMs: result.durationMs,
    };

    if (result.rateLimit) {
      response.rateLimit = result.rateLimit;
      c.header('X-RateLimit-Remaining-Minute', String(result.rateLimit.remaining.perMinute));
      c.header('X-RateLimit-Remaining-Day', String(result.rateLimit.remaining.perDay));
    }

    return c.json(apiResponse(response));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// POST /tools/batch - Batch invoke multiple tools
toolsApi.post('/batch', async (c) => {
  const apiKeyId = getApiKeyId(c);

  try {
    const body = await c.req.json();
    const { invocations } = BatchInvokeSchema.parse(body);

    logger.info({ count: invocations.length, apiKeyId }, 'Batch tool invocation requested via API');

    const results = await toolRouter.invokeBatch(
      invocations.map(({ toolName, params }) => ({
        toolName,
        params: params as Record<string, unknown>,
      })),
      apiKeyId || undefined
    );

    // Record usage history for each invocation
    if (apiKeyId) {
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const invocation = invocations[i];
        if (result.serverId) {
          try {
            usageHistoryStore.recordUsage(
              apiKeyId,
              result.toolName || invocation.toolName,
              result.serverId,
              result.success,
              result.durationMs,
              result.error,
              invocation.params as Record<string, unknown>
            );
          } catch (usageError) {
            logger.warn({ error: usageError }, 'Failed to record batch usage history');
          }
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return c.json(apiResponse({
      results,
      summary: {
        total: results.length,
        success: successCount,
        failed: results.length - successCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});
