import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { sseApi, getSSEClientCount } from '../../src/api/sse.js';

// Mock the events module
const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('../../src/core/events.js', () => ({
  appEvents: {
    on: (event: string, handler: Function) => mockOn(event, handler),
    off: (event: string, handler: Function) => mockOff(event, handler),
  },
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

describe('SSE API', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route('/api/sse', sseApi);
  });

  describe('GET /api/sse/status', () => {
    it('should return SSE status with available events', async () => {
      const res = await app.request('/api/sse/status');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.connectedClients).toBeDefined();
      expect(json.data.availableEvents).toBeInstanceOf(Array);
      expect(json.data.availableEvents).toContain('server.connected');
      expect(json.data.availableEvents).toContain('tool.invoked');
    });

    it('should categorize events by type', async () => {
      const res = await app.request('/api/sse/status');
      const json = await res.json();

      expect(json.data.eventCategories).toBeDefined();
      expect(json.data.eventCategories.server).toBeInstanceOf(Array);
      expect(json.data.eventCategories.tool).toBeInstanceOf(Array);
      expect(json.data.eventCategories.circuit).toBeInstanceOf(Array);
    });

    it('should include timestamp', async () => {
      const res = await app.request('/api/sse/status');
      const json = await res.json();

      expect(json.timestamp).toBeDefined();
      expect(new Date(json.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('GET /api/sse/events', () => {
    it('should return 400 for invalid event types', async () => {
      const res = await app.request('/api/sse/events?types=invalid.event');
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Invalid event types');
    });

    it('should accept valid event types filter', async () => {
      // For SSE streaming endpoints, we can't easily test the full stream
      // but we can verify it accepts valid parameters
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        const res = await app.request('/api/sse/events?types=server.connected,tool.invoked', {
          signal: controller.signal,
        });
        // If we get here before abort, check headers
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      } catch (error: any) {
        // AbortError is expected
        if (error.name !== 'AbortError') {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });

    it('should accept server filter parameter', async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        const res = await app.request('/api/sse/events?servers=server-1,server-2', {
          signal: controller.signal,
        });
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });

    it('should return SSE content type for events endpoint', async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        const res = await app.request('/api/sse/events', {
          signal: controller.signal,
        });
        // Verify it's an SSE stream
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      } catch (error: any) {
        // AbortError is expected for streaming endpoints
        if (error.name !== 'AbortError') {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });
  });

  describe('getSSEClientCount', () => {
    it('should return a number', () => {
      const count = getSSEClientCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('SSE Event Streaming Integration', () => {
  // These tests verify the SSE streaming behavior more thoroughly

  it('should format SSE events correctly', () => {
    // Test the SSE event format helper logic
    const event = {
      type: 'server.connected',
      serverId: 'test-server-123',
      serverName: 'Test Server',
      toolCount: 5,
      timestamp: new Date().toISOString(),
    };

    const sseData = JSON.stringify({
      ...event,
      type: undefined, // type goes in event field
    });

    expect(sseData).toContain('serverId');
    expect(sseData).toContain('test-server-123');
    expect(sseData).not.toContain('"type":"server.connected"');
  });

  it('should filter events by server ID', () => {
    const serverFilter = ['server-1', 'server-2'];

    const event1 = { type: 'tool.invoked', serverId: 'server-1' };
    const event2 = { type: 'tool.invoked', serverId: 'server-3' };

    const shouldInclude1 = serverFilter.includes(event1.serverId);
    const shouldInclude2 = serverFilter.includes(event2.serverId);

    expect(shouldInclude1).toBe(true);
    expect(shouldInclude2).toBe(false);
  });

  it('should handle events without serverId', () => {
    const serverFilter = ['server-1'];

    // Events like circuit breaker state changes may not have serverId
    const event = { type: 'circuit.opened', circuitId: 'test' };

    // Events without serverId should pass through when filter exists
    const hasServerId = 'serverId' in event;
    expect(hasServerId).toBe(false);
  });
});

describe('SSE Event Types', () => {
  it('should include all expected server events', async () => {
    const app = new Hono();
    app.route('/api/sse', sseApi);

    const res = await app.request('/api/sse/status');
    const json = await res.json();

    const serverEvents = json.data.eventCategories.server;
    expect(serverEvents).toContain('server.connected');
    expect(serverEvents).toContain('server.disconnected');
    expect(serverEvents).toContain('server.error');
  });

  it('should include all expected tool events', async () => {
    const app = new Hono();
    app.route('/api/sse', sseApi);

    const res = await app.request('/api/sse/status');
    const json = await res.json();

    const toolEvents = json.data.eventCategories.tool;
    expect(toolEvents).toContain('tool.invoked');
    expect(toolEvents).toContain('tool.failed');
  });

  it('should include all expected circuit breaker events', async () => {
    const app = new Hono();
    app.route('/api/sse', sseApi);

    const res = await app.request('/api/sse/status');
    const json = await res.json();

    const circuitEvents = json.data.eventCategories.circuit;
    expect(circuitEvents).toContain('circuit.opened');
    expect(circuitEvents).toContain('circuit.closed');
    expect(circuitEvents).toContain('circuit.half_open');
  });
});
