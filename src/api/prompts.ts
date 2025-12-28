import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { promptRegistry } from '../core/promptRegistry.js';
import { connectionPool } from '../core/pool.js';
import { getPrompt as mcpGetPrompt } from '../mcp/client.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'prompts-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

export const promptsApi = new Hono();

// Schema for prompt search query
const PromptSearchQuerySchema = z.object({
  server: z.string().optional(),
  query: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// Schema for get prompt request
const GetPromptSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string()).optional(),
});

/**
 * GET /prompts
 * List all registered prompts with optional filtering
 */
promptsApi.get('/', (c) => {
  try {
    const queryParams = c.req.query();
    const validated = PromptSearchQuerySchema.parse(queryParams);

    const result = promptRegistry.searchPrompts({
      serverId: validated.server,
      query: validated.query,
      limit: validated.limit,
      offset: validated.offset,
    });

    logger.info(
      { total: result.total, returned: result.prompts.length, filters: validated },
      'Prompts listed'
    );

    return c.json(
      apiResponse({
        prompts: result.prompts,
        total: result.total,
        limit: validated.limit,
        offset: validated.offset,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to list prompts');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 400);
  }
});

/**
 * GET /prompts/stats
 * Get prompt statistics
 */
promptsApi.get('/stats', (c) => {
  try {
    const total = promptRegistry.getPromptCount();
    const byServer = promptRegistry.getStatsByServer();

    logger.debug({ total, serverCount: byServer.length }, 'Prompt stats retrieved');

    return c.json(
      apiResponse({
        total,
        byServer,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get prompt stats');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});

/**
 * GET /prompts/:name
 * Get metadata for a specific prompt
 */
promptsApi.get('/:name', (c) => {
  try {
    const name = decodeURIComponent(c.req.param('name'));

    const prompt = promptRegistry.findPrompt(name);
    if (!prompt) {
      logger.warn({ name }, 'Prompt not found');
      return c.json(apiResponse(null, false, `Prompt not found: ${name}`), 404);
    }

    logger.info({ name, serverId: prompt.serverId }, 'Prompt metadata retrieved');

    return c.json(apiResponse(prompt));
  } catch (error) {
    logger.error({ error }, 'Failed to get prompt');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});

/**
 * POST /prompts/get
 * Execute a specific prompt (get prompt with arguments)
 */
promptsApi.post('/get', async (c) => {
  try {
    const body = await c.req.json();
    const validated = GetPromptSchema.parse(body);

    const prompt = promptRegistry.findPrompt(validated.name);
    if (!prompt) {
      logger.warn({ name: validated.name }, 'Prompt not found');
      return c.json(apiResponse(null, false, `Prompt not found: ${validated.name}`), 404);
    }

    const client = connectionPool.getClient(prompt.serverId);
    if (!client) {
      logger.warn({ name: validated.name, serverId: prompt.serverId }, 'Server not connected');
      return c.json(
        apiResponse(null, false, `Server ${prompt.serverId} is not connected`),
        503
      );
    }

    logger.info({ name: validated.name, serverId: prompt.serverId, args: validated.arguments }, 'Getting prompt');

    // Extract the actual prompt name (without server prefix)
    const actualPromptName = validated.name.includes('/')
      ? validated.name.split('/').slice(1).join('/')
      : validated.name;

    const response = await mcpGetPrompt(client as Client, actualPromptName, validated.arguments);

    logger.info({ name: validated.name, serverId: prompt.serverId }, 'Prompt retrieved successfully');

    return c.json(
      apiResponse({
        name: validated.name,
        serverId: prompt.serverId,
        description: response.description,
        messages: response.messages,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get prompt');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});

/**
 * GET /prompts/server/:serverId
 * Get all prompts for a specific server
 */
promptsApi.get('/server/:serverId', (c) => {
  try {
    const serverId = c.req.param('serverId');

    const prompts = promptRegistry.getServerPrompts(serverId);

    logger.info({ serverId, count: prompts.length }, 'Server prompts retrieved');

    return c.json(
      apiResponse({
        serverId,
        prompts,
        total: prompts.length,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get server prompts');
    return c.json(apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'), 500);
  }
});
