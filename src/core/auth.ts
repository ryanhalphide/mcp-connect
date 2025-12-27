import type { AuthConfig, ApiKeyAuth, OAuth2Auth } from './types.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'auth' });

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

// In-memory token cache per server
const tokenCache = new Map<string, TokenCache>();

/**
 * Get authorization headers for a server based on its auth config
 */
export async function getAuthHeaders(
  serverId: string,
  auth: AuthConfig
): Promise<Record<string, string>> {
  switch (auth.type) {
    case 'none':
      return {};

    case 'api_key':
      return getApiKeyHeaders(auth);

    case 'oauth2':
      return await getOAuth2Headers(serverId, auth);

    default:
      logger.warn({ authType: (auth as { type: string }).type }, 'Unknown auth type');
      return {};
  }
}

/**
 * Build headers for API key authentication
 */
function getApiKeyHeaders(auth: ApiKeyAuth): Record<string, string> {
  const headerValue = auth.prefix ? `${auth.prefix} ${auth.key}` : auth.key;
  return { [auth.header]: headerValue };
}

/**
 * Get OAuth2 token and build headers
 */
async function getOAuth2Headers(
  serverId: string,
  auth: OAuth2Auth
): Promise<Record<string, string>> {
  const token = await getOrRefreshToken(serverId, auth);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Get cached token or fetch a new one
 */
async function getOrRefreshToken(serverId: string, auth: OAuth2Auth): Promise<string> {
  const cached = tokenCache.get(serverId);
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (cached && cached.expiresAt > now + 60000) {
    logger.debug({ serverId }, 'Using cached OAuth2 token');
    return cached.accessToken;
  }

  // Need to fetch or refresh token
  if (cached?.refreshToken) {
    logger.info({ serverId }, 'Refreshing OAuth2 token');
    return await refreshToken(serverId, auth, cached.refreshToken);
  }

  logger.info({ serverId }, 'Fetching new OAuth2 token');
  return await fetchNewToken(serverId, auth);
}

/**
 * Fetch a new OAuth2 token using client credentials
 */
async function fetchNewToken(serverId: string, auth: OAuth2Auth): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
  });

  if (auth.scopes.length > 0) {
    body.set('scope', auth.scopes.join(' '));
  }

  const response = await fetch(auth.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      { serverId, status: response.status, error: errorText },
      'Failed to fetch OAuth2 token'
    );
    throw new Error(`OAuth2 token fetch failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };

  const expiresIn = data.expires_in || 3600; // Default 1 hour
  const expiresAt = Date.now() + expiresIn * 1000;

  tokenCache.set(serverId, {
    accessToken: data.access_token,
    expiresAt,
    refreshToken: data.refresh_token,
  });

  logger.info({ serverId, expiresIn }, 'OAuth2 token acquired');
  return data.access_token;
}

/**
 * Refresh an existing OAuth2 token
 */
async function refreshToken(
  serverId: string,
  auth: OAuth2Auth,
  refreshToken: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    refresh_token: refreshToken,
  });

  try {
    const response = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      // If refresh fails, try getting a new token
      logger.warn({ serverId, status: response.status }, 'Token refresh failed, fetching new token');
      tokenCache.delete(serverId);
      return await fetchNewToken(serverId, auth);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    };

    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    tokenCache.set(serverId, {
      accessToken: data.access_token,
      expiresAt,
      refreshToken: data.refresh_token || refreshToken,
    });

    logger.info({ serverId, expiresIn }, 'OAuth2 token refreshed');
    return data.access_token;
  } catch (error) {
    logger.error({ serverId, error }, 'Token refresh error, fetching new token');
    tokenCache.delete(serverId);
    return await fetchNewToken(serverId, auth);
  }
}

/**
 * Clear cached token for a server (e.g., on disconnect)
 */
export function clearAuthCache(serverId: string): void {
  tokenCache.delete(serverId);
  logger.debug({ serverId }, 'Cleared auth cache');
}

/**
 * Clear all cached tokens
 */
export function clearAllAuthCache(): void {
  tokenCache.clear();
  logger.debug('Cleared all auth cache');
}

/**
 * Check if a server has valid cached credentials
 */
export function hasValidToken(serverId: string): boolean {
  const cached = tokenCache.get(serverId);
  if (!cached) return false;
  return cached.expiresAt > Date.now() + 60000;
}
