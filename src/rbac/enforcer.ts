/**
 * RBAC Enforcer Middleware
 * Enforces permission checks on API endpoints
 */

import type { Context, Next } from 'hono';
import { serverDatabase } from '../storage/db.js';
import { hasPermission } from './policy.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'rbac-enforcer' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string) {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Request context with API key ID attached by auth middleware
 */
interface AuthContext {
  apiKeyId?: string;
  tenantId?: string;
}

/**
 * RBAC middleware factory
 * Creates middleware that checks if the authenticated API key has the required permission
 *
 * @param permission - Permission name to check (e.g., 'tools:execute', 'workflows:write')
 * @returns Hono middleware function
 *
 * @example
 * app.post('/api/tools/invoke', checkPermission('tools:execute'), async (c) => { ... });
 * app.delete('/api/workflows/:id', checkPermission('workflows:delete'), async (c) => { ... });
 */
export function checkPermission(permission: string) {
  return async (c: Context, next: Next) => {
    const db = serverDatabase.getDatabase();

    // Get API key ID from context (set by auth middleware)
    const apiKeyId = c.get('apiKeyId') as string | undefined;

    if (!apiKeyId) {
      logger.warn({ permission }, 'Permission check failed: No API key in context');
      return c.json(
        apiResponse({
          error: 'Authentication required',
          code: 'UNAUTHENTICATED',
        }),
        401
      );
    }

    // Check if API key has the required permission
    const allowed = hasPermission(db, apiKeyId, permission);

    if (!allowed) {
      logger.warn({ apiKeyId, permission }, 'Permission denied');
      return c.json(
        apiResponse({
          error: 'Insufficient permissions',
          code: 'PERMISSION_DENIED',
          details: {
            required: permission,
            message: `This operation requires the '${permission}' permission`,
          },
        }),
        403
      );
    }

    logger.debug({ apiKeyId, permission }, 'Permission check passed');

    // Permission check passed, continue to handler
    await next();
  };
}

/**
 * Check if API key has ANY of the specified permissions (OR logic)
 *
 * @param permissions - Array of permission names
 * @returns Hono middleware function
 *
 * @example
 * app.get('/api/data', checkAnyPermission(['admin:read', 'viewer:read']), async (c) => { ... });
 */
export function checkAnyPermission(permissions: string[]) {
  return async (c: Context, next: Next) => {
    const db = serverDatabase.getDatabase();
    const apiKeyId = c.get('apiKeyId') as string | undefined;

    if (!apiKeyId) {
      logger.warn({ permissions }, 'Permission check failed: No API key in context');
      return c.json(
        apiResponse({
          error: 'Authentication required',
          code: 'UNAUTHENTICATED',
        }),
        401
      );
    }

    // Check if API key has ANY of the required permissions
    const allowed = permissions.some((perm) => hasPermission(db, apiKeyId, perm));

    if (!allowed) {
      logger.warn({ apiKeyId, permissions }, 'Permission denied (requires any)');
      return c.json(
        apiResponse({
          error: 'Insufficient permissions',
          code: 'PERMISSION_DENIED',
          details: {
            required: permissions,
            message: `This operation requires one of: ${permissions.join(', ')}`,
          },
        }),
        403
      );
    }

    logger.debug({ apiKeyId, permissions }, 'Permission check passed (any)');
    await next();
  };
}

/**
 * Check if API key has ALL of the specified permissions (AND logic)
 *
 * @param permissions - Array of permission names
 * @returns Hono middleware function
 *
 * @example
 * app.post('/api/admin/migrate', checkAllPermissions(['admin:write', 'db:migrate']), async (c) => { ... });
 */
export function checkAllPermissions(permissions: string[]) {
  return async (c: Context, next: Next) => {
    const db = serverDatabase.getDatabase();
    const apiKeyId = c.get('apiKeyId') as string | undefined;

    if (!apiKeyId) {
      logger.warn({ permissions }, 'Permission check failed: No API key in context');
      return c.json(
        apiResponse({
          error: 'Authentication required',
          code: 'UNAUTHENTICATED',
        }),
        401
      );
    }

    // Check if API key has ALL of the required permissions
    const allowed = permissions.every((perm) => hasPermission(db, apiKeyId, perm));

    if (!allowed) {
      logger.warn({ apiKeyId, permissions }, 'Permission denied (requires all)');
      return c.json(
        apiResponse({
          error: 'Insufficient permissions',
          code: 'PERMISSION_DENIED',
          details: {
            required: permissions,
            message: `This operation requires all of: ${permissions.join(', ')}`,
          },
        }),
        403
      );
    }

    logger.debug({ apiKeyId, permissions }, 'Permission check passed (all)');
    await next();
  };
}

/**
 * Tenant isolation middleware
 * Ensures API key can only access resources from its own tenant
 *
 * @returns Hono middleware function
 */
export function enforceTenantIsolation() {
  return async (c: Context, next: Next) => {
    const tenantId = c.get('tenantId') as string | undefined;

    if (!tenantId) {
      // No tenant isolation required (system-level API key)
      await next();
      return;
    }

    // Attach tenant filter to context for downstream handlers
    c.set('tenantFilter', { tenant_id: tenantId });

    logger.debug({ tenantId }, 'Tenant isolation enforced');
    await next();
  };
}
