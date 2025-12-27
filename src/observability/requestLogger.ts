import { createMiddleware } from 'hono/factory';
import { createChildLogger } from './logger.js';
import { randomUUID } from 'node:crypto';
import { trackRequest } from '../api/monitor.js';

const requestLogger = createChildLogger({ module: 'http' });

export const requestLoggingMiddleware = createMiddleware(async (c, next) => {
  const correlationId = c.req.header('x-correlation-id') || randomUUID();
  const startTime = Date.now();

  // Set correlation ID on response
  c.header('x-correlation-id', correlationId);

  // Log incoming request
  requestLogger.info(
    {
      correlationId,
      method: c.req.method,
      path: c.req.path,
      query: c.req.query(),
      userAgent: c.req.header('user-agent'),
    },
    'Incoming request'
  );

  try {
    await next();
  } finally {
    const durationMs = Date.now() - startTime;

    // Track request metrics
    trackRequest(c.req.method, c.req.path, c.res.status, durationMs);

    // Log completed request
    requestLogger.info(
      {
        correlationId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      },
      'Request completed'
    );
  }
});
