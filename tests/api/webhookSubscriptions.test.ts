import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { webhookSubscriptionsApi } from '../../src/api/webhookSubscriptions.js';

// Mock data
const mockSubscription = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Webhook',
  url: 'https://example.com/webhook',
  events: ['server.connected', 'tool.invoked'],
  secret: 'test-secret-key-1234',
  enabled: true,
  serverFilter: null,
  retryCount: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockDelivery = {
  id: 'delivery-123',
  subscriptionId: mockSubscription.id,
  event: 'server.connected',
  payload: JSON.stringify({ serverId: 'test-server' }),
  status: 'success',
  statusCode: 200,
  responseBody: '{"ok":true}',
  error: null,
  attempt: 1,
  createdAt: new Date().toISOString(),
};

// Mock functions
const mockGetAllSubscriptions = vi.fn();
const mockGetSubscription = vi.fn();
const mockCreateSubscription = vi.fn();
const mockUpdateSubscription = vi.fn();
const mockDeleteSubscription = vi.fn();
const mockGetDeliveries = vi.fn();
const mockGetStats = vi.fn();
const mockTestDelivery = vi.fn();

vi.mock('../../src/storage/webhooks.js', () => ({
  getWebhookStore: () => ({
    getAllSubscriptions: (enabledOnly?: boolean) => mockGetAllSubscriptions(enabledOnly),
    getSubscription: (id: string) => mockGetSubscription(id),
    createSubscription: (data: unknown) => mockCreateSubscription(data),
    updateSubscription: (id: string, data: unknown) => mockUpdateSubscription(id, data),
    deleteSubscription: (id: string) => mockDeleteSubscription(id),
    getDeliveries: (id: string, opts?: unknown) => mockGetDeliveries(id, opts),
    getStats: (id: string) => mockGetStats(id),
  }),
}));

vi.mock('../../src/core/webhookDelivery.js', () => ({
  webhookDeliveryService: {
    testDelivery: (subscription: unknown) => mockTestDelivery(subscription),
  },
}));

