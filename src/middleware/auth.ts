import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { apiKeyStore } from '../storage/apiKeys.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'auth-middleware' });

/**
 * Extract API key from request
 * Supports both Authorization header and x-api-key header
 */
function extractApiKey(c: Context): string | null {
  // Try Authorization header first (Bearer token)
  const authHeader = c.req.header('authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1];
    }
  }

  // Try x-api-key header
  const apiKeyHeader = c.req.header('x-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  // Try query parameter (less secure, but useful for webhooks)
  const apiKeyQuery = c.req.query('api_key');
  if (apiKeyQuery) {
    return apiKeyQuery;
  }

  return null;
}

/**
 * Authentication middleware
 * Validates API key and attaches key info to context
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const apiKey = extractApiKey(c);

  if (!apiKey) {
    logger.warn(
      {
        method: c.req.method,
        path: c.req.path,
        ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      },
      'Missing API key'
    );

    return c.json(
      {
        success: false,
        error: 'Authentication required. Provide API key via Authorization header (Bearer token), x-api-key header, or api_key query parameter.',
        timestamp: new Date().toISOString(),
      },
      401
    );
  }

  // Validate API key
  const keyInfo = apiKeyStore.validateApiKey(apiKey);

  if (!keyInfo) {
    logger.warn(
      {
        method: c.req.method,
        path: c.req.path,
        keyPrefix: apiKey.substring(0, 12) + '...',
        ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      },
      'Invalid API key'
    );

    return c.json(
      {
        success: false,
        error: 'Invalid or revoked API key',
        timestamp: new Date().toISOString(),
      },
      401
    );
  }

  // Attach key info to context for use in handlers
  c.set('apiKey', keyInfo);
  c.set('apiKeyId', keyInfo.id);
  c.set('tenantId', keyInfo.tenantId);

  logger.info(
    {
      keyId: keyInfo.id,
      keyName: keyInfo.name,
      tenantId: keyInfo.tenantId,
      method: c.req.method,
      path: c.req.path,
    },
    'Authenticated request'
  );

  await next();
});

/**
 * Optional authentication middleware
 * Allows both authenticated and unauthenticated requests
 * Attaches key info if present
 */
export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const apiKey = extractApiKey(c);

  if (apiKey) {
    const keyInfo = apiKeyStore.validateApiKey(apiKey);
    if (keyInfo) {
      c.set('apiKey', keyInfo);
      c.set('apiKeyId', keyInfo.id);
      c.set('tenantId', keyInfo.tenantId);
      logger.info(
        {
          keyId: keyInfo.id,
          keyName: keyInfo.name,
          tenantId: keyInfo.tenantId,
          method: c.req.method,
          path: c.req.path,
        },
        'Authenticated request'
      );
    }
  }

  await next();
});

/**
 * Master key authentication for admin operations
 * Checks against MASTER_API_KEY environment variable
 */
export const masterKeyMiddleware = createMiddleware(async (c, next) => {
  const masterKey = process.env.MASTER_API_KEY;

  if (!masterKey) {
    logger.error('MASTER_API_KEY not configured');
    return c.json(
      {
        success: false,
        error: 'Master API key not configured on server',
        timestamp: new Date().toISOString(),
      },
      500
    );
  }

  const apiKey = extractApiKey(c);

  if (!apiKey || apiKey !== masterKey) {
    logger.warn(
      {
        method: c.req.method,
        path: c.req.path,
        ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      },
      'Invalid master key'
    );

    return c.json(
      {
        success: false,
        error: 'Invalid master API key',
        timestamp: new Date().toISOString(),
      },
      401
    );
  }

  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
    },
    'Master key authenticated'
  );

  await next();
});
