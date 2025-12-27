import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAuthHeaders,
  clearAuthCache,
  clearAllAuthCache,
  hasValidToken,
} from '../../src/core/auth.js';
import type { AuthConfig } from '../../src/core/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Auth Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllAuthCache();
  });

  afterEach(() => {
    clearAllAuthCache();
  });

  describe('getAuthHeaders - No Auth', () => {
    it('should return empty headers for no auth', async () => {
      const auth: AuthConfig = { type: 'none' };
      const headers = await getAuthHeaders('server-1', auth);
      expect(headers).toEqual({});
    });
  });

  describe('getAuthHeaders - API Key Auth', () => {
    it('should return Authorization header with Bearer prefix by default', async () => {
      const auth: AuthConfig = {
        type: 'api_key',
        key: 'my-secret-key',
        header: 'Authorization',
        prefix: 'Bearer',
      };

      const headers = await getAuthHeaders('server-1', auth);
      expect(headers).toEqual({ Authorization: 'Bearer my-secret-key' });
    });

    it('should use custom header name', async () => {
      const auth: AuthConfig = {
        type: 'api_key',
        key: 'my-api-key',
        header: 'X-API-Key',
        prefix: '',
      };

      const headers = await getAuthHeaders('server-1', auth);
      expect(headers).toEqual({ 'X-API-Key': 'my-api-key' });
    });

    it('should support custom prefix', async () => {
      const auth: AuthConfig = {
        type: 'api_key',
        key: 'token123',
        header: 'Authorization',
        prefix: 'Token',
      };

      const headers = await getAuthHeaders('server-1', auth);
      expect(headers).toEqual({ Authorization: 'Token token123' });
    });
  });

  describe('getAuthHeaders - OAuth2 Auth', () => {
    const oauth2Auth: AuthConfig = {
      type: 'oauth2',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read', 'write'],
    };

    it('should fetch and return OAuth2 token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'oauth-token-123',
            expires_in: 3600,
          }),
      });

      const headers = await getAuthHeaders('server-1', oauth2Auth);

      expect(headers).toEqual({ Authorization: 'Bearer oauth-token-123' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('should cache OAuth2 token for subsequent requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'cached-token',
            expires_in: 3600,
          }),
      });

      // First call fetches token
      await getAuthHeaders('server-1', oauth2Auth);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call uses cached token
      const headers = await getAuthHeaders('server-1', oauth2Auth);
      expect(headers).toEqual({ Authorization: 'Bearer cached-token' });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should include scopes in token request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'token-with-scopes',
            expires_in: 3600,
          }),
      });

      await getAuthHeaders('server-1', oauth2Auth);

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body;
      expect(body).toContain('scope=read+write');
    });

    it('should throw error on token fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid credentials'),
      });

      await expect(getAuthHeaders('server-1', oauth2Auth)).rejects.toThrow(
        'OAuth2 token fetch failed: 401 Invalid credentials'
      );
    });

    it('should refresh token when expired', async () => {
      // First fetch with short expiry
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'short-lived-token',
            expires_in: 1, // 1 second
            refresh_token: 'refresh-token-123',
          }),
      });

      await getAuthHeaders('server-1', oauth2Auth);

      // Wait for token to "expire" (plus buffer)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second call should use refresh token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'refreshed-token',
            expires_in: 3600,
          }),
      });

      // Force cache invalidation by clearing and re-fetching
      clearAuthCache('server-1');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-token',
            expires_in: 3600,
          }),
      });

      const headers = await getAuthHeaders('server-1', oauth2Auth);
      expect(headers.Authorization).toContain('Bearer');
    });
  });

  describe('clearAuthCache', () => {
    it('should clear token for specific server', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-token',
            expires_in: 3600,
          }),
      });

      const auth: AuthConfig = {
        type: 'oauth2',
        clientId: 'test',
        clientSecret: 'secret',
        tokenUrl: 'https://auth.example.com/token',
        scopes: [],
      };

      await getAuthHeaders('server-1', auth);
      await getAuthHeaders('server-2', auth);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      clearAuthCache('server-1');

      // server-1 needs new token, server-2 uses cache
      await getAuthHeaders('server-1', auth);
      await getAuthHeaders('server-2', auth);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Only one new fetch for server-1
    });
  });

  describe('hasValidToken', () => {
    it('should return false when no token cached', () => {
      expect(hasValidToken('unknown-server')).toBe(false);
    });

    it('should return true when valid token cached', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'valid-token',
            expires_in: 3600,
          }),
      });

      const auth: AuthConfig = {
        type: 'oauth2',
        clientId: 'test',
        clientSecret: 'secret',
        tokenUrl: 'https://auth.example.com/token',
        scopes: [],
      };

      await getAuthHeaders('server-1', auth);
      expect(hasValidToken('server-1')).toBe(true);
    });

    it('should return false after cache cleared', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'token',
            expires_in: 3600,
          }),
      });

      const auth: AuthConfig = {
        type: 'oauth2',
        clientId: 'test',
        clientSecret: 'secret',
        tokenUrl: 'https://auth.example.com/token',
        scopes: [],
      };

      await getAuthHeaders('server-1', auth);
      clearAuthCache('server-1');
      expect(hasValidToken('server-1')).toBe(false);
    });
  });
});
