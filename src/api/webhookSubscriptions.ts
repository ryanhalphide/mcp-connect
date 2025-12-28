import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { ALL_EVENT_TYPES, type EventType } from '../core/events.js';
import { getWebhookStore } from '../storage/webhooks.js';
import { webhookDeliveryService } from '../core/webhookDelivery.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-webhook-subscriptions' });

export const webhookSubscriptionsApi = new Hono();

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

// Create subscription schema
const CreateSubscriptionSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.enum(ALL_EVENT_TYPES as [EventType, ...EventType[]])).min(1),
  secret: z.string().min(16).max(256).optional(),
  enabled: z.boolean().optional().default(true),
  serverFilter: z.array(z.string().uuid()).optional(),
  retryCount: z.number().int().min(0).max(10).optional().default(3),
  retryDelayMs: z.number().int().min(100).max(60000).optional().default(1000),
  timeoutMs: z.number().int().min(1000).max(30000).optional().default(10000),
});

// Update subscription schema
const UpdateSubscriptionSchema = CreateSubscriptionSchema.partial();

// GET /webhooks/subscriptions - List all subscriptions
webhookSubscriptionsApi.get('/', (c) => {
  try {
    const enabledOnly = c.req.query('enabled') === 'true';
    const store = getWebhookStore();
    const subscriptions = store.getAllSubscriptions(enabledOnly);

    return c.json(apiResponse({
      subscriptions,
      count: subscriptions.length,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to list subscriptions');
    c.status(500);
    return c.json(errorResponse('Failed to list subscriptions'));
  }
});

// GET /webhooks/subscriptions/events - List all available event types
webhookSubscriptionsApi.get('/events', (c) => {
  return c.json(apiResponse({
    events: ALL_EVENT_TYPES,
    categories: {
      server: ALL_EVENT_TYPES.filter((e) => e.startsWith('server.')),
      tool: ALL_EVENT_TYPES.filter((e) => e.startsWith('tool.')),
      circuit: ALL_EVENT_TYPES.filter((e) => e.startsWith('circuit.')),
    },
  }));
});

// GET /webhooks/subscriptions/:id - Get a specific subscription
webhookSubscriptionsApi.get('/:id', (c) => {
  try {
    const id = c.req.param('id');
    const store = getWebhookStore();
    const subscription = store.getSubscription(id);

    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    return c.json(apiResponse(subscription));
  } catch (error) {
    logger.error({ error }, 'Failed to get subscription');
    c.status(500);
    return c.json(errorResponse('Failed to get subscription'));
  }
});

// POST /webhooks/subscriptions - Create a new subscription
webhookSubscriptionsApi.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateSubscriptionSchema.parse(body);
    const store = getWebhookStore();

    const subscription = store.createSubscription({
      name: validated.name,
      url: validated.url,
      events: validated.events,
      secret: validated.secret,
      enabled: validated.enabled,
      serverFilter: validated.serverFilter,
      retryCount: validated.retryCount,
      retryDelayMs: validated.retryDelayMs,
      timeoutMs: validated.timeoutMs,
    });

    logger.info({ subscriptionId: subscription.id, name: subscription.name }, 'Subscription created');

    c.status(201);
    return c.json(apiResponse(subscription));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to create subscription');
    c.status(500);
    return c.json(errorResponse('Failed to create subscription'));
  }
});

// PUT /webhooks/subscriptions/:id - Update a subscription
webhookSubscriptionsApi.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const validated = UpdateSubscriptionSchema.parse(body);
    const store = getWebhookStore();

    const subscription = store.updateSubscription(id, validated);

    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    logger.info({ subscriptionId: id }, 'Subscription updated');

    return c.json(apiResponse(subscription));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to update subscription');
    c.status(500);
    return c.json(errorResponse('Failed to update subscription'));
  }
});

// DELETE /webhooks/subscriptions/:id - Delete a subscription
webhookSubscriptionsApi.delete('/:id', (c) => {
  try {
    const id = c.req.param('id');
    const store = getWebhookStore();

    const deleted = store.deleteSubscription(id);

    if (!deleted) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    logger.info({ subscriptionId: id }, 'Subscription deleted');

    return c.json(apiResponse({ deleted: true }));
  } catch (error) {
    logger.error({ error }, 'Failed to delete subscription');
    c.status(500);
    return c.json(errorResponse('Failed to delete subscription'));
  }
});

// GET /webhooks/subscriptions/:id/deliveries - Get delivery history
webhookSubscriptionsApi.get('/:id/deliveries', (c) => {
  try {
    const id = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const status = c.req.query('status');
    const store = getWebhookStore();

    // Check subscription exists
    const subscription = store.getSubscription(id);
    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    const deliveries = store.getDeliveries(id, { limit, status });

    return c.json(apiResponse({
      deliveries,
      count: deliveries.length,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get deliveries');
    c.status(500);
    return c.json(errorResponse('Failed to get deliveries'));
  }
});

// GET /webhooks/subscriptions/:id/stats - Get delivery stats
webhookSubscriptionsApi.get('/:id/stats', (c) => {
  try {
    const id = c.req.param('id');
    const store = getWebhookStore();

    // Check subscription exists
    const subscription = store.getSubscription(id);
    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    const stats = store.getStats(id);

    return c.json(apiResponse(stats));
  } catch (error) {
    logger.error({ error }, 'Failed to get stats');
    c.status(500);
    return c.json(errorResponse('Failed to get stats'));
  }
});

// POST /webhooks/subscriptions/:id/test - Send a test delivery
webhookSubscriptionsApi.post('/:id/test', async (c) => {
  try {
    const id = c.req.param('id');
    const store = getWebhookStore();

    const subscription = store.getSubscription(id);
    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    const result = await webhookDeliveryService.testDelivery(subscription);

    logger.info(
      { subscriptionId: id, success: result.success, statusCode: result.statusCode },
      'Test delivery completed'
    );

    return c.json(apiResponse({
      success: result.success,
      statusCode: result.statusCode,
      responseBody: result.responseBody,
      error: result.error,
      durationMs: result.durationMs,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to send test delivery');
    c.status(500);
    return c.json(errorResponse('Failed to send test delivery'));
  }
});

// POST /webhooks/subscriptions/:id/enable - Enable a subscription
webhookSubscriptionsApi.post('/:id/enable', (c) => {
  try {
    const id = c.req.param('id');
    const store = getWebhookStore();

    const subscription = store.updateSubscription(id, { enabled: true });

    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    logger.info({ subscriptionId: id }, 'Subscription enabled');

    return c.json(apiResponse(subscription));
  } catch (error) {
    logger.error({ error }, 'Failed to enable subscription');
    c.status(500);
    return c.json(errorResponse('Failed to enable subscription'));
  }
});

// POST /webhooks/subscriptions/:id/disable - Disable a subscription
webhookSubscriptionsApi.post('/:id/disable', (c) => {
  try {
    const id = c.req.param('id');
    const store = getWebhookStore();

    const subscription = store.updateSubscription(id, { enabled: false });

    if (!subscription) {
      c.status(404);
      return c.json(errorResponse(`Subscription not found: ${id}`));
    }

    logger.info({ subscriptionId: id }, 'Subscription disabled');

    return c.json(apiResponse(subscription));
  } catch (error) {
    logger.error({ error }, 'Failed to disable subscription');
    c.status(500);
    return c.json(errorResponse('Failed to disable subscription'));
  }
});
