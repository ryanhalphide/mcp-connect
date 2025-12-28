import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { createChildLogger } from '../observability/logger.js';
import type { EventType } from '../core/events.js';

const logger = createChildLogger({ module: 'webhooks' });

export interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  events: EventType[];
  secret?: string;
  enabled: boolean;
  serverFilter?: string[]; // Optional: only trigger for specific servers
  retryCount: number;
  retryDelayMs: number;
  timeoutMs: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: EventType;
  payload: string; // JSON
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttemptAt?: Date;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: Date;
}

export interface WebhookStats {
  subscriptionId: string;
  totalDeliveries: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  avgResponseTimeMs: number;
  lastDeliveryAt?: Date;
}

/**
 * Webhook subscription storage
 */
export class WebhookStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    logger.info('Webhook store initialized');
  }

  /**
   * Create a new webhook subscription
   */
  createSubscription(
    data: Omit<WebhookSubscription, 'id' | 'createdAt' | 'updatedAt'>
  ): WebhookSubscription {
    const id = uuidv4();
    const now = new Date();

    const subscription: WebhookSubscription = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO webhook_subscriptions (
        id, name, url, events_json, secret, enabled,
        server_filter_json, retry_count, retry_delay_ms, timeout_ms,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      subscription.name,
      subscription.url,
      JSON.stringify(subscription.events),
      subscription.secret ?? null,
      subscription.enabled ? 1 : 0,
      subscription.serverFilter ? JSON.stringify(subscription.serverFilter) : null,
      subscription.retryCount,
      subscription.retryDelayMs,
      subscription.timeoutMs,
      now.toISOString(),
      now.toISOString()
    );

    logger.info({ subscriptionId: id, name: subscription.name }, 'Webhook subscription created');

    return subscription;
  }

  /**
   * Get a subscription by ID
   */
  getSubscription(id: string): WebhookSubscription | undefined {
    const stmt = this.db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return this.rowToSubscription(row);
  }

  /**
   * Get all subscriptions
   */
  getAllSubscriptions(enabledOnly = false): WebhookSubscription[] {
    const query = enabledOnly
      ? 'SELECT * FROM webhook_subscriptions WHERE enabled = 1 ORDER BY created_at DESC'
      : 'SELECT * FROM webhook_subscriptions ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToSubscription(row));
  }

  /**
   * Get subscriptions for a specific event type
   */
  getSubscriptionsForEvent(event: EventType, serverId?: string): WebhookSubscription[] {
    // Get all enabled subscriptions that listen for this event
    const subscriptions = this.getAllSubscriptions(true);

    return subscriptions.filter((sub) => {
      // Check if subscription listens for this event
      if (!sub.events.includes(event)) return false;

      // Check server filter if present
      if (sub.serverFilter && sub.serverFilter.length > 0 && serverId) {
        if (!sub.serverFilter.includes(serverId)) return false;
      }

      return true;
    });
  }

  /**
   * Update a subscription
   */
  updateSubscription(
    id: string,
    updates: Partial<Omit<WebhookSubscription, 'id' | 'createdAt' | 'updatedAt'>>
  ): WebhookSubscription | undefined {
    const existing = this.getSubscription(id);
    if (!existing) return undefined;

    const now = new Date();
    const updated: WebhookSubscription = {
      ...existing,
      ...updates,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      UPDATE webhook_subscriptions SET
        name = ?,
        url = ?,
        events_json = ?,
        secret = ?,
        enabled = ?,
        server_filter_json = ?,
        retry_count = ?,
        retry_delay_ms = ?,
        timeout_ms = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.name,
      updated.url,
      JSON.stringify(updated.events),
      updated.secret ?? null,
      updated.enabled ? 1 : 0,
      updated.serverFilter ? JSON.stringify(updated.serverFilter) : null,
      updated.retryCount,
      updated.retryDelayMs,
      updated.timeoutMs,
      now.toISOString(),
      id
    );

    logger.info({ subscriptionId: id }, 'Webhook subscription updated');

    return updated;
  }

  /**
   * Delete a subscription
   */
  deleteSubscription(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ subscriptionId: id }, 'Webhook subscription deleted');
      return true;
    }

    return false;
  }

  /**
   * Record a delivery attempt
   */
  recordDelivery(
    subscriptionId: string,
    event: EventType,
    payload: unknown,
    status: 'pending' | 'success' | 'failed',
    responseStatus?: number,
    responseBody?: string,
    error?: string
  ): WebhookDelivery {
    const id = uuidv4();
    const now = new Date();

    const delivery: WebhookDelivery = {
      id,
      subscriptionId,
      event,
      payload: JSON.stringify(payload),
      status,
      attempts: 1,
      lastAttemptAt: now,
      responseStatus,
      responseBody,
      error,
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO webhook_deliveries (
        id, subscription_id, event, payload, status, attempts,
        last_attempt_at, response_status, response_body, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      subscriptionId,
      event,
      delivery.payload,
      status,
      1,
      now.toISOString(),
      responseStatus ?? null,
      responseBody ?? null,
      error ?? null,
      now.toISOString()
    );

    return delivery;
  }

  /**
   * Update a delivery status
   */
  updateDeliveryStatus(
    id: string,
    status: 'pending' | 'success' | 'failed',
    responseStatus?: number,
    responseBody?: string,
    error?: string
  ): void {
    const now = new Date();

    const stmt = this.db.prepare(`
      UPDATE webhook_deliveries SET
        status = ?,
        attempts = attempts + 1,
        last_attempt_at = ?,
        response_status = ?,
        response_body = ?,
        error = ?
      WHERE id = ?
    `);

    stmt.run(
      status,
      now.toISOString(),
      responseStatus ?? null,
      responseBody ?? null,
      error ?? null,
      id
    );
  }

  /**
   * Get deliveries for a subscription
   */
  getDeliveries(
    subscriptionId: string,
    options: { limit?: number; status?: string } = {}
  ): WebhookDelivery[] {
    let query = 'SELECT * FROM webhook_deliveries WHERE subscription_id = ?';
    const params: unknown[] = [subscriptionId];

    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY created_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((row) => this.rowToDelivery(row));
  }

  /**
   * Get pending deliveries that need retry
   */
  getPendingDeliveries(_maxRetries: number): WebhookDelivery[] {
    const stmt = this.db.prepare(`
      SELECT d.*, s.retry_count as max_retries
      FROM webhook_deliveries d
      JOIN webhook_subscriptions s ON d.subscription_id = s.id
      WHERE d.status = 'pending' AND d.attempts <= s.retry_count
      ORDER BY d.created_at ASC
      LIMIT 100
    `);

    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToDelivery(row));
  }

  /**
   * Get stats for a subscription
   */
  getStats(subscriptionId: string): WebhookStats {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        MAX(last_attempt_at) as last_delivery_at
      FROM webhook_deliveries
      WHERE subscription_id = ?
    `);

    const row = stmt.get(subscriptionId) as Record<string, unknown> | undefined;

    return {
      subscriptionId,
      totalDeliveries: Number(row?.total ?? 0),
      successCount: Number(row?.success_count ?? 0),
      failedCount: Number(row?.failed_count ?? 0),
      pendingCount: Number(row?.pending_count ?? 0),
      avgResponseTimeMs: 0, // Would need response time tracking
      lastDeliveryAt: row?.last_delivery_at
        ? new Date(row.last_delivery_at as string)
        : undefined,
    };
  }

  /**
   * Clean up old deliveries
   */
  cleanupOldDeliveries(daysToKeep: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const stmt = this.db.prepare(`
      DELETE FROM webhook_deliveries WHERE created_at < ?
    `);

    const result = stmt.run(cutoff.toISOString());

    if (result.changes > 0) {
      logger.info({ deleted: result.changes }, 'Old webhook deliveries cleaned up');
    }

    return result.changes;
  }

  private rowToSubscription(row: Record<string, unknown>): WebhookSubscription {
    return {
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      events: JSON.parse(row.events_json as string) as EventType[],
      secret: row.secret as string | undefined,
      enabled: Boolean(row.enabled),
      serverFilter: row.server_filter_json
        ? (JSON.parse(row.server_filter_json as string) as string[])
        : undefined,
      retryCount: row.retry_count as number,
      retryDelayMs: row.retry_delay_ms as number,
      timeoutMs: row.timeout_ms as number,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private rowToDelivery(row: Record<string, unknown>): WebhookDelivery {
    return {
      id: row.id as string,
      subscriptionId: row.subscription_id as string,
      event: row.event as EventType,
      payload: row.payload as string,
      status: row.status as 'pending' | 'success' | 'failed',
      attempts: row.attempts as number,
      lastAttemptAt: row.last_attempt_at
        ? new Date(row.last_attempt_at as string)
        : undefined,
      responseStatus: row.response_status as number | undefined,
      responseBody: row.response_body as string | undefined,
      error: row.error as string | undefined,
      createdAt: new Date(row.created_at as string),
    };
  }
}

// Will be initialized with database
let webhookStore: WebhookStore | null = null;

export function initializeWebhookStore(db: Database.Database): WebhookStore {
  webhookStore = new WebhookStore(db);
  return webhookStore;
}

export function getWebhookStore(): WebhookStore {
  if (!webhookStore) {
    throw new Error('Webhook store not initialized');
  }
  return webhookStore;
}
