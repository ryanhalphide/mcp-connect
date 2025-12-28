import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { favoritesApi } from '../../src/api/favorites.js';

// Mock dependencies
const mockGetFavorites = vi.fn(() => []);
const mockGetFavoriteCount = vi.fn(() => 0);
const mockGetMostFavorited = vi.fn(() => []);
const mockAddFavorite = vi.fn();
const mockRemoveFavorite = vi.fn(() => false);
const mockIsFavorite = vi.fn(() => false);
const mockUpdateNotes = vi.fn(() => false);
const mockClearFavorites = vi.fn(() => 0);

vi.mock('../../src/storage/favorites.js', () => ({
  favoriteStore: {
    getFavorites: (apiKeyId: string) => mockGetFavorites(apiKeyId),
    getFavoriteCount: (apiKeyId: string) => mockGetFavoriteCount(apiKeyId),
    getMostFavorited: (limit: number) => mockGetMostFavorited(limit),
    addFavorite: (apiKeyId: string, toolName: string, notes?: string) =>
      mockAddFavorite(apiKeyId, toolName, notes),
    removeFavorite: (apiKeyId: string, toolName: string) => mockRemoveFavorite(apiKeyId, toolName),
    isFavorite: (apiKeyId: string, toolName: string) => mockIsFavorite(apiKeyId, toolName),
    updateNotes: (apiKeyId: string, toolName: string, notes: string) =>
      mockUpdateNotes(apiKeyId, toolName, notes),
    clearFavorites: (apiKeyId: string) => mockClearFavorites(apiKeyId),
  },
}));

