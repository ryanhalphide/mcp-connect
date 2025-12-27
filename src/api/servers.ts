import { Hono } from 'hono';
import { z } from 'zod';
import { MCPServerConfigSchema, type ApiResponse, type MCPServerConfig } from '../core/types.js';
import { serverDatabase } from '../storage/db.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-servers' });

export const serversApi = new Hono();

// Create server input schema (without id, createdAt, updatedAt)
const CreateServerSchema = MCPServerConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update server input schema (partial, without id, createdAt)
const UpdateServerSchema = CreateServerSchema.partial();

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

// GET /servers - List all servers
serversApi.get('/', (c) => {
  const enabledOnly = c.req.query('enabled') === 'true';
  const servers = serverDatabase.getAllServers(enabledOnly);

  // Enhance with connection status
  const enhanced = servers.map((server) => ({
    ...server,
    connectionStatus: connectionPool.getConnectionStatus(server.id),
    toolCount: toolRegistry.getServerToolCount(server.id),
  }));

  return c.json(apiResponse(enhanced));
});

// GET /servers/:id - Get server by ID
serversApi.get('/:id', (c) => {
  const id = c.req.param('id');
  const server = serverDatabase.getServer(id);

  if (!server) {
    c.status(404);
    return c.json(errorResponse(`Server not found: ${id}`));
  }

  const enhanced = {
    ...server,
    connectionStatus: connectionPool.getConnectionStatus(server.id),
    tools: toolRegistry.findToolsByServer(server.id),
  };

  return c.json(apiResponse(enhanced));
});

// POST /servers - Create new server
serversApi.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateServerSchema.parse(body);

    // Check for duplicate name
    const existing = serverDatabase.getServerByName(validated.name);
    if (existing) {
      c.status(409);
      return c.json(errorResponse(`Server with name '${validated.name}' already exists`));
    }

    const server = serverDatabase.saveServer(validated);
    logger.info({ serverId: server.id, serverName: server.name }, 'Server created via API');

    c.status(201);
    return c.json(apiResponse(server));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// PUT /servers/:id - Update server
serversApi.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const validated = UpdateServerSchema.parse(body);

    const updated = serverDatabase.updateServer(id, validated);
    if (!updated) {
      c.status(404);
      return c.json(errorResponse(`Server not found: ${id}`));
    }

    logger.info({ serverId: id }, 'Server updated via API');
    return c.json(apiResponse(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// DELETE /servers/:id - Delete server
serversApi.delete('/:id', async (c) => {
  const id = c.req.param('id');

  // Disconnect if connected
  await connectionPool.disconnect(id);
  toolRegistry.unregisterServer(id);

  const deleted = serverDatabase.deleteServer(id);
  if (!deleted) {
    c.status(404);
    return c.json(errorResponse(`Server not found: ${id}`));
  }

  logger.info({ serverId: id }, 'Server deleted via API');
  return c.json(apiResponse({ deleted: true }));
});

// POST /servers/:id/connect - Connect to server
serversApi.post('/:id/connect', async (c) => {
  const id = c.req.param('id');
  const server = serverDatabase.getServer(id);

  if (!server) {
    c.status(404);
    return c.json(errorResponse(`Server not found: ${id}`));
  }

  try {
    await connectionPool.connect(server);
    const tools = await toolRegistry.registerServer(server);

    logger.info({ serverId: id, toolCount: tools.length }, 'Server connected via API');

    return c.json(apiResponse({
      connected: true,
      status: connectionPool.getConnectionStatus(id),
      tools: tools.map((t) => t.name),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    c.status(500);
    return c.json(errorResponse(message));
  }
});

// POST /servers/:id/disconnect - Disconnect from server
serversApi.post('/:id/disconnect', async (c) => {
  const id = c.req.param('id');

  await connectionPool.disconnect(id);
  toolRegistry.unregisterServer(id);

  logger.info({ serverId: id }, 'Server disconnected via API');

  return c.json(apiResponse({
    disconnected: true,
    status: connectionPool.getConnectionStatus(id),
  }));
});

// GET /servers/:id/tools - Get tools for a server
serversApi.get('/:id/tools', (c) => {
  const id = c.req.param('id');
  const server = serverDatabase.getServer(id);

  if (!server) {
    c.status(404);
    return c.json(errorResponse(`Server not found: ${id}`));
  }

  const tools = toolRegistry.findToolsByServer(id);
  return c.json(apiResponse(tools));
});
