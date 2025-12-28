import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { FavoriteStore } from '../../src/storage/favorites.js';

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('FavoriteStore', () => {
  let db: Database.Database;
  let store: FavoriteStore;
  const testApiKeyId = 'test-api-key-123';
  const testApiKeyId2 = 'test-api-key-456';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new FavoriteStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('addFavorite', () => {
    it('should add a new favorite', () => {
      const favorite = store.addFavorite(testApiKeyId, 'filesystem/read_file');

      expect(favorite.id).toBeDefined();
      expect(favorite.apiKeyId).toBe(testApiKeyId);
      expect(favorite.toolName).toBe('filesystem/read_file');
      expect(favorite.notes).toBeUndefined();
      expect(favorite.createdAt).toBeInstanceOf(Date);
    });

    it('should add a favorite with notes', () => {
      const favorite = store.addFavorite(testApiKeyId, 'memory/store', 'For caching data');

      expect(favorite.notes).toBe('For caching data');
    });

    it('should replace existing favorite (upsert)', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file', 'Original notes');
      const updated = store.addFavorite(testApiKeyId, 'filesystem/read_file', 'Updated notes');

      expect(updated.notes).toBe('Updated notes');

      const favorites = store.getFavorites(testApiKeyId);
      expect(favorites).toHaveLength(1);
    });

    it('should handle multiple favorites for same tool by different users', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file');
      store.addFavorite(testApiKeyId2, 'filesystem/read_file');

      const favorites1 = store.getFavorites(testApiKeyId);
      const favorites2 = store.getFavorites(testApiKeyId2);

      expect(favorites1).toHaveLength(1);
      expect(favorites2).toHaveLength(1);
    });
  });

  describe('removeFavorite', () => {
    it('should remove an existing favorite', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file');

      const removed = store.removeFavorite(testApiKeyId, 'filesystem/read_file');

      expect(removed).toBe(true);
      expect(store.getFavorites(testApiKeyId)).toHaveLength(0);
    });

    it('should return false when favorite does not exist', () => {
      const removed = store.removeFavorite(testApiKeyId, 'unknown/tool');

      expect(removed).toBe(false);
    });

    it('should not affect other users favorites', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file');
      store.addFavorite(testApiKeyId2, 'filesystem/read_file');

      store.removeFavorite(testApiKeyId, 'filesystem/read_file');

      expect(store.getFavorites(testApiKeyId)).toHaveLength(0);
      expect(store.getFavorites(testApiKeyId2)).toHaveLength(1);
    });
  });

  describe('isFavorite', () => {
    it('should return true when tool is favorited', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file');

      expect(store.isFavorite(testApiKeyId, 'filesystem/read_file')).toBe(true);
    });

    it('should return false when tool is not favorited', () => {
      expect(store.isFavorite(testApiKeyId, 'unknown/tool')).toBe(false);
    });

    it('should return false for different user', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file');

      expect(store.isFavorite(testApiKeyId2, 'filesystem/read_file')).toBe(false);
    });
  });

  describe('getFavorites', () => {
    it('should return empty array when no favorites', () => {
      const favorites = store.getFavorites(testApiKeyId);

      expect(favorites).toEqual([]);
    });

    it('should return all favorites for user', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file');
      store.addFavorite(testApiKeyId, 'memory/store');
      store.addFavorite(testApiKeyId, 'github/search');

      const favorites = store.getFavorites(testApiKeyId);

      expect(favorites).toHaveLength(3);
      expect(favorites.map((f) => f.toolName)).toContain('filesystem/read_file');
      expect(favorites.map((f) => f.toolName)).toContain('memory/store');
      expect(favorites.map((f) => f.toolName)).toContain('github/search');
    });

    it('should return favorites ordered by creation date (newest first)', async () => {
      store.addFavorite(testApiKeyId, 'tool1');
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.addFavorite(testApiKeyId, 'tool2');
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.addFavorite(testApiKeyId, 'tool3');

      const favorites = store.getFavorites(testApiKeyId);

      expect(favorites[0].toolName).toBe('tool3');
      expect(favorites[2].toolName).toBe('tool1');
    });

    it('should only return favorites for specified user', () => {
      store.addFavorite(testApiKeyId, 'tool1');
      store.addFavorite(testApiKeyId, 'tool2');
      store.addFavorite(testApiKeyId2, 'tool3');

      const favorites = store.getFavorites(testApiKeyId);

      expect(favorites).toHaveLength(2);
      expect(favorites.every((f) => f.apiKeyId === testApiKeyId)).toBe(true);
    });
  });

  describe('getFavoriteCount', () => {
    it('should return 0 when no favorites', () => {
      expect(store.getFavoriteCount(testApiKeyId)).toBe(0);
    });

    it('should return correct count', () => {
      store.addFavorite(testApiKeyId, 'tool1');
      store.addFavorite(testApiKeyId, 'tool2');
      store.addFavorite(testApiKeyId, 'tool3');

      expect(store.getFavoriteCount(testApiKeyId)).toBe(3);
    });

    it('should only count favorites for specified user', () => {
      store.addFavorite(testApiKeyId, 'tool1');
      store.addFavorite(testApiKeyId, 'tool2');
      store.addFavorite(testApiKeyId2, 'tool3');
      store.addFavorite(testApiKeyId2, 'tool4');
      store.addFavorite(testApiKeyId2, 'tool5');

      expect(store.getFavoriteCount(testApiKeyId)).toBe(2);
      expect(store.getFavoriteCount(testApiKeyId2)).toBe(3);
    });
  });

  describe('getMostFavorited', () => {
    it('should return empty array when no favorites', () => {
      expect(store.getMostFavorited()).toEqual([]);
    });

    it('should return tools ordered by favorite count', () => {
      // Tool1 favorited by 3 users
      store.addFavorite('user1', 'tool1');
      store.addFavorite('user2', 'tool1');
      store.addFavorite('user3', 'tool1');

      // Tool2 favorited by 2 users
      store.addFavorite('user1', 'tool2');
      store.addFavorite('user2', 'tool2');

      // Tool3 favorited by 1 user
      store.addFavorite('user1', 'tool3');

      const mostFavorited = store.getMostFavorited();

      expect(mostFavorited).toHaveLength(3);
      expect(mostFavorited[0].toolName).toBe('tool1');
      expect(mostFavorited[0].count).toBe(3);
      expect(mostFavorited[1].toolName).toBe('tool2');
      expect(mostFavorited[1].count).toBe(2);
      expect(mostFavorited[2].toolName).toBe('tool3');
      expect(mostFavorited[2].count).toBe(1);
    });

    it('should respect limit parameter', () => {
      store.addFavorite('user1', 'tool1');
      store.addFavorite('user1', 'tool2');
      store.addFavorite('user1', 'tool3');
      store.addFavorite('user1', 'tool4');
      store.addFavorite('user1', 'tool5');

      const mostFavorited = store.getMostFavorited(3);

      expect(mostFavorited).toHaveLength(3);
    });
  });

  describe('updateNotes', () => {
    it('should update notes for existing favorite', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file', 'Original');

      const updated = store.updateNotes(testApiKeyId, 'filesystem/read_file', 'Updated notes');

      expect(updated).toBe(true);

      const favorites = store.getFavorites(testApiKeyId);
      expect(favorites[0].notes).toBe('Updated notes');
    });

    it('should return false when favorite does not exist', () => {
      const updated = store.updateNotes(testApiKeyId, 'unknown/tool', 'Notes');

      expect(updated).toBe(false);
    });

    it('should not affect other users favorites', () => {
      store.addFavorite(testApiKeyId, 'filesystem/read_file', 'User1 notes');
      store.addFavorite(testApiKeyId2, 'filesystem/read_file', 'User2 notes');

      store.updateNotes(testApiKeyId, 'filesystem/read_file', 'Updated User1');

      const favorites1 = store.getFavorites(testApiKeyId);
      const favorites2 = store.getFavorites(testApiKeyId2);

      expect(favorites1[0].notes).toBe('Updated User1');
      expect(favorites2[0].notes).toBe('User2 notes');
    });
  });

  describe('clearFavorites', () => {
    it('should clear all favorites for user', () => {
      store.addFavorite(testApiKeyId, 'tool1');
      store.addFavorite(testApiKeyId, 'tool2');
      store.addFavorite(testApiKeyId, 'tool3');

      const count = store.clearFavorites(testApiKeyId);

      expect(count).toBe(3);
      expect(store.getFavorites(testApiKeyId)).toHaveLength(0);
    });

    it('should return 0 when no favorites to clear', () => {
      const count = store.clearFavorites(testApiKeyId);

      expect(count).toBe(0);
    });

    it('should not affect other users favorites', () => {
      store.addFavorite(testApiKeyId, 'tool1');
      store.addFavorite(testApiKeyId, 'tool2');
      store.addFavorite(testApiKeyId2, 'tool3');

      store.clearFavorites(testApiKeyId);

      expect(store.getFavorites(testApiKeyId)).toHaveLength(0);
      expect(store.getFavorites(testApiKeyId2)).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle tool names with special characters', () => {
      store.addFavorite(testApiKeyId, 'server-name/tool_with-special.chars');

      const favorites = store.getFavorites(testApiKeyId);
      expect(favorites[0].toolName).toBe('server-name/tool_with-special.chars');
    });

    it('should handle empty notes as undefined', () => {
      const favorite = store.addFavorite(testApiKeyId, 'tool', '');

      // Empty string converted to undefined when retrieved
      expect(store.getFavorites(testApiKeyId)[0].notes).toBeUndefined();
    });

    it('should handle unicode in notes', () => {
      store.addFavorite(testApiKeyId, 'tool', 'Notes with emoji 🚀 and unicode ñ');

      const favorites = store.getFavorites(testApiKeyId);
      expect(favorites[0].notes).toBe('Notes with emoji 🚀 and unicode ñ');
    });
  });
});
