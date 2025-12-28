import crypto from 'crypto';
import { createChildLogger } from '../observability/logger.js';
import { appEvents, type AppEvent, type EventType, ALL_EVENT_TYPES } from './events.js';
import { getWebhookStore, type WebhookSubscription } from '../storage/webhooks.js';

const logger = createChildLogger({ module: 'webhook-delivery' });

interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  durationMs: number;
}

/**
 * Webhook delivery service
 * Handles delivering events to registered webhook endpoints
 */
class WebhookDeliveryService {
  private isListening = false;
  private retryTimeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start listening for events and delivering webhooks
   */
  start(): void {
    if (this.isListening) return;

    logger.info('Starting webhook delivery service');

    // Subscribe to all event types
    for (const eventType of ALL_EVENT_TYPES) {
      appEvents.on(eventType, (event) => {
        this.handleEvent(eventType, event).catch((err) => {
          logger.error({ error: err, eventType }, 'Error handling event');
        });
      });
    }

    this.isListening = true;
    logger.info('Webhook delivery service started');
  }

  /**
   * Stop the delivery service
   */
  stop(): void {
    if (!this.isListening) return;

    // Clear all pending retries
    for (const timeout of this.retryTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.retryTimeouts.clear();

    this.isListening = false;
    logger.info('Webhook delivery service stopped');
  }

  /**
   * Handle an event and deliver to subscribers
   */
  private async handleEvent(eventType: EventType, event: AppEvent): Promise<void> {
    try {
      const store = getWebhookStore();
      const serverId = 'serverId' in event ? event.serverId : undefined;
      const subscriptions = store.getSubscriptionsForEvent(eventType, serverId);

      if (subscriptions.length === 0) {
        logger.debug({ eventType }, 'No subscribers for event');
        return;
      }

      logger.info(
        { eventType, subscriberCount: subscriptions.length },
        'Delivering event to subscribers'
      );

      // Deliver to all subscribers in parallel
      const deliveryPromises = subscriptions.map((sub) =>
        this.deliverToSubscription(sub, eventType, event)
      );

      await Promise.allSettled(deliveryPromises);
    } catch (error) {
      logger.error({ error, eventType }, 'Error handling event');
    }
  }

  /**
   * Deliver an event to a specific subscription
   */
  private async deliverToSubscription(
    subscription: WebhookSubscription,
    eventType: EventType,
    event: AppEvent
  ): Promise<void> {
    const store = getWebhookStore();
    const payload = this.buildPayload(eventType, event);

    try {
      const result = await this.deliver(subscription, payload);

      // Record the delivery
      store.recordDelivery(
        subscription.id,
        eventType,
        payload,
        result.success ? 'success' : 'failed',
        result.statusCode,
        result.responseBody,
        result.error
      );

      if (result.success) {
        logger.info(
          { subscriptionId: subscription.id, eventType, statusCode: result.statusCode },
          'Webhook delivered successfully'
        );
      } else {
        logger.warn(
          {
            subscriptionId: subscription.id,
            eventType,
            error: result.error,
            statusCode: result.statusCode,
          },
          'Webhook delivery failed'
        );

        // Schedule retry if configured
        if (subscription.retryCount > 0) {
          this.scheduleRetry(subscription, eventType, payload, 1);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      store.recordDelivery(
        subscription.id,
        eventType,
        payload,
        'failed',
        undefined,
        undefined,
        errorMessage
      );

      logger.error(
        { subscriptionId: subscription.id, eventType, error: errorMessage },
        'Webhook delivery error'
      );
    }
  }

  /**
   * Build the webhook payload
   */
  private buildPayload(eventType: EventType, event: AppEvent): Record<string, unknown> {
    return {
      event: eventType,
      timestamp: event.timestamp.toISOString(),
      data: {
        ...event,
        type: undefined, // Remove redundant type field
        timestamp: undefined, // Remove timestamp from data (already at top level)
      },
    };
  }

  /**
   * Deliver a payload to a webhook URL
   */
  private async deliver(
    subscription: WebhookSubscription,
    payload: Record<string, unknown>
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const body = JSON.stringify(payload);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MCP-Connect-Webhook/1.0',
      'X-Webhook-ID': subscription.id,
      'X-Event-Type': payload.event as string,
    };

    // Add signature if secret is configured
    if (subscription.secret) {
      const signature = this.signPayload(body, subscription.secret);
      headers['X-Signature-256'] = `sha256=${signature}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), subscription.timeoutMs);

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text();

      return {
        success: response.ok,
        statusCode: response.status,
        responseBody: responseBody.substring(0, 1000), // Limit response size
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${subscription.timeoutMs}ms`,
          durationMs,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      };
    }
  }

  /**
   * Sign payload with HMAC-SHA256
   */
  private signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Schedule a retry for a failed delivery
   */
  private scheduleRetry(
    subscription: WebhookSubscription,
    eventType: EventType,
    payload: Record<string, unknown>,
    attempt: number
  ): void {
    if (attempt > subscription.retryCount) {
      logger.warn(
        { subscriptionId: subscription.id, eventType, attempts: attempt },
        'Max retries exceeded'
      );
      return;
    }

    const delayMs = subscription.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
    const retryKey = `${subscription.id}-${Date.now()}`;

    logger.info(
      { subscriptionId: subscription.id, eventType, attempt, delayMs },
      'Scheduling retry'
    );

    const timeout = setTimeout(async () => {
      this.retryTimeouts.delete(retryKey);

      const result = await this.deliver(subscription, payload);
      const store = getWebhookStore();

      if (result.success) {
        store.recordDelivery(
          subscription.id,
          eventType,
          payload,
          'success',
          result.statusCode,
          result.responseBody
        );

        logger.info(
          { subscriptionId: subscription.id, eventType, attempt },
          'Retry successful'
        );
      } else {
        store.recordDelivery(
          subscription.id,
          eventType,
          payload,
          attempt >= subscription.retryCount ? 'failed' : 'pending',
          result.statusCode,
          result.responseBody,
          result.error
        );

        if (attempt < subscription.retryCount) {
          this.scheduleRetry(subscription, eventType, payload, attempt + 1);
        }
      }
    }, delayMs);

    this.retryTimeouts.set(retryKey, timeout);
  }

  /**
   * Manually trigger a test delivery
   */
  async testDelivery(
    subscription: WebhookSubscription
  ): Promise<DeliveryResult> {
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery',
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
      },
    };

    return this.deliver(subscription, testPayload);
  }
}

// Singleton instance
export const webhookDeliveryService = new WebhookDeliveryService();
