import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

// Ensure data directory exists BEFORE importing the module
// (the module creates a singleton on import)
if (!existsSync('./data')) {
  mkdirSync('./data', { recursive: true });
}

import { ApiKeyStore } from '../../src/storage/apiKeys.js';

const TEST_DB_PATH = './data/test-api-keys.db';

describe('ApiKeyStore', () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    store = new ApiKeyStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('generateApiKey', () => {
    it('should generate a key with mcp_live_ prefix', () => {
      const key = store.generateApiKey();
      expect(key).toMatch(/^mcp_live_[a-f0-9]{64}$/);
    });

    it('should generate unique keys', () => {
      const key1 = store.generateApiKey();
      const key2 = store.generateApiKey();
      expect(key1).not.toBe(key2);
    });

    it('should generate keys with 64 hex characters after prefix', () => {
      const key = store.generateApiKey();
      const hexPart = key.replace('mcp_live_', '');
      expect(hexPart).toHaveLength(64);
      expect(hexPart).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('createApiKey', () => {
    it('should create a new API key with name', () => {
      const apiKey = store.createApiKey('Test Key');

      expect(apiKey.name).toBe('Test Key');
      expect(apiKey.key).toMatch(/^mcp_live_/);
      expect(apiKey.id).toHaveLength(32); // 16 bytes as hex
      expect(apiKey.enabled).toBe(true);
      expect(apiKey.lastUsedAt).toBeNull();
      expect(apiKey.createdAt).toBeDefined();
      expect(apiKey.metadata).toEqual({});
    });

    it('should create a key with metadata', () => {
      const metadata = {
        description: 'Production API key',
        scopes: ['read', 'write'],
        customField: 'value',
      };

      const apiKey = store.createApiKey('Production Key', metadata);

      expect(apiKey.metadata).toEqual(metadata);
      expect(apiKey.metadata.description).toBe('Production API key');
      expect(apiKey.metadata.scopes).toEqual(['read', 'write']);
    });

    it('should persist the key in database', () => {
      const apiKey = store.createApiKey('Persistent Key');

      const retrieved = store.getApiKeyById(apiKey.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Persistent Key');
    });

    it('should create multiple keys with unique IDs', () => {
      const key1 = store.createApiKey('Key 1');
      const key2 = store.createApiKey('Key 2');
      const key3 = store.createApiKey('Key 3');

      expect(key1.id).not.toBe(key2.id);
      expect(key2.id).not.toBe(key3.id);
      expect(key1.key).not.toBe(key2.key);
    });
  });

  describe('validateApiKey', () => {
    it('should return key info for valid enabled key', () => {
      const created = store.createApiKey('Valid Key');
      const validated = store.validateApiKey(created.key);

      expect(validated).not.toBeNull();
      expect(validated?.id).toBe(created.id);
      expect(validated?.name).toBe('Valid Key');
      expect(validated?.enabled).toBe(true);
    });

    it('should return null for non-existent key', () => {
      const result = store.validateApiKey('mcp_live_nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for disabled key', () => {
      const created = store.createApiKey('Disabled Key');
      store.revokeApiKey(created.id);

      const result = store.validateApiKey(created.key);
      expect(result).toBeNull();
    });

    it('should update lastUsedAt on validation', async () => {
      const created = store.createApiKey('Usage Tracked Key');
      expect(created.lastUsedAt).toBeNull();

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      store.validateApiKey(created.key);

      const retrieved = store.getApiKeyById(created.id);
      expect(retrieved?.lastUsedAt).not.toBeNull();
    });

    it('should return metadata with validated key', () => {
      const metadata = { scopes: ['admin'], env: 'production' };
      const created = store.createApiKey('Metadata Key', metadata);

      const validated = store.validateApiKey(created.key);

      expect(validated?.metadata).toEqual(metadata);
    });
  });

  describe('getAllApiKeys', () => {
    it('should return empty array when no keys exist', () => {
      const keys = store.getAllApiKeys();
      expect(keys).toEqual([]);
    });

    it('should return all keys without exposing actual key value', () => {
      store.createApiKey('Key A');
      store.createApiKey('Key B');
      store.createApiKey('Key C');

      const keys = store.getAllApiKeys();

      expect(keys).toHaveLength(3);
      keys.forEach((key) => {
        expect(key).not.toHaveProperty('key');
        expect(key).toHaveProperty('id');
        expect(key).toHaveProperty('name');
        expect(key).toHaveProperty('enabled');
      });
    });

    it('should return keys ordered by createdAt descending', async () => {
      store.createApiKey('First');
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.createApiKey('Second');
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.createApiKey('Third');

      const keys = store.getAllApiKeys();

      expect(keys[0].name).toBe('Third');
      expect(keys[1].name).toBe('Second');
      expect(keys[2].name).toBe('First');
    });

    it('should include both enabled and disabled keys', () => {
      const key1 = store.createApiKey('Enabled');
      const key2 = store.createApiKey('Disabled');
      store.revokeApiKey(key2.id);

      const keys = store.getAllApiKeys();

      expect(keys).toHaveLength(2);
      const enabledKey = keys.find((k) => k.name === 'Enabled');
      const disabledKey = keys.find((k) => k.name === 'Disabled');
      expect(enabledKey?.enabled).toBe(true);
      expect(disabledKey?.enabled).toBe(false);
    });
  });

  describe('getApiKeyById', () => {
    it('should return key info by ID', () => {
      const created = store.createApiKey('Findable Key', { tag: 'test' });

      const found = store.getApiKeyById(created.id);

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Findable Key');
      expect(found?.metadata).toEqual({ tag: 'test' });
    });

    it('should return null for non-existent ID', () => {
      const result = store.getApiKeyById('nonexistent-id');
      expect(result).toBeNull();
    });

    it('should not expose actual key value', () => {
      const created = store.createApiKey('Secret Key');

      const found = store.getApiKeyById(created.id);

      expect(found).not.toHaveProperty('key');
    });

    it('should return disabled keys', () => {
      const created = store.createApiKey('Revoked Key');
      store.revokeApiKey(created.id);

      const found = store.getApiKeyById(created.id);

      expect(found).not.toBeNull();
      expect(found?.enabled).toBe(false);
    });
  });

  describe('revokeApiKey', () => {
    it('should disable an enabled key', () => {
      const created = store.createApiKey('To Revoke');

      const result = store.revokeApiKey(created.id);

      expect(result).toBe(true);
      const found = store.getApiKeyById(created.id);
      expect(found?.enabled).toBe(false);
    });

    it('should return false for non-existent key', () => {
      const result = store.revokeApiKey('nonexistent-id');
      expect(result).toBe(false);
    });

    it('should return true when revoking already revoked key', () => {
      const created = store.createApiKey('Already Revoked');
      store.revokeApiKey(created.id);

      // Revoking again still returns true (row exists, just no changes)
      const result = store.revokeApiKey(created.id);
      expect(result).toBe(true);
    });

    it('should make key fail validation after revocation', () => {
      const created = store.createApiKey('Revoke Test');

      // Should validate before revocation
      expect(store.validateApiKey(created.key)).not.toBeNull();

      store.revokeApiKey(created.id);

      // Should fail validation after revocation
      expect(store.validateApiKey(created.key)).toBeNull();
    });
  });

  describe('enableApiKey', () => {
    it('should enable a disabled key', () => {
      const created = store.createApiKey('To Enable');
      store.revokeApiKey(created.id);

      const result = store.enableApiKey(created.id);

      expect(result).toBe(true);
      const found = store.getApiKeyById(created.id);
      expect(found?.enabled).toBe(true);
    });

    it('should return false for non-existent key', () => {
      const result = store.enableApiKey('nonexistent-id');
      expect(result).toBe(false);
    });

    it('should return true when enabling already enabled key', () => {
      const created = store.createApiKey('Already Enabled');

      const result = store.enableApiKey(created.id);
      expect(result).toBe(true);
    });

    it('should make key pass validation after re-enabling', () => {
      const created = store.createApiKey('Re-enable Test');
      store.revokeApiKey(created.id);

      // Should fail validation when revoked
      expect(store.validateApiKey(created.key)).toBeNull();

      store.enableApiKey(created.id);

      // Should pass validation after re-enabling
      expect(store.validateApiKey(created.key)).not.toBeNull();
    });
  });

  describe('deleteApiKey', () => {
    it('should permanently delete a key', () => {
      const created = store.createApiKey('To Delete');

      const result = store.deleteApiKey(created.id);

      expect(result).toBe(true);
      expect(store.getApiKeyById(created.id)).toBeNull();
    });

    it('should return false for non-existent key', () => {
      const result = store.deleteApiKey('nonexistent-id');
      expect(result).toBe(false);
    });

    it('should remove key from getAllApiKeys', () => {
      const key1 = store.createApiKey('Keep');
      const key2 = store.createApiKey('Delete');

      store.deleteApiKey(key2.id);

      const allKeys = store.getAllApiKeys();
      expect(allKeys).toHaveLength(1);
      expect(allKeys[0].id).toBe(key1.id);
    });

    it('should make key unvalidatable after deletion', () => {
      const created = store.createApiKey('Delete Validation Test');
      const keyValue = created.key;

      store.deleteApiKey(created.id);

      expect(store.validateApiKey(keyValue)).toBeNull();
    });

    it('should allow creating new key with same name after deletion', () => {
      const original = store.createApiKey('Reusable Name');
      store.deleteApiKey(original.id);

      const newKey = store.createApiKey('Reusable Name');

      expect(newKey.id).not.toBe(original.id);
      expect(newKey.name).toBe('Reusable Name');
    });
  });

  describe('database persistence', () => {
    it('should persist keys across store instances', () => {
      const created = store.createApiKey('Persistent', { env: 'test' });
      store.close();

      // Create new store instance with same database
      const newStore = new ApiKeyStore(TEST_DB_PATH);
      const found = newStore.getApiKeyById(created.id);

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Persistent');
      expect(found?.metadata).toEqual({ env: 'test' });

      newStore.close();
    });

    it('should persist revocation status', () => {
      const created = store.createApiKey('Revoke Persist');
      store.revokeApiKey(created.id);
      store.close();

      const newStore = new ApiKeyStore(TEST_DB_PATH);
      const found = newStore.getApiKeyById(created.id);

      expect(found?.enabled).toBe(false);

      newStore.close();
    });
  });

  describe('edge cases', () => {
    it('should handle empty metadata object', () => {
      const key = store.createApiKey('Empty Meta', {});
      expect(key.metadata).toEqual({});

      const validated = store.validateApiKey(key.key);
      expect(validated?.metadata).toEqual({});
    });

    it('should handle complex nested metadata', () => {
      const metadata = {
        nested: {
          deep: {
            value: 123,
            array: [1, 2, 3],
          },
        },
        nullValue: null,
        boolValue: false,
      };

      const key = store.createApiKey('Complex Meta', metadata as any);
      const validated = store.validateApiKey(key.key);

      expect(validated?.metadata).toEqual(metadata);
    });

    it('should handle special characters in name', () => {
      const name = "Test Key with 'quotes' and \"doubles\" & symbols!";
      const key = store.createApiKey(name);

      expect(key.name).toBe(name);
      const found = store.getApiKeyById(key.id);
      expect(found?.name).toBe(name);
    });

    it('should handle unicode in metadata', () => {
      const metadata = {
        description: 'Key for 日本語 support 🔑',
        region: 'アジア',
      };

      const key = store.createApiKey('Unicode Key', metadata);
      const validated = store.validateApiKey(key.key);

      expect(validated?.metadata).toEqual(metadata);
    });
  });
});
