import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { favoriteStore } from '../storage/favorites.js';
import { toolRegistry } from '../core/registry.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-favorites' });

export const favoritesApi = new Hono();

// Schema for adding a favorite
const AddFavoriteSchema = z.object({
  notes: z.string().max(500).optional(),
});

// Schema for updating notes
const UpdateNotesSchema = z.object({
  notes: z.string().max(500),
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

// Extract API key ID from context (set by auth middleware)
function getApiKeyId(c: any): string | null {
  // The auth middleware stores the key in the context
  return c.get('apiKeyId') || null;
}

// GET /favorites - List all favorites for the current API key
favoritesApi.get('/', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const favorites = favoriteStore.getFavorites(apiKeyId);

  // Enhance with tool details
  const enhanced = favorites.map((fav) => {
    const tool = toolRegistry.findTool(fav.toolName);
    return {
      ...fav,
      tool: tool
        ? {
            name: tool.name,
            serverName: tool.serverName,
            description: tool.description,
            category: tool.category,
            tags: tool.tags,
          }
        : null,
    };
  });

  return c.json(apiResponse({
    favorites: enhanced,
    count: enhanced.length,
  }));
});

// GET /favorites/stats - Get favorite statistics
favoritesApi.get('/stats', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const count = favoriteStore.getFavoriteCount(apiKeyId);
  const mostFavorited = favoriteStore.getMostFavorited(10);

  return c.json(apiResponse({
    userFavoriteCount: count,
    mostFavorited,
  }));
});

// POST /favorites/:toolName - Add a tool to favorites
favoritesApi.post('/:toolName{.+}', async (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const toolName = c.req.param('toolName');

  // Check if tool exists
  const tool = toolRegistry.findTool(toolName);
  if (!tool) {
    c.status(404);
    return c.json(errorResponse(`Tool not found: ${toolName}`));
  }

  try {
    let notes: string | undefined;

    // Try to parse body for notes (optional)
    try {
      const body = await c.req.json();
      const validated = AddFavoriteSchema.parse(body);
      notes = validated.notes;
    } catch (parseError) {
      // If it's a Zod validation error, rethrow it
      if (parseError instanceof z.ZodError) {
        throw parseError;
      }
      // No body or non-validation error, ignore
    }

    const favorite = favoriteStore.addFavorite(apiKeyId, tool.name, notes);

    logger.info({ apiKeyId, toolName: tool.name }, 'Tool added to favorites');

    return c.json(apiResponse({
      favorite,
      tool: {
        name: tool.name,
        serverName: tool.serverName,
        description: tool.description,
        category: tool.category,
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

// PUT /favorites/:toolName - Update notes for a favorite
favoritesApi.put('/:toolName{.+}', async (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const toolName = c.req.param('toolName');

  // Check if it's a favorite
  if (!favoriteStore.isFavorite(apiKeyId, toolName)) {
    c.status(404);
    return c.json(errorResponse(`Tool is not in favorites: ${toolName}`));
  }

  try {
    const body = await c.req.json();
    const { notes } = UpdateNotesSchema.parse(body);

    const updated = favoriteStore.updateNotes(apiKeyId, toolName, notes);
    if (!updated) {
      c.status(500);
      return c.json(errorResponse('Failed to update notes'));
    }

    return c.json(apiResponse({ updated: true, notes }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    throw error;
  }
});

// DELETE /favorites/:toolName - Remove a tool from favorites
favoritesApi.delete('/:toolName{.+}', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const toolName = c.req.param('toolName');

  const removed = favoriteStore.removeFavorite(apiKeyId, toolName);
  if (!removed) {
    c.status(404);
    return c.json(errorResponse(`Tool is not in favorites: ${toolName}`));
  }

  logger.info({ apiKeyId, toolName }, 'Tool removed from favorites');

  return c.json(apiResponse({ removed: true }));
});

// GET /favorites/check/:toolName - Check if a tool is favorited
favoritesApi.get('/check/:toolName{.+}', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const toolName = c.req.param('toolName');
  const isFavorite = favoriteStore.isFavorite(apiKeyId, toolName);

  return c.json(apiResponse({ isFavorite }));
});

// DELETE /favorites - Clear all favorites
favoritesApi.delete('/', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const count = favoriteStore.clearFavorites(apiKeyId);

  logger.info({ apiKeyId, count }, 'All favorites cleared');

  return c.json(apiResponse({ cleared: true, count }));
});