vi.mock('../../src/core/events.js', () => ({
  ALL_EVENT_TYPES: [
    'server.connected',
    'server.disconnected',
    'server.error',
    'tool.invoked',
    'tool.failed',
    'circuit.opened',
    'circuit.closed',
    'circuit.half_open',
  ],
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Webhook Subscriptions API', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route('/api/webhooks/subscriptions', webhookSubscriptionsApi);

    // Default mock implementations
    mockGetAllSubscriptions.mockReturnValue([mockSubscription]);
    mockGetSubscription.mockImplementation((id) =>
      id === mockSubscription.id ? mockSubscription : undefined
    );
    mockCreateSubscription.mockImplementation((data) => ({
      id: 'new-sub-id',
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    mockUpdateSubscription.mockImplementation((id, data) =>
      id === mockSubscription.id ? { ...mockSubscription, ...data } : undefined
    );
    mockDeleteSubscription.mockImplementation((id) => id === mockSubscription.id);
    mockGetDeliveries.mockReturnValue([mockDelivery]);
    mockGetStats.mockReturnValue({
      total: 100,
      success: 95,
      failed: 5,
      pending: 0,
    });
    mockTestDelivery.mockResolvedValue({
      success: true,
      statusCode: 200,
      responseBody: '{"ok":true}',
      durationMs: 150,
    });
  });

  describe('GET /api/webhooks/subscriptions', () => {
    it('should return all subscriptions', async () => {
      const res = await app.request('/api/webhooks/subscriptions');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.subscriptions).toHaveLength(1);
      expect(json.data.subscriptions[0].name).toBe('Test Webhook');
      expect(json.data.count).toBe(1);
    });

    it('should filter by enabled status', async () => {
      mockGetAllSubscriptions.mockReturnValue([mockSubscription]);

      const res = await app.request('/api/webhooks/subscriptions?enabled=true');

      expect(res.status).toBe(200);
      expect(mockGetAllSubscriptions).toHaveBeenCalledWith(true);
    });

    it('should return empty array when no subscriptions', async () => {
      mockGetAllSubscriptions.mockReturnValue([]);

      const res = await app.request('/api/webhooks/subscriptions');
      const json = await res.json();

      expect(json.data.subscriptions).toEqual([]);
      expect(json.data.count).toBe(0);
    });
  });

  describe('GET /api/webhooks/subscriptions/events', () => {
    it('should return all available event types', async () => {
      const res = await app.request('/api/webhooks/subscriptions/events');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.events).toBeInstanceOf(Array);
      expect(json.data.events).toContain('server.connected');
      expect(json.data.events).toContain('tool.invoked');
    });

    it('should categorize events', async () => {
      const res = await app.request('/api/webhooks/subscriptions/events');
      const json = await res.json();

      expect(json.data.categories).toBeDefined();
      expect(json.data.categories.server).toContain('server.connected');
      expect(json.data.categories.tool).toContain('tool.invoked');
      expect(json.data.categories.circuit).toContain('circuit.opened');
    });
  });

  describe('GET /api/webhooks/subscriptions/:id', () => {
    it('should return a specific subscription', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(mockSubscription.id);
      expect(json.data.name).toBe('Test Webhook');
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Subscription not found');
    });
  });

  describe('POST /api/webhooks/subscriptions', () => {
    it('should create a new subscription', async () => {
      const newSubscription = {
        name: 'New Webhook',
        url: 'https://example.com/new-webhook',
        events: ['server.connected'],
      };

      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubscription),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('New Webhook');
      expect(mockCreateSubscription).toHaveBeenCalled();
    });

    it('should accept optional parameters', async () => {
      const newSubscription = {
        name: 'Full Webhook',
        url: 'https://example.com/webhook',
        events: ['server.connected', 'tool.invoked'],
        secret: 'my-secret-key-12345678',
        enabled: true,
        serverFilter: ['123e4567-e89b-12d3-a456-426614174001'],
        retryCount: 5,
        retryDelayMs: 2000,
        timeoutMs: 15000,
      };

      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubscription),
      });

      expect(res.status).toBe(201);
      expect(mockCreateSubscription).toHaveBeenCalledWith(expect.objectContaining({
        retryCount: 5,
        retryDelayMs: 2000,
        timeoutMs: 15000,
      }));
    });

    it('should return 400 for missing required fields', async () => {
      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Incomplete' }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Validation error');
    });

    it('should return 400 for invalid URL', async () => {
      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid URL Webhook',
          url: 'not-a-valid-url',
          events: ['server.connected'],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Validation error');
    });

    it('should return 400 for invalid event type', async () => {
      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid Event Webhook',
          url: 'https://example.com/webhook',
          events: ['invalid.event'],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Validation error');
    });

    it('should return 400 for empty events array', async () => {
      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'No Events Webhook',
          url: 'https://example.com/webhook',
          events: [],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Validation error');
    });

    it('should return 400 for secret that is too short', async () => {
      const res = await app.request('/api/webhooks/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Short Secret Webhook',
          url: 'https://example.com/webhook',
          events: ['server.connected'],
          secret: 'short', // less than 16 chars
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Validation error');
    });
  });

  describe('PUT /api/webhooks/subscriptions/:id', () => {
    it('should update an existing subscription', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Webhook' }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockUpdateSubscription).toHaveBeenCalledWith(
        mockSubscription.id,
        expect.objectContaining({ name: 'Updated Webhook' })
      );
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });

    it('should allow partial updates', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryCount: 5 }),
      });

      expect(res.status).toBe(200);
      expect(mockUpdateSubscription).toHaveBeenCalledWith(
        mockSubscription.id,
        { retryCount: 5 }
      );
    });
  });

  describe('DELETE /api/webhooks/subscriptions/:id', () => {
    it('should delete an existing subscription', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(mockDeleteSubscription).toHaveBeenCalledWith(mockSubscription.id);
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id', {
        method: 'DELETE',
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });
  });

  describe('GET /api/webhooks/subscriptions/:id/deliveries', () => {
    it('should return delivery history', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}/deliveries`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.deliveries).toHaveLength(1);
      expect(json.data.deliveries[0].status).toBe('success');
    });

    it('should accept limit parameter', async () => {
      const res = await app.request(
        `/api/webhooks/subscriptions/${mockSubscription.id}/deliveries?limit=10`
      );

      expect(res.status).toBe(200);
      expect(mockGetDeliveries).toHaveBeenCalledWith(
        mockSubscription.id,
        expect.objectContaining({ limit: 10 })
      );
    });

    it('should accept status filter', async () => {
      const res = await app.request(
        `/api/webhooks/subscriptions/${mockSubscription.id}/deliveries?status=failed`
      );

      expect(res.status).toBe(200);
      expect(mockGetDeliveries).toHaveBeenCalledWith(
        mockSubscription.id,
        expect.objectContaining({ status: 'failed' })
      );
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id/deliveries');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });
  });

  describe('GET /api/webhooks/subscriptions/:id/stats', () => {
    it('should return delivery statistics', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}/stats`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(100);
      expect(json.data.success).toBe(95);
      expect(json.data.failed).toBe(5);
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id/stats');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });
  });

  describe('POST /api/webhooks/subscriptions/:id/test', () => {
    it('should send a test delivery', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}/test`, {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.success).toBe(true);
      expect(json.data.statusCode).toBe(200);
      expect(json.data.durationMs).toBe(150);
      expect(mockTestDelivery).toHaveBeenCalledWith(mockSubscription);
    });

    it('should return test failure details', async () => {
      mockTestDelivery.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'Server error',
        durationMs: 50,
      });

      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}/test`, {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.success).toBe(false);
      expect(json.data.statusCode).toBe(500);
      expect(json.data.error).toBe('Server error');
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id/test', {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });
  });

  describe('POST /api/webhooks/subscriptions/:id/enable', () => {
    it('should enable a subscription', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}/enable`, {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, { enabled: true });
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id/enable', {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });
  });

  describe('POST /api/webhooks/subscriptions/:id/disable', () => {
    it('should disable a subscription', async () => {
      const res = await app.request(`/api/webhooks/subscriptions/${mockSubscription.id}/disable`, {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, { enabled: false });
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await app.request('/api/webhooks/subscriptions/non-existent-id/disable', {
        method: 'POST',
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain('Subscription not found');
    });
  });
});
