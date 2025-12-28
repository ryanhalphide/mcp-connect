import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { apiKeyStore } from '../storage/apiKeys.js';
import { masterKeyMiddleware } from '../middleware/auth.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-keys' });

export const keysApi = new Hono();

// Helper to create API response
function apiResponse<T>(data: T, success = true): ApiResponse<T> {
  return {
    success,
    data,
    timestamp: new Date().toISOString(),
  };
}

function errorResponse(error: string): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Schema for creating API keys
const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});

// POST /keys - Create a new API key (requires master key)
keysApi.post('/', masterKeyMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { name, description, scopes } = CreateApiKeySchema.parse(body);

    const metadata: { description?: string; scopes?: string[] } = {};
    if (description) metadata.description = description;
    if (scopes) metadata.scopes = scopes;

    const apiKey = apiKeyStore.createApiKey(name, metadata);

    logger.info({ keyId: apiKey.id, name }, 'API key created');

    // Return the full key only on creation (this is the only time it's shown)
    return c.json(
      apiResponse({
        id: apiKey.id,
        key: apiKey.key,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
        enabled: apiKey.enabled,
        metadata: apiKey.metadata,
        warning: 'Save this API key securely. It will not be shown again.',
      }),
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    logger.error({ error }, 'Failed to create API key');
    c.status(500);
    return c.json(errorResponse('Failed to create API key'));
  }
});

// GET /keys - List all API keys (requires master key)
keysApi.get('/', masterKeyMiddleware, (c) => {
  const keys = apiKeyStore.getAllApiKeys();

  return c.json(
    apiResponse({
      total: keys.length,
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        enabled: key.enabled,
        metadata: key.metadata,
        keyPreview: '***********',
      })),
    })
  );
});

// GET /keys/:id - Get a specific API key (requires master key)
keysApi.get('/:id', masterKeyMiddleware, (c) => {
  const id = c.req.param('id');
  const key = apiKeyStore.getApiKeyById(id);

  if (!key) {
    c.status(404);
    return c.json(errorResponse('API key not found'));
  }

  return c.json(
    apiResponse({
      id: key.id,
      name: key.name,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      enabled: key.enabled,
      metadata: key.metadata,
      keyPreview: '***********',
    })
  );
});

// DELETE /keys/:id - Revoke an API key (requires master key)
keysApi.delete('/:id', masterKeyMiddleware, (c) => {
  const id = c.req.param('id');
  const revoked = apiKeyStore.revokeApiKey(id);

  if (!revoked) {
    c.status(404);
    return c.json(errorResponse('API key not found'));
  }

  logger.info({ keyId: id }, 'API key revoked');

  return c.json(
    apiResponse({
      id,
      revoked: true,
      message: 'API key has been revoked',
    })
  );
});

// DELETE /keys/:id/permanent - Permanently delete an API key (requires master key)
keysApi.delete('/:id/permanent', masterKeyMiddleware, (c) => {
  const id = c.req.param('id');
  const deleted = apiKeyStore.deleteApiKey(id);

  if (!deleted) {
    c.status(404);
    return c.json(errorResponse('API key not found'));
  }

  logger.info({ keyId: id }, 'API key permanently deleted');

  return c.json(
    apiResponse({
      id,
      deleted: true,
      message: 'API key has been permanently deleted',
    })
  );
});

// POST /keys/:id/enable - Re-enable a revoked API key (requires master key)
keysApi.post('/:id/enable', masterKeyMiddleware, (c) => {
  const id = c.req.param('id');
  const enabled = apiKeyStore.enableApiKey(id);

  if (!enabled) {
    c.status(404);
    return c.json(errorResponse('API key not found'));
  }

  logger.info({ keyId: id }, 'API key re-enabled');

  return c.json(
    apiResponse({
      id,
      enabled: true,
      message: 'API key has been re-enabled',
    })
  );
});
