import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { WebhookStore, initializeWebhookStore, getWebhookStore } from '../../src/storage/webhooks.js';
import type { EventType } from '../../src/core/events.js';

// Mock logger
vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('WebhookStore', () => {
  let db: Database.Database;
  let store: WebhookStore;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create webhook tables
    db.exec(`
      CREATE TABLE webhook_subscriptions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        events_json TEXT NOT NULL,
        secret TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        server_filter_json TEXT,
        retry_count INTEGER NOT NULL DEFAULT 3,
        retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE webhook_deliveries (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        response_status INTEGER,
        response_body TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
      );
    `);

    store = initializeWebhookStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createSubscription', () => {
    it('should create a new subscription', () => {
      const subscription = store.createSubscription({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['server.connected', 'server.disconnected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      expect(subscription.id).toBeDefined();
      expect(subscription.name).toBe('Test Webhook');
      expect(subscription.url).toBe('https://example.com/webhook');
      expect(subscription.events).toContain('server.connected');
      expect(subscription.events).toContain('server.disconnected');
      expect(subscription.enabled).toBe(true);
    });

    it('should store secret if provided', () => {
      const subscription = store.createSubscription({
        name: 'Secret Webhook',
        url: 'https://example.com/webhook',
        events: ['tool.invoked'],
        secret: 'my-super-secret-key',
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      expect(subscription.secret).toBe('my-super-secret-key');
    });

    it('should store server filter', () => {
      const serverIds = ['server-1', 'server-2'];
      const subscription = store.createSubscription({
        name: 'Filtered Webhook',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        serverFilter: serverIds,
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      expect(subscription.serverFilter).toEqual(serverIds);
    });
  });

  describe('getSubscription', () => {
    it('should retrieve subscription by ID', () => {
      const created = store.createSubscription({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      const found = store.getSubscription(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Test');
    });

    it('should return undefined for non-existent ID', () => {
      const found = store.getSubscription('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('getAllSubscriptions', () => {
    beforeEach(() => {
      store.createSubscription({
        name: 'Enabled 1',
        url: 'https://example.com/1',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.createSubscription({
        name: 'Enabled 2',
        url: 'https://example.com/2',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.createSubscription({
        name: 'Disabled',
        url: 'https://example.com/3',
        events: ['server.connected'],
        enabled: false,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });
    });

    it('should return all subscriptions', () => {
      const all = store.getAllSubscriptions();
      expect(all.length).toBe(3);
    });

    it('should filter to enabled only', () => {
      const enabled = store.getAllSubscriptions(true);
      expect(enabled.length).toBe(2);
      expect(enabled.every((s) => s.enabled)).toBe(true);
    });
  });

  describe('getSubscriptionsForEvent', () => {
    beforeEach(() => {
      store.createSubscription({
        name: 'Server Events',
        url: 'https://example.com/1',
        events: ['server.connected', 'server.disconnected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.createSubscription({
        name: 'Tool Events',
        url: 'https://example.com/2',
        events: ['tool.invoked'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.createSubscription({
        name: 'Filtered',
        url: 'https://example.com/3',
        events: ['server.connected'],
        serverFilter: ['server-1'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.createSubscription({
        name: 'Disabled',
        url: 'https://example.com/4',
        events: ['server.connected'],
        enabled: false,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });
    });

    it('should return subscriptions for specific event', () => {
      const subs = store.getSubscriptionsForEvent('server.connected');
      expect(subs.length).toBe(2); // Enabled ones that listen for server.connected
    });

    it('should not return disabled subscriptions', () => {
      const subs = store.getSubscriptionsForEvent('server.connected');
      expect(subs.every((s) => s.enabled)).toBe(true);
    });

    it('should filter by server ID', () => {
      const subs = store.getSubscriptionsForEvent('server.connected', 'server-1');
      expect(subs.length).toBe(2); // Unfiltered + matching filter

      const subsOther = store.getSubscriptionsForEvent('server.connected', 'server-2');
      expect(subsOther.length).toBe(1); // Only unfiltered
    });
  });

  describe('updateSubscription', () => {
    it('should update subscription fields', () => {
      const created = store.createSubscription({
        name: 'Original',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      const updated = store.updateSubscription(created.id, {
        name: 'Updated',
        enabled: false,
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated');
      expect(updated?.enabled).toBe(false);
      expect(updated?.url).toBe('https://example.com/webhook'); // Unchanged
    });

    it('should return undefined for non-existent ID', () => {
      const result = store.updateSubscription('non-existent', { name: 'Test' });
      expect(result).toBeUndefined();
    });
  });

  describe('deleteSubscription', () => {
    it('should delete subscription', () => {
      const created = store.createSubscription({
        name: 'To Delete',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      const deleted = store.deleteSubscription(created.id);
      expect(deleted).toBe(true);
      expect(store.getSubscription(created.id)).toBeUndefined();
    });

    it('should return false for non-existent ID', () => {
      const deleted = store.deleteSubscription('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('recordDelivery', () => {
    it('should record a delivery', () => {
      const subscription = store.createSubscription({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      const delivery = store.recordDelivery(
        subscription.id,
        'server.connected',
        { test: 'data' },
        'success',
        200,
        '{"ok": true}'
      );

      expect(delivery.id).toBeDefined();
      expect(delivery.subscriptionId).toBe(subscription.id);
      expect(delivery.event).toBe('server.connected');
      expect(delivery.status).toBe('success');
      expect(delivery.responseStatus).toBe(200);
    });
  });

  describe('getDeliveries', () => {
    it('should get deliveries for subscription', () => {
      const subscription = store.createSubscription({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.recordDelivery(subscription.id, 'server.connected', {}, 'success');
      store.recordDelivery(subscription.id, 'server.connected', {}, 'failed');

      const deliveries = store.getDeliveries(subscription.id);
      expect(deliveries.length).toBe(2);
    });

    it('should filter by status', () => {
      const subscription = store.createSubscription({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.recordDelivery(subscription.id, 'server.connected', {}, 'success');
      store.recordDelivery(subscription.id, 'server.connected', {}, 'failed');
      store.recordDelivery(subscription.id, 'server.connected', {}, 'success');

      const successOnly = store.getDeliveries(subscription.id, { status: 'success' });
      expect(successOnly.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return stats for subscription', () => {
      const subscription = store.createSubscription({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['server.connected'],
        enabled: true,
        retryCount: 3,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      store.recordDelivery(subscription.id, 'server.connected', {}, 'success');
      store.recordDelivery(subscription.id, 'server.connected', {}, 'success');
      store.recordDelivery(subscription.id, 'server.connected', {}, 'failed');

      const stats = store.getStats(subscription.id);
      expect(stats.totalDeliveries).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failedCount).toBe(1);
    });
  });

  describe('getWebhookStore', () => {
    it('should return initialized store', () => {
      const retrieved = getWebhookStore();
      expect(retrieved).toBe(store);
    });
  });
});
