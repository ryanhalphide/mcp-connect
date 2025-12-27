import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { toolRegistry } from '../core/registry.js';
import { toolRouter } from '../core/router.js';
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

// GET /tools - List all tools
toolsApi.get('/', (c) => {
  const query = c.req.query('q');

  const tools = query
    ? toolRegistry.searchTools(query)
    : toolRegistry.getAllTools();

  return c.json(apiResponse({
    tools,
    count: tools.length,
    totalRegistered: toolRegistry.getToolCount(),
  }));
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

  try {
    const body = await c.req.json();
    const { params } = InvokeToolSchema.parse(body);

    logger.info({ toolName: name }, 'Tool invocation requested via API');

    const result = await toolRouter.invoke(name, params as Record<string, unknown>);

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
  try {
    const body = await c.req.json();
    const { invocations } = BatchInvokeSchema.parse(body);

    logger.info({ count: invocations.length }, 'Batch tool invocation requested via API');

    const results = await toolRouter.invokeBatch(
      invocations.map(({ toolName, params }) => ({
        toolName,
        params: params as Record<string, unknown>,
      }))
    );

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
