import { Hono } from 'hono';
import { z } from 'zod';
import { MCPServerConfigSchema, type ApiResponse } from '../core/types.js';
import { serverDatabase } from '../storage/db.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { createChildLogger } from '../observability/logger.js';
import { appEvents } from '../core/events.js';

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

// Bulk operations schema
const BulkServerIdsSchema = z.object({
  serverIds: z.array(z.string().uuid()).min(1).max(100),
});

const BulkUpdateSchema = z.object({
  serverIds: z.array(z.string().uuid()).min(1).max(100),
  updates: UpdateServerSchema,
});

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

// =============================================================================
// BULK OPERATIONS - Must be defined before parameterized routes
// =============================================================================

// POST /servers/bulk/connect - Connect to multiple servers
serversApi.post('/bulk/connect', async (c) => {
  try {
    const body = await c.req.json();
    const { serverIds } = BulkServerIdsSchema.parse(body);

    const results: Array<{
      serverId: string;
      serverName: string;
      success: boolean;
      error?: string;
      toolCount?: number;
    }> = [];

    for (const id of serverIds) {
      const server = serverDatabase.getServer(id);
      if (!server) {
        results.push({
          serverId: id,
          serverName: 'unknown',
          success: false,
          error: 'Server not found',
        });
        continue;
      }

      try {
        await connectionPool.connect(server);
        const tools = await toolRegistry.registerServer(server);

        // Discover and register resources and prompts
        let resourceCount = 0;
        let promptCount = 0;
        const client = connectionPool.getClient(id);
        if (client) {
          // Register resources
          try {
            const { listResources } = await import('../mcp/client.js');
            const { resourceRegistry } = await import('../core/resourceRegistry.js');
            const resources = await listResources(client);
            resourceRegistry.registerResources(server, resources);
            resourceCount = resources.length;
          } catch (error) {
            logger.warn(
              { serverId: id, serverName: server.name, error },
              'Failed to register resources (server may not support resources)'
            );
          }

          // Register prompts
          try {
            const { listPrompts } = await import('../mcp/client.js');
            const { promptRegistry } = await import('../core/promptRegistry.js');
            const prompts = await listPrompts(client);
            promptRegistry.registerPrompts(server, prompts);
            promptCount = prompts.length;
          } catch (error) {
            logger.warn(
              { serverId: id, serverName: server.name, error },
              'Failed to register prompts (server may not support prompts)'
            );
          }
        }

        results.push({
          serverId: id,
          serverName: server.name,
          success: true,
          toolCount: tools.length,
        });
        logger.info(
          { serverId: id, serverName: server.name, toolCount: tools.length, resourceCount, promptCount },
          'Server connected via bulk operation'
        );
      } catch (error) {
        results.push({
          serverId: id,
          serverName: server.name,
          success: false,
          error: error instanceof Error ? error.message : 'Connection failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    logger.info({ successCount, failureCount, total: serverIds.length }, 'Bulk connect completed');

    return c.json(apiResponse({
      results,
      summary: {
        total: serverIds.length,
        success: successCount,
        failed: failureCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// POST /servers/bulk/disconnect - Disconnect from multiple servers
serversApi.post('/bulk/disconnect', async (c) => {
  try {
    const body = await c.req.json();
    const { serverIds } = BulkServerIdsSchema.parse(body);

    const results: Array<{
      serverId: string;
      serverName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const id of serverIds) {
      const server = serverDatabase.getServer(id);
      const serverName = server?.name ?? 'unknown';

      try {
        await connectionPool.disconnect(id);
        toolRegistry.unregisterServer(id);

        // Unregister resources and prompts
        const { resourceRegistry } = await import('../core/resourceRegistry.js');
        const { promptRegistry } = await import('../core/promptRegistry.js');
        resourceRegistry.unregisterServer(id);
        promptRegistry.unregisterServer(id);

        results.push({
          serverId: id,
          serverName,
          success: true,
        });
        logger.info({ serverId: id, serverName }, 'Server disconnected via bulk operation');
      } catch (error) {
        results.push({
          serverId: id,
          serverName,
          success: false,
          error: error instanceof Error ? error.message : 'Disconnect failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    logger.info({ successCount, failureCount, total: serverIds.length }, 'Bulk disconnect completed');

    return c.json(apiResponse({
      results,
      summary: {
        total: serverIds.length,
        success: successCount,
        failed: failureCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// POST /servers/bulk/enable - Enable multiple servers
serversApi.post('/bulk/enable', async (c) => {
  try {
    const body = await c.req.json();
    const { serverIds } = BulkServerIdsSchema.parse(body);

    const results: Array<{
      serverId: string;
      serverName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const id of serverIds) {
      try {
        const updated = serverDatabase.updateServer(id, { enabled: true });
        if (!updated) {
          results.push({
            serverId: id,
            serverName: 'unknown',
            success: false,
            error: 'Server not found',
          });
        } else {
          results.push({
            serverId: id,
            serverName: updated.name,
            success: true,
          });
        }
      } catch (error) {
        results.push({
          serverId: id,
          serverName: 'unknown',
          success: false,
          error: error instanceof Error ? error.message : 'Enable failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info({ successCount, total: serverIds.length }, 'Bulk enable completed');

    return c.json(apiResponse({
      results,
      summary: {
        total: serverIds.length,
        success: successCount,
        failed: serverIds.length - successCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// POST /servers/bulk/disable - Disable multiple servers
serversApi.post('/bulk/disable', async (c) => {
  try {
    const body = await c.req.json();
    const { serverIds } = BulkServerIdsSchema.parse(body);

    const results: Array<{
      serverId: string;
      serverName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const id of serverIds) {
      try {
        // Disconnect first if connected
        await connectionPool.disconnect(id);
        toolRegistry.unregisterServer(id);

        const updated = serverDatabase.updateServer(id, { enabled: false });
        if (!updated) {
          results.push({
            serverId: id,
            serverName: 'unknown',
            success: false,
            error: 'Server not found',
          });
        } else {
          results.push({
            serverId: id,
            serverName: updated.name,
            success: true,
          });
        }
      } catch (error) {
        results.push({
          serverId: id,
          serverName: 'unknown',
          success: false,
          error: error instanceof Error ? error.message : 'Disable failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info({ successCount, total: serverIds.length }, 'Bulk disable completed');

    return c.json(apiResponse({
      results,
      summary: {
        total: serverIds.length,
        success: successCount,
        failed: serverIds.length - successCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// PUT /servers/bulk - Update multiple servers
serversApi.put('/bulk', async (c) => {
  try {
    const body = await c.req.json();
    const { serverIds, updates } = BulkUpdateSchema.parse(body);

    const results: Array<{
      serverId: string;
      serverName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const id of serverIds) {
      try {
        const updated = serverDatabase.updateServer(id, updates);
        if (!updated) {
          results.push({
            serverId: id,
            serverName: 'unknown',
            success: false,
            error: 'Server not found',
          });
        } else {
          results.push({
            serverId: id,
            serverName: updated.name,
            success: true,
          });
          logger.info({ serverId: id, serverName: updated.name }, 'Server updated via bulk operation');
        }
      } catch (error) {
        results.push({
          serverId: id,
          serverName: 'unknown',
          success: false,
          error: error instanceof Error ? error.message : 'Update failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    logger.info({ successCount, failureCount, total: serverIds.length }, 'Bulk update completed');

    return c.json(apiResponse({
      results,
      summary: {
        total: serverIds.length,
        success: successCount,
        failed: failureCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// DELETE /servers/bulk - Delete multiple servers
serversApi.delete('/bulk', async (c) => {
  try {
    const body = await c.req.json();
    const { serverIds } = BulkServerIdsSchema.parse(body);

    const results: Array<{
      serverId: string;
      serverName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const id of serverIds) {
      const server = serverDatabase.getServer(id);
      const serverName = server?.name ?? 'unknown';

      try {
        // Disconnect if connected
        await connectionPool.disconnect(id);
        toolRegistry.unregisterServer(id);

        const deleted = serverDatabase.deleteServer(id);
        if (!deleted) {
          results.push({
            serverId: id,
            serverName,
            success: false,
            error: 'Server not found',
          });
        } else {
          results.push({
            serverId: id,
            serverName,
            success: true,
          });
          logger.info({ serverId: id, serverName }, 'Server deleted via bulk operation');
        }
      } catch (error) {
        results.push({
          serverId: id,
          serverName,
          success: false,
          error: error instanceof Error ? error.message : 'Delete failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    logger.info({ successCount, failureCount, total: serverIds.length }, 'Bulk delete completed');

    return c.json(apiResponse({
      results,
      summary: {
        total: serverIds.length,
        success: successCount,
        failed: failureCount,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// =============================================================================
// STANDARD CRUD OPERATIONS
// =============================================================================

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

    // Discover and register resources and prompts
    let resourceCount = 0;
    let promptCount = 0;
    const client = connectionPool.getClient(id);
    if (client) {
      // Register resources
      try {
        const { listResources } = await import('../mcp/client.js');
        const { resourceRegistry } = await import('../core/resourceRegistry.js');
        const resources = await listResources(client);
        resourceRegistry.registerResources(server, resources);
        resourceCount = resources.length;
      } catch (error) {
        logger.warn(
          { serverId: id, serverName: server.name, error },
          'Failed to register resources (server may not support resources)'
        );
      }

      // Register prompts
      try {
        const { listPrompts } = await import('../mcp/client.js');
        const { promptRegistry } = await import('../core/promptRegistry.js');
        const prompts = await listPrompts(client);
        promptRegistry.registerPrompts(server, prompts);
        promptCount = prompts.length;
      } catch (error) {
        logger.warn(
          { serverId: id, serverName: server.name, error },
          'Failed to register prompts (server may not support prompts)'
        );
      }
    }

    logger.info(
      { serverId: id, toolCount: tools.length, resourceCount, promptCount },
      'Server connected via API'
    );

    // Emit SSE event for real-time notifications
    appEvents.emitServerConnected(id, server.name, tools.length);

    return c.json(apiResponse({
      connected: true,
      status: connectionPool.getConnectionStatus(id),
      tools: tools.map((t) => t.name),
      resourceCount,
      promptCount,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    // Emit error event
    appEvents.emitServerError(id, server?.name || 'Unknown', message);
    c.status(500);
    return c.json(errorResponse(message));
  }
});

// POST /servers/:id/disconnect - Disconnect from server
serversApi.post('/:id/disconnect', async (c) => {
  const id = c.req.param('id');
  const server = serverDatabase.getServer(id);
  const serverName = server?.name || 'Unknown';

  await connectionPool.disconnect(id);
  toolRegistry.unregisterServer(id);

  // Unregister resources and prompts
  const { resourceRegistry } = await import('../core/resourceRegistry.js');
  const { promptRegistry } = await import('../core/promptRegistry.js');
  const unregisteredResources = resourceRegistry.unregisterServer(id);
  const unregisteredPrompts = promptRegistry.unregisterServer(id);

  logger.info(
    { serverId: id, unregisteredResources, unregisteredPrompts },
    'Server disconnected via API'
  );

  // Emit SSE event for real-time notifications
  appEvents.emitServerDisconnected(id, serverName);

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
