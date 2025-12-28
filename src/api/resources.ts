import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { resourceRegistry } from '../core/resourceRegistry.js';
import { connectionPool } from '../core/pool.js';
import { readResource as mcpReadResource } from '../mcp/client.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'resources-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

export const resourcesApi = new Hono();

// Schema for resource search query
const ResourceSearchQuerySchema = z.object({
  server: z.string().optional(),
  mimeType: z.string().optional(),
  query: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// Schema for read resource request
const ReadResourceSchema = z.object({
  uri: z.string(),
});

/**
 * GET /resources
 * List all registered resources with optional filtering
 */
resourcesApi.get('/', (c) => {
  try {
    const queryParams = c.req.query();
    const validated = ResourceSearchQuerySchema.parse(queryParams);

    const result = resourceRegistry.searchResources({
      serverId: validated.server,
      mimeType: validated.mimeType,
      query: validated.query,
      limit: validated.limit,
      offset: validated.offset,
    });

    logger.info(
      { total: result.total, returned: result.resources.length, filters: validated },
      'Resources listed'
    );

    return c.json(
      apiResponse({
        resources: result.resources,
        total: result.total,
        limit: validated.limit,
        offset: validated.offset,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to list resources');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 400);
  }
});

/**
 * GET /resources/stats
 * Get resource statistics
 */
resourcesApi.get('/stats', (c) => {
  try {
    const total = resourceRegistry.getResourceCount();
    const byServer = resourceRegistry.getStatsByServer();
    const mimeTypes = resourceRegistry.getMimeTypes();

    logger.debug({ total, serverCount: byServer.length, mimeTypeCount: mimeTypes.length }, 'Resource stats retrieved');

    return c.json(
      apiResponse({
        total,
        byServer,
        mimeTypes,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get resource stats');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});

/**
 * GET /resources/:uri
 * Get metadata for a specific resource
 */
resourcesApi.get('/:uri', (c) => {
  try {
    const uri = decodeURIComponent(c.req.param('uri'));

    const resource = resourceRegistry.findResource(uri);
    if (!resource) {
      logger.warn({ uri }, 'Resource not found');
      return c.json(apiResponse(null, false, `Resource not found: ${uri}`), 404);
    }

    logger.info({ uri, serverId: resource.serverId }, 'Resource metadata retrieved');

    return c.json(apiResponse(resource));
  } catch (error) {
    logger.error({ error }, 'Failed to get resource');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});

/**
 * POST /resources/read
 * Read the contents of a specific resource
 */
resourcesApi.post('/read', async (c) => {
  try {
    const body = await c.req.json();
    const validated = ReadResourceSchema.parse(body);

    const resource = resourceRegistry.findResource(validated.uri);
    if (!resource) {
      logger.warn({ uri: validated.uri }, 'Resource not found');
      return c.json(apiResponse(null, false, `Resource not found: ${validated.uri}`), 404);
    }

    const client = connectionPool.getClient(resource.serverId);
    if (!client) {
      logger.warn({ uri: validated.uri, serverId: resource.serverId }, 'Server not connected');
      return c.json(
        apiResponse(null, false, `Server ${resource.serverId} is not connected`),
        503
      );
    }

    logger.info({ uri: validated.uri, serverId: resource.serverId }, 'Reading resource');

    const response = await mcpReadResource(client as Client, validated.uri);

    logger.info({ uri: validated.uri, serverId: resource.serverId }, 'Resource read successfully');

    return c.json(
      apiResponse({
        uri: validated.uri,
        serverId: resource.serverId,
        contents: response.contents,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to read resource');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});

/**
 * GET /resources/server/:serverId
 * Get all resources for a specific server
 */
resourcesApi.get('/server/:serverId', (c) => {
  try {
    const serverId = c.req.param('serverId');

    const resources = resourceRegistry.getServerResources(serverId);

    logger.info({ serverId, count: resources.length }, 'Server resources retrieved');

    return c.json(
      apiResponse({
        serverId,
        resources,
        total: resources.length,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get server resources');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});
