import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { webhookApi } from '../../src/api/webhook.js';

// Mock dependencies
vi.mock('../../src/core/router.js', () => ({
  toolRouter: {
    invoke: vi.fn(),
  },
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { toolRouter } from '../../src/core/router.js';

describe('Webhook API', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/webhook', webhookApi);
    vi.clearAllMocks();
  });

  describe('GET /webhook/ping', () => {
    it('should return ok status', async () => {
      const res = await app.request('/webhook/ping');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('ok');
      expect(json.data.message).toBe('Webhook endpoint is alive');
    });
  });

  describe('POST /webhook/test', () => {
    it('should echo back webhook data', async () => {
      const payload = {
        event: 'test.event',
        data: { key: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
      };

      const res = await app.request('/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.received).toBe(true);
      expect(json.data.event).toBe('test.event');
      expect(json.data.data).toEqual({ key: 'value' });
      expect(json.data.receivedAt).toBeDefined();
    });

    it('should include request headers in response', async () => {
      const payload = { event: 'header.test' };

      const res = await app.request('/webhook/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TestAgent/1.0',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      expect(json.data.headers['content-type']).toBe('application/json');
    });

    it('should accept webhook without data field', async () => {
      const payload = { event: 'simple.event' };

      const res = await app.request('/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.event).toBe('simple.event');
    });

    it('should return 400 for missing event field', async () => {
      const payload = { data: { key: 'value' } };

      const res = await app.request('/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Validation error');
    });

    it('should return 400 for invalid JSON', async () => {
      const res = await app.request('/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /webhook/invoke/:toolName', () => {
    it('should invoke tool with webhook data', async () => {
      vi.mocked(toolRouter.invoke).mockResolvedValue({
        success: true,
        data: { result: 'success' },
        toolName: 'test_tool',
        serverId: 'srv1',
        durationMs: 50,
      });

      const res = await app.request('/webhook/invoke/test_tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ param1: 'value1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.result).toEqual({ result: 'success' });
      expect(json.data.toolName).toBe('test_tool');
      expect(json.data.serverId).toBe('srv1');
      expect(json.data.durationMs).toBe(50);

      expect(toolRouter.invoke).toHaveBeenCalledWith('test_tool', { param1: 'value1' });
    });

    it('should handle tool with namespaced name', async () => {
      vi.mocked(toolRouter.invoke).mockResolvedValue({
        success: true,
        data: { files: [] },
        toolName: 'filesystem/read_file',
        serverId: 'fs-server',
        durationMs: 25,
      });

      const res = await app.request('/webhook/invoke/filesystem/read_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/test.txt' }),
      });

      expect(res.status).toBe(200);
      expect(toolRouter.invoke).toHaveBeenCalledWith('filesystem/read_file', {
        path: '/tmp/test.txt',
      });
    });

    it('should return 500 when tool invocation fails', async () => {
      vi.mocked(toolRouter.invoke).mockResolvedValue({
        success: false,
        error: 'Tool not found',
      });

      const res = await app.request('/webhook/invoke/unknown_tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Tool not found');
    });

    it('should handle tool invocation exceptions', async () => {
      vi.mocked(toolRouter.invoke).mockRejectedValue(new Error('Connection timeout'));

      const res = await app.request('/webhook/invoke/slow_tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Connection timeout');
    });

    it('should pass empty object for empty body', async () => {
      vi.mocked(toolRouter.invoke).mockResolvedValue({
        success: true,
        data: {},
        toolName: 'no_params_tool',
        serverId: 'srv1',
        durationMs: 10,
      });

      const res = await app.request('/webhook/invoke/no_params_tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(toolRouter.invoke).toHaveBeenCalledWith('no_params_tool', {});
    });
  });

  describe('POST /webhook/batch', () => {
    it('should process batch of events', async () => {
      const events = [
        { event: 'event1', data: { id: 1 } },
        { event: 'event2', data: { id: 2 } },
        { event: 'event3' },
      ];

      const res = await app.request('/webhook/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.processed).toBe(3);
      expect(json.data.results).toHaveLength(3);
    });

    it('should include event details in batch results', async () => {
      const events = [{ event: 'batch.test' }];

      const res = await app.request('/webhook/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      });

      const json = await res.json();
      expect(json.data.results[0].event).toBe('batch.test');
      expect(json.data.results[0].processed).toBe(true);
      expect(json.data.results[0].receivedAt).toBeDefined();
    });

    it('should return 400 for invalid batch format', async () => {
      const res = await app.request('/webhook/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notAnArray: true }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Validation error');
    });

    it('should return 400 for batch with invalid events', async () => {
      const events = [
        { event: 'valid.event' },
        { invalid: 'missing event field' },
      ];

      const res = await app.request('/webhook/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      });

      expect(res.status).toBe(400);
    });

    it('should handle empty batch', async () => {
      const res = await app.request('/webhook/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.processed).toBe(0);
      expect(json.data.results).toEqual([]);
    });
  });
});
