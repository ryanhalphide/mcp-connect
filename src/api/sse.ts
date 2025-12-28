import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { appEvents, ALL_EVENT_TYPES, type AppEvent, type EventType } from '../core/events.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-sse' });

export const sseApi = new Hono();

// Track connected clients for metrics
let connectedClients = 0;

/**
 * GET /sse/events - Stream real-time events via SSE
 *
 * Query parameters:
 * - types: Comma-separated list of event types to subscribe to (default: all)
 * - servers: Comma-separated list of server IDs to filter (default: all)
 */
sseApi.get('/events', async (c) => {
  const typesParam = c.req.query('types');
  const serversParam = c.req.query('servers');

  // Parse event types filter
  let eventTypes: EventType[] = ALL_EVENT_TYPES;
  if (typesParam) {
    const requestedTypes = typesParam.split(',').map((t) => t.trim()) as EventType[];
    eventTypes = requestedTypes.filter((t) => ALL_EVENT_TYPES.includes(t));

    if (eventTypes.length === 0) {
      return c.json(
        {
          success: false,
          error: `Invalid event types. Valid types: ${ALL_EVENT_TYPES.join(', ')}`,
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }

  // Parse server filter
  const serverFilter: string[] | null = serversParam
    ? serversParam.split(',').map((s) => s.trim())
    : null;

  connectedClients++;
  logger.info(
    {
      eventTypes,
      serverFilter,
      connectedClients,
    },
    'SSE client connected'
  );

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({
        message: 'Connected to SSE stream',
        subscribedEvents: eventTypes,
        serverFilter,
        timestamp: new Date().toISOString(),
      }),
    });

    // Event handler
    const handleEvent = async (event: AppEvent) => {
      try {
        // Check server filter
        if (serverFilter && 'serverId' in event) {
          if (!serverFilter.includes(event.serverId)) {
            return;
          }
        }

        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify({
            ...event,
            type: undefined, // Already in event field
          }),
          id: `${event.type}-${Date.now()}`,
        });
      } catch (error) {
        // Client probably disconnected
        logger.debug({ error }, 'Failed to write SSE event');
      }
    };

    // Subscribe to events
    for (const eventType of eventTypes) {
      appEvents.on(eventType, handleEvent);
    }

    // Send periodic keepalive
    const keepaliveInterval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'keepalive',
          data: JSON.stringify({
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        // Connection closed
        clearInterval(keepaliveInterval);
      }
    }, 30000); // Every 30 seconds

    // Wait for client disconnect
    try {
      // This will block until the client disconnects
      await new Promise((resolve) => {
        stream.onAbort(() => {
          resolve(undefined);
        });
      });
    } finally {
      // Cleanup
      clearInterval(keepaliveInterval);
      for (const eventType of eventTypes) {
        appEvents.off(eventType, handleEvent);
      }
      connectedClients--;
      logger.info({ connectedClients }, 'SSE client disconnected');
    }
  });
});

/**
 * GET /sse/status - Get SSE connection status
 */
sseApi.get('/status', (c) => {
  return c.json({
    success: true,
    data: {
      connectedClients,
      availableEvents: ALL_EVENT_TYPES,
      eventCategories: {
        server: ALL_EVENT_TYPES.filter((e) => e.startsWith('server.')),
        tool: ALL_EVENT_TYPES.filter((e) => e.startsWith('tool.')),
        circuit: ALL_EVENT_TYPES.filter((e) => e.startsWith('circuit.')),
      },
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get the current connected client count
 */
export function getSSEClientCount(): number {
  return connectedClients;
}
