import { Hono } from 'hono';
import { z } from 'zod';
import { ServerGroupSchema, type ApiResponse } from '../core/types.js';
import { serverDatabase } from '../storage/db.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-groups' });

export const groupsApi = new Hono();

// Create group input schema (without id, createdAt, updatedAt)
const CreateGroupSchema = ServerGroupSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update group input schema (partial, without id, createdAt)
const UpdateGroupSchema = CreateGroupSchema.partial();

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

// GET /groups - List all groups
groupsApi.get('/', (c) => {
  const groups = serverDatabase.getAllGroups();

  // Enhance with server count
  const enhanced = groups.map((group) => ({
    ...group,
    serverCount: serverDatabase.getGroupServerCount(group.id),
  }));

  return c.json(apiResponse(enhanced));
});

// GET /groups/ungrouped/servers - Get servers not in any group
// IMPORTANT: This must be defined before /:id routes to avoid matching "ungrouped" as an id
groupsApi.get('/ungrouped/servers', (c) => {
  const servers = serverDatabase.getServersByGroup(null);

  // Enhance with connection status
  const enhanced = servers.map((server) => ({
    ...server,
    connectionStatus: connectionPool.getConnectionStatus(server.id),
    toolCount: toolRegistry.getServerToolCount(server.id),
  }));

  return c.json(apiResponse(enhanced));
});

// GET /groups/:id - Get group by ID
groupsApi.get('/:id', (c) => {
  const id = c.req.param('id');
  const group = serverDatabase.getGroup(id);

  if (!group) {
    c.status(404);
    return c.json(errorResponse(`Group not found: ${id}`));
  }

  const servers = serverDatabase.getServersByGroup(id);
  const enhanced = {
    ...group,
    serverCount: servers.length,
    servers: servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      connectionStatus: connectionPool.getConnectionStatus(server.id),
      toolCount: toolRegistry.getServerToolCount(server.id),
    })),
  };

  return c.json(apiResponse(enhanced));
});

// POST /groups - Create new group
groupsApi.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateGroupSchema.parse(body);

    // Check for duplicate name
    const existing = serverDatabase.getGroupByName(validated.name);
    if (existing) {
      c.status(409);
      return c.json(errorResponse(`Group with name '${validated.name}' already exists`));
    }

    const group = serverDatabase.saveGroup(validated);
    logger.info({ groupId: group.id, groupName: group.name }, 'Group created via API');

    c.status(201);
    return c.json(apiResponse(group));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// PUT /groups/:id - Update group
groupsApi.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const validated = UpdateGroupSchema.parse(body);

    // Check for duplicate name if name is being updated
    if (validated.name) {
      const existing = serverDatabase.getGroupByName(validated.name);
      if (existing && existing.id !== id) {
        c.status(409);
        return c.json(errorResponse(`Group with name '${validated.name}' already exists`));
      }
    }

    const updated = serverDatabase.updateGroup(id, validated);
    if (!updated) {
      c.status(404);
      return c.json(errorResponse(`Group not found: ${id}`));
    }

    logger.info({ groupId: id }, 'Group updated via API');
    return c.json(apiResponse(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// DELETE /groups/:id - Delete group
groupsApi.delete('/:id', (c) => {
  const id = c.req.param('id');

  // Check if group exists
  const group = serverDatabase.getGroup(id);
  if (!group) {
    c.status(404);
    return c.json(errorResponse(`Group not found: ${id}`));
  }

  // Servers will have their group_id set to NULL due to ON DELETE SET NULL
  const deleted = serverDatabase.deleteGroup(id);
  if (!deleted) {
    c.status(500);
    return c.json(errorResponse('Failed to delete group'));
  }

  logger.info({ groupId: id }, 'Group deleted via API');
  return c.json(apiResponse({ deleted: true }));
});

// POST /groups/:id/servers - Add server to group
groupsApi.post('/:id/servers', async (c) => {
  try {
    const groupId = c.req.param('id');
    const body = await c.req.json();
    const { serverId } = z.object({ serverId: z.string().uuid() }).parse(body);

    // Check if group exists
    const group = serverDatabase.getGroup(groupId);
    if (!group) {
      c.status(404);
      return c.json(errorResponse(`Group not found: ${groupId}`));
    }

    // Check if server exists
    const server = serverDatabase.getServer(serverId);
    if (!server) {
      c.status(404);
      return c.json(errorResponse(`Server not found: ${serverId}`));
    }

    // Update server's group
    const updated = serverDatabase.updateServer(serverId, { groupId });
    if (!updated) {
      c.status(500);
      return c.json(errorResponse('Failed to add server to group'));
    }

    logger.info({ groupId, serverId }, 'Server added to group');
    return c.json(apiResponse({ added: true, server: updated }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// DELETE /groups/:id/servers/:serverId - Remove server from group
groupsApi.delete('/:id/servers/:serverId', (c) => {
  const groupId = c.req.param('id');
  const serverId = c.req.param('serverId');

  // Check if group exists
  const group = serverDatabase.getGroup(groupId);
  if (!group) {
    c.status(404);
    return c.json(errorResponse(`Group not found: ${groupId}`));
  }

  // Check if server exists and is in this group
  const server = serverDatabase.getServer(serverId);
  if (!server) {
    c.status(404);
    return c.json(errorResponse(`Server not found: ${serverId}`));
  }

  if (server.groupId !== groupId) {
    c.status(400);
    return c.json(errorResponse(`Server '${serverId}' is not in group '${groupId}'`));
  }

  // Remove server from group
  const updated = serverDatabase.updateServer(serverId, { groupId: null });
  if (!updated) {
    c.status(500);
    return c.json(errorResponse('Failed to remove server from group'));
  }

  logger.info({ groupId, serverId }, 'Server removed from group');
  return c.json(apiResponse({ removed: true, server: updated }));
});

// GET /groups/:id/servers - Get servers in group
groupsApi.get('/:id/servers', (c) => {
  const groupId = c.req.param('id');

  // Check if group exists
  const group = serverDatabase.getGroup(groupId);
  if (!group) {
    c.status(404);
    return c.json(errorResponse(`Group not found: ${groupId}`));
  }

  const servers = serverDatabase.getServersByGroup(groupId);

  // Enhance with connection status
  const enhanced = servers.map((server) => ({
    ...server,
    connectionStatus: connectionPool.getConnectionStatus(server.id),
    toolCount: toolRegistry.getServerToolCount(server.id),
  }));

  return c.json(apiResponse(enhanced));
});
