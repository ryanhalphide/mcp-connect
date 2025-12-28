import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  authMiddleware,
  optionalAuthMiddleware,
  masterKeyMiddleware,
} from '../../src/middleware/auth.js';

// Mock the apiKeyStore
const mockValidateApiKey = vi.fn();
vi.mock('../../src/storage/apiKeys.js', () => ({
  apiKeyStore: {
    validateApiKey: (key: string) => mockValidateApiKey(key),
  },
}));

// Mock the logger
vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Auth Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MASTER_API_KEY;
  });

  describe('authMiddleware', () => {
    beforeEach(() => {
      app = new Hono();
      app.use('/protected/*', authMiddleware);
      app.get('/protected/resource', (c) => {
        const apiKey = c.get('apiKey');
        return c.json({ message: 'success', keyId: apiKey?.id });
      });
    });

    it('should return 401 when no API key provided', async () => {
      const res = await app.request('/protected/resource');
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Authentication required');
    });

    it('should authenticate with Authorization Bearer header', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'key-123',
        name: 'Test Key',
        key: 'mcp_live_test123',
        enabled: true,
      });

      const res = await app.request('/protected/resource', {
        headers: {
          Authorization: 'Bearer mcp_live_test123',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe('success');
      expect(json.keyId).toBe('key-123');
      expect(mockValidateApiKey).toHaveBeenCalledWith('mcp_live_test123');
    });

    it('should authenticate with x-api-key header', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'key-456',
        name: 'API Key',
        key: 'mcp_live_apikey',
        enabled: true,
      });

      const res = await app.request('/protected/resource', {
        headers: {
          'x-api-key': 'mcp_live_apikey',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.keyId).toBe('key-456');
    });

    it('should authenticate with api_key query parameter', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'key-789',
        name: 'Query Key',
        key: 'mcp_live_querykey',
        enabled: true,
      });

      const res = await app.request('/protected/resource?api_key=mcp_live_querykey');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.keyId).toBe('key-789');
    });

    it('should return 401 for invalid API key', async () => {
      mockValidateApiKey.mockReturnValue(null);

      const res = await app.request('/protected/resource', {
        headers: {
          Authorization: 'Bearer invalid_key',
        },
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid or revoked API key');
    });

    it('should prioritize Authorization header over x-api-key', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'auth-header-key',
        name: 'Auth Header',
        key: 'bearer_key',
        enabled: true,
      });

      const res = await app.request('/protected/resource', {
        headers: {
          Authorization: 'Bearer bearer_key',
          'x-api-key': 'xapi_key',
        },
      });

      expect(res.status).toBe(200);
      expect(mockValidateApiKey).toHaveBeenCalledWith('bearer_key');
    });

    it('should handle case-insensitive Bearer prefix', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'key-case',
        name: 'Case Test',
        key: 'test_token',
        enabled: true,
      });

      const res = await app.request('/protected/resource', {
        headers: {
          Authorization: 'bearer test_token',
        },
      });

      expect(res.status).toBe(200);
      expect(mockValidateApiKey).toHaveBeenCalledWith('test_token');
    });

    it('should reject malformed Authorization header', async () => {
      const res = await app.request('/protected/resource', {
        headers: {
          Authorization: 'Basic dXNlcjpwYXNz', // Basic auth instead of Bearer
        },
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Authentication required');
    });
  });

  describe('optionalAuthMiddleware', () => {
    beforeEach(() => {
      app = new Hono();
      app.use('/optional/*', optionalAuthMiddleware);
      app.get('/optional/resource', (c) => {
        const apiKey = c.get('apiKey');
        return c.json({
          authenticated: !!apiKey,
          keyId: apiKey?.id || null,
        });
      });
    });

    it('should allow unauthenticated requests', async () => {
      const res = await app.request('/optional/resource');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.authenticated).toBe(false);
      expect(json.keyId).toBeNull();
    });

    it('should attach key info when valid key provided', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'optional-key',
        name: 'Optional Key',
        key: 'mcp_live_optional',
        enabled: true,
      });

      const res = await app.request('/optional/resource', {
        headers: {
          Authorization: 'Bearer mcp_live_optional',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.authenticated).toBe(true);
      expect(json.keyId).toBe('optional-key');
    });

    it('should allow request with invalid key (treats as unauthenticated)', async () => {
      mockValidateApiKey.mockReturnValue(null);

      const res = await app.request('/optional/resource', {
        headers: {
          Authorization: 'Bearer invalid_key',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.authenticated).toBe(false);
      expect(json.keyId).toBeNull();
    });
  });

  describe('masterKeyMiddleware', () => {
    beforeEach(() => {
      app = new Hono();
      app.use('/admin/*', masterKeyMiddleware);
      app.get('/admin/action', (c) => {
        return c.json({ message: 'admin action performed' });
      });
    });

    it('should return 500 when MASTER_API_KEY not configured', async () => {
      const res = await app.request('/admin/action', {
        headers: {
          Authorization: 'Bearer some_key',
        },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Master API key not configured on server');
    });

    it('should return 401 when no key provided', async () => {
      process.env.MASTER_API_KEY = 'master_secret_key';

      const res = await app.request('/admin/action');

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid master API key');
    });

    it('should return 401 for incorrect master key', async () => {
      process.env.MASTER_API_KEY = 'master_secret_key';

      const res = await app.request('/admin/action', {
        headers: {
          Authorization: 'Bearer wrong_master_key',
        },
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid master API key');
    });

    it('should allow access with correct master key via Bearer', async () => {
      process.env.MASTER_API_KEY = 'master_secret_key';

      const res = await app.request('/admin/action', {
        headers: {
          Authorization: 'Bearer master_secret_key',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe('admin action performed');
    });

    it('should allow access with correct master key via x-api-key', async () => {
      process.env.MASTER_API_KEY = 'master_secret_key';

      const res = await app.request('/admin/action', {
        headers: {
          'x-api-key': 'master_secret_key',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe('admin action performed');
    });

    it('should allow access with correct master key via query parameter', async () => {
      process.env.MASTER_API_KEY = 'master_secret_key';

      const res = await app.request('/admin/action?api_key=master_secret_key');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe('admin action performed');
    });
  });

  describe('API Key Extraction', () => {
    beforeEach(() => {
      app = new Hono();
      app.use('/test/*', authMiddleware);
      app.get('/test/endpoint', (c) => c.json({ ok: true }));
    });

    it('should extract key from Authorization header with extra whitespace', async () => {
      mockValidateApiKey.mockReturnValue({
        id: 'ws-key',
        name: 'Whitespace Key',
        key: 'token_with_spaces',
        enabled: true,
      });

      const res = await app.request('/test/endpoint', {
        headers: {
          Authorization: 'Bearer   token_with_spaces',
        },
      });

      // Regex uses \s+ which consumes multiple spaces, but captures the token without them
      expect(res.status).toBe(200);
      expect(mockValidateApiKey).toHaveBeenCalledWith('token_with_spaces');
    });

    it('should handle empty Authorization header', async () => {
      const res = await app.request('/test/endpoint', {
        headers: {
          Authorization: '',
        },
      });

      expect(res.status).toBe(401);
    });

    it('should handle Authorization header with only Bearer prefix', async () => {
      const res = await app.request('/test/endpoint', {
        headers: {
          Authorization: 'Bearer ',
        },
      });

      expect(res.status).toBe(401);
    });
  });
});