const mockFindTool = vi.fn();

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    findTool: (name: string) => mockFindTool(name),
  },
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Favorites API', () => {
  let app: Hono;
  const testApiKeyId = 'test-api-key-123';

  const testFavorite = {
    id: 1,
    apiKeyId: testApiKeyId,
    toolName: 'filesystem/read_file',
    notes: 'Useful for reading config files',
    createdAt: new Date(),
  };

  const testTool = {
    name: 'filesystem/read_file',
    serverId: '123e4567-e89b-12d3-a456-426614174000',
    serverName: 'filesystem',
    description: 'Read a file from disk',
    category: 'filesystem',
    tags: ['read', 'file'],
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    registeredAt: new Date(),
  };

  beforeEach(() => {
    app = new Hono();
    // Add middleware to set apiKeyId
    app.use('*', async (c, next) => {
      c.set('apiKeyId', testApiKeyId);
      await next();
    });
    app.route('/favorites', favoritesApi);
    vi.clearAllMocks();
  });

  describe('GET /favorites', () => {
    it('should return all favorites for the current API key', async () => {
      mockGetFavorites.mockReturnValue([testFavorite]);
      mockFindTool.mockReturnValue(testTool);

      const res = await app.request('/favorites');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.favorites).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(json.data.favorites[0].toolName).toBe('filesystem/read_file');
      expect(json.data.favorites[0].tool).toBeDefined();
      expect(json.data.favorites[0].tool.name).toBe('filesystem/read_file');
    });

    it('should return empty array when no favorites', async () => {
      mockGetFavorites.mockReturnValue([]);

      const res = await app.request('/favorites');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.favorites).toEqual([]);
      expect(json.data.count).toBe(0);
    });

    it('should handle tool not found in registry', async () => {
      mockGetFavorites.mockReturnValue([testFavorite]);
      mockFindTool.mockReturnValue(undefined);

      const res = await app.request('/favorites');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.favorites[0].tool).toBeNull();
    });

    it('should return 401 when no API key', async () => {
      // Create app without API key middleware
      const appWithoutAuth = new Hono();
      appWithoutAuth.route('/favorites', favoritesApi);

      const res = await appWithoutAuth.request('/favorites');
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('API key required');
    });
  });

  describe('GET /favorites/stats', () => {
    it('should return favorite statistics', async () => {
      mockGetFavoriteCount.mockReturnValue(5);
      mockGetMostFavorited.mockReturnValue([
        { toolName: 'filesystem/read_file', count: 10 },
        { toolName: 'memory/store', count: 8 },
      ]);

      const res = await app.request('/favorites/stats');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.userFavoriteCount).toBe(5);
      expect(json.data.mostFavorited).toHaveLength(2);
      expect(json.data.mostFavorited[0].toolName).toBe('filesystem/read_file');
    });
  });

  describe('POST /favorites/:toolName', () => {
    it('should add a tool to favorites', async () => {
      mockFindTool.mockReturnValue(testTool);
      mockAddFavorite.mockReturnValue(testFavorite);

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'My favorite tool' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.favorite.toolName).toBe('filesystem/read_file');
      expect(json.data.tool.name).toBe('filesystem/read_file');
      expect(mockAddFavorite).toHaveBeenCalledWith(testApiKeyId, 'filesystem/read_file', 'My favorite tool');
    });

    it('should add favorite without notes', async () => {
      mockFindTool.mockReturnValue(testTool);
      mockAddFavorite.mockReturnValue({ ...testFavorite, notes: undefined });

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockAddFavorite).toHaveBeenCalledWith(testApiKeyId, 'filesystem/read_file', undefined);
    });

    it('should return 404 when tool not found', async () => {
      mockFindTool.mockReturnValue(undefined);

      const res = await app.request('/favorites/unknown/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Tool not found');
    });

    it('should handle tools with slashes in name', async () => {
      const nestedTool = { ...testTool, name: 'server/category/tool_name' };
      mockFindTool.mockReturnValue(nestedTool);
      mockAddFavorite.mockReturnValue({ ...testFavorite, toolName: 'server/category/tool_name' });

      const res = await app.request('/favorites/server/category/tool_name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockFindTool).toHaveBeenCalledWith('server/category/tool_name');
    });

    it('should validate notes length', async () => {
      mockFindTool.mockReturnValue(testTool);

      const longNotes = 'a'.repeat(501); // Exceeds 500 char limit
      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: longNotes }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Validation error');
    });
  });

  describe('PUT /favorites/:toolName', () => {
    it('should update notes for a favorite', async () => {
      mockIsFavorite.mockReturnValue(true);
      mockUpdateNotes.mockReturnValue(true);

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Updated notes' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toBe(true);
      expect(json.data.notes).toBe('Updated notes');
      expect(mockUpdateNotes).toHaveBeenCalledWith(testApiKeyId, 'filesystem/read_file', 'Updated notes');
    });

    it('should return 404 when tool is not favorited', async () => {
      mockIsFavorite.mockReturnValue(false);

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Updated notes' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('not in favorites');
    });

    it('should return 500 when update fails', async () => {
      mockIsFavorite.mockReturnValue(true);
      mockUpdateNotes.mockReturnValue(false);

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Updated notes' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Failed to update');
    });

    it('should validate notes is required', async () => {
      mockIsFavorite.mockReturnValue(true);

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Validation error');
    });
  });

  describe('DELETE /favorites/:toolName', () => {
    it('should remove a tool from favorites', async () => {
      mockRemoveFavorite.mockReturnValue(true);

      const res = await app.request('/favorites/filesystem/read_file', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.removed).toBe(true);
      expect(mockRemoveFavorite).toHaveBeenCalledWith(testApiKeyId, 'filesystem/read_file');
    });

    it('should return 404 when tool is not favorited', async () => {
      mockRemoveFavorite.mockReturnValue(false);

      const res = await app.request('/favorites/unknown/tool', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('not in favorites');
    });
  });

  describe('GET /favorites/check/:toolName', () => {
    it('should return true when tool is favorited', async () => {
      mockIsFavorite.mockReturnValue(true);

      const res = await app.request('/favorites/check/filesystem/read_file');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.isFavorite).toBe(true);
    });

    it('should return false when tool is not favorited', async () => {
      mockIsFavorite.mockReturnValue(false);

      const res = await app.request('/favorites/check/unknown/tool');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.isFavorite).toBe(false);
    });
  });

  describe('DELETE /favorites', () => {
    it('should clear all favorites', async () => {
      mockClearFavorites.mockReturnValue(5);

      const res = await app.request('/favorites', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.cleared).toBe(true);
      expect(json.data.count).toBe(5);
      expect(mockClearFavorites).toHaveBeenCalledWith(testApiKeyId);
    });

    it('should handle clearing empty favorites', async () => {
      mockClearFavorites.mockReturnValue(0);

      const res = await app.request('/favorites', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.count).toBe(0);
    });
  });
});
