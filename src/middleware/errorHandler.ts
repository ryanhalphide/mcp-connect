import type { Context, Next } from 'hono';
import { createChildLogger } from '../observability/logger.js';
import { ZodError } from 'zod';

const logger = createChildLogger({ module: 'error-handler' });

/**
 * Custom error classes for MCP Connect
 */
export class MCPConnectError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'MCPConnectError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends MCPConnectError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends MCPConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthorizationError extends MCPConnectError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'AuthorizationError';
  }
}

export class ForbiddenError extends MCPConnectError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends MCPConnectError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, details?: Record<string, unknown>) {
    super('Rate limit exceeded', 'RATE_LIMITED', 429, details);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitOpenError extends MCPConnectError {
  public readonly retryAfterMs: number;

  constructor(serverId: string, retryAfterMs: number) {
    super(`Circuit breaker is open for server ${serverId}`, 'CIRCUIT_OPEN', 503, { serverId, retryAfterMs });
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class ServerDisconnectedError extends MCPConnectError {
  constructor(serverId: string) {
    super(`Server is not connected: ${serverId}`, 'SERVER_DISCONNECTED', 503, { serverId });
    this.name = 'ServerDisconnectedError';
  }
}

export class TimeoutError extends MCPConnectError {
  constructor(operation: string, timeoutMs: number) {
    super(`Operation timed out: ${operation}`, 'TIMEOUT', 504, { operation, timeoutMs });
    this.name = 'TimeoutError';
  }
}

export class ConflictError extends MCPConnectError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

/**
 * Format error response consistently
 */
function formatErrorResponse(
  code: string,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>,
  requestId?: string
) {
  return {
    success: false,
    error: message,
    code,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
    ...(requestId ? { requestId } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Extract request ID from context
 */
function getRequestId(c: Context): string | undefined {
  return c.req.header('x-request-id') || (c.get('requestId') as string | undefined);
}

/**
 * Determine if error details should be exposed
 * In production, we hide internal error details
 */
function shouldExposeDetails(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Production-grade error handling middleware
 */
export async function errorHandlerMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const requestId = getRequestId(c);

    // Handle MCPConnectError (our custom errors)
    if (error instanceof MCPConnectError) {
      logger.warn(
        {
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
          details: error.details,
          requestId,
        },
        'Request failed with MCPConnectError'
      );

      // Add retry-after header for rate limit and circuit breaker errors
      if (error instanceof RateLimitError) {
        c.header('Retry-After', Math.ceil(error.retryAfterMs / 1000).toString());
      } else if (error instanceof CircuitOpenError) {
        c.header('Retry-After', Math.ceil(error.retryAfterMs / 1000).toString());
      }

      return c.json(
        formatErrorResponse(error.code, error.message, error.statusCode, error.details, requestId),
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503 | 504
      );
    }

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      logger.warn({ issues, requestId }, 'Validation error');

      return c.json(
        formatErrorResponse('VALIDATION_ERROR', 'Request validation failed', 400, { issues }, requestId),
        400
      );
    }

    // Handle generic errors
    const err = error as Error;
    const message = err.message || 'An unexpected error occurred';
    const stack = err.stack;

    // Log full error details
    logger.error(
      {
        error: message,
        stack,
        name: err.name,
        requestId,
      },
      'Unhandled error'
    );

    // In production, hide internal error details
    const exposeDetails = shouldExposeDetails();
    const responseMessage = exposeDetails ? message : 'Internal server error';
    const details = exposeDetails ? { name: err.name, stack } : undefined;

    return c.json(formatErrorResponse('INTERNAL_ERROR', responseMessage, 500, details, requestId), 500);
  }
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(c: Context) {
  const requestId = getRequestId(c);
  const path = c.req.path;

  logger.warn({ path, requestId }, 'Route not found');

  return c.json(
    formatErrorResponse('NOT_FOUND', `Route not found: ${path}`, 404, { path }, requestId),
    404
  );
}

/**
 * Request timeout middleware
 */
export function timeoutMiddleware(timeoutMs = 30000) {
  return async (c: Context, next: Next) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Store abort signal in context for downstream use
      c.set('abortSignal', controller.signal);
      await next();
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

/**
 * Request ID middleware - generates or propagates request ID
 */
export async function requestIdMiddleware(c: Context, next: Next) {
  const existingId = c.req.header('x-request-id');
  const requestId = existingId || crypto.randomUUID();

  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);

  await next();
}
