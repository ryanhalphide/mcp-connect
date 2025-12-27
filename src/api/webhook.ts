import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { toolRouter } from '../core/router.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-webhook' });

export const webhookApi = new Hono();

// Webhook payload schema
const WebhookPayloadSchema = z.object({
  event: z.string(),
  data: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
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

// POST /webhook/test - Test webhook endpoint
webhookApi.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const payload = WebhookPayloadSchema.parse(body);

    logger.info({ event: payload.event, hasData: !!payload.data }, 'Webhook received');

    // Echo back the webhook data
    const response = {
      received: true,
      event: payload.event,
      data: payload.data,
      receivedAt: new Date().toISOString(),
      headers: {
        'content-type': c.req.header('content-type'),
        'user-agent': c.req.header('user-agent'),
      },
    };

    return c.json(apiResponse(response));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    logger.error({ error }, 'Webhook processing error');
    c.status(500);
    return c.json(errorResponse('Webhook processing failed'));
  }
});

// POST /webhook/invoke - Webhook that invokes an MCP tool
webhookApi.post('/invoke/:toolName{.+}', async (c) => {
  const toolName = c.req.param('toolName');

  try {
    const body = await c.req.json();

    logger.info({ toolName, hasData: !!body }, 'Webhook tool invocation');

    // Invoke the tool with webhook data as parameters
    // The toolRouter expects parameters directly, not wrapped in params
    const result = await toolRouter.invoke(toolName, body as Record<string, unknown>);

    if (!result.success) {
      c.status(500);
      return c.json(errorResponse(result.error || 'Tool invocation failed'));
    }

    return c.json(apiResponse({
      result: result.data,
      toolName: result.toolName,
      serverId: result.serverId,
      durationMs: result.durationMs,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage, toolName }, 'Webhook tool invocation error');
    c.status(500);
    return c.json(errorResponse(`Webhook tool invocation failed: ${errorMessage}`));
  }
});

// GET /webhook/ping - Health check for webhook endpoint
webhookApi.get('/ping', (c) => {
  return c.json(apiResponse({
    status: 'ok',
    message: 'Webhook endpoint is alive',
  }));
});

// POST /webhook/batch - Batch webhook processing
webhookApi.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const events = z.array(WebhookPayloadSchema).parse(body);

    logger.info({ count: events.length }, 'Batch webhook received');

    const results = events.map((event) => ({
      event: event.event,
      processed: true,
      receivedAt: new Date().toISOString(),
    }));

    return c.json(apiResponse({
      processed: results.length,
      results,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    logger.error({ error }, 'Batch webhook processing error');
    c.status(500);
    return c.json(errorResponse('Batch webhook processing failed'));
  }
});
