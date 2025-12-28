/**
 * RBAC Management API
 * REST endpoints for managing roles and permissions
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { serverDatabase } from '../storage/db.js';
import {
  PERMISSIONS,
  BUILT_IN_ROLES,
  getApiKeyPermissions,
  assignRoleToApiKey,
  removeRoleFromApiKey,
} from '../rbac/policy.js';
import { checkPermission } from '../rbac/enforcer.js';
import { createChildLogger } from '../observability/logger.js';
import { randomBytes } from 'crypto';

const logger = createChildLogger({ module: 'rbac-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string) {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

export const rbacApi = new Hono();
const db = serverDatabase.getDatabase();

/**
 * List all permissions
 * GET /api/rbac/permissions
 */
rbacApi.get('/permissions', checkPermission('rbac:read'), (c) => {
  logger.info('Listed all permissions');

  return c.json(
    apiResponse({
      permissions: PERMISSIONS,
      count: PERMISSIONS.length,
    })
  );
});

/**
 * List all roles
 * GET /api/rbac/roles
 */
rbacApi.get('/roles', checkPermission('rbac:read'), (c) => {
  const tenantId = c.req.query('tenantId');

  const stmt = db.prepare(`
    SELECT id, name, description, tenant_id, created_at
    FROM rbac_roles
    WHERE tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL)
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(tenantId || null, tenantId || null) as Array<{
    id: string;
    name: string;
    description: string;
    tenant_id: string | null;
    created_at: string;
  }>;

  // Get permissions for each role
  const roles = rows.map((row) => {
    const permStmt = db.prepare(`
      SELECT p.name
      FROM rbac_permissions p
      JOIN rbac_role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `);

    const permissions = permStmt.all(row.id) as Array<{ name: string }>;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tenantId: row.tenant_id,
      permissions: permissions.map((p) => p.name),
      createdAt: row.created_at,
    };
  });

  logger.info({ count: roles.length, tenantId }, 'Listed roles');

  return c.json(
    apiResponse({
      roles,
      count: roles.length,
    })
  );
});

/**
 * Get role by ID
 * GET /api/rbac/roles/:id
 */
rbacApi.get('/roles/:id', checkPermission('rbac:read'), (c) => {
  const { id } = c.req.param();

  const stmt = db.prepare(`
    SELECT id, name, description, tenant_id, created_at
    FROM rbac_roles
    WHERE id = ?
  `);

  const row = stmt.get(id) as
    | {
        id: string;
        name: string;
        description: string;
        tenant_id: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) {
    return c.json(
      apiResponse({
        error: 'Role not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  // Get permissions for this role
  const permStmt = db.prepare(`
    SELECT p.name, p.resource, p.action, p.description
    FROM rbac_permissions p
    JOIN rbac_role_permissions rp ON p.id = rp.permission_id
    WHERE rp.role_id = ?
  `);

  const permissions = permStmt.all(id) as Array<{
    name: string;
    resource: string;
    action: string;
    description: string;
  }>;

  return c.json(
    apiResponse({
      id: row.id,
      name: row.name,
      description: row.description,
      tenantId: row.tenant_id,
      permissions,
      createdAt: row.created_at,
    })
  );
});

/**
 * Create a custom role
 * POST /api/rbac/roles
 */
rbacApi.post('/roles', checkPermission('rbac:write'), async (c) => {
  const bodySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(''),
    permissions: z.array(z.string()),
    tenantId: z.string().optional(),
  });

  let validated;
  try {
    const body = await c.req.json();
    validated = bodySchema.parse(body);
  } catch (error) {
    return c.json(
      apiResponse({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error instanceof z.ZodError ? error.errors : undefined,
      }),
      400
    );
  }

  // Validate permissions
  const validPermissions = PERMISSIONS.map((p) => p.name);
  const invalidPermissions = validated.permissions.filter((p) => !validPermissions.includes(p));

  if (invalidPermissions.length > 0) {
    return c.json(
      apiResponse({
        error: 'Invalid permissions',
        code: 'VALIDATION_ERROR',
        details: { invalidPermissions },
      }),
      400
    );
  }

  // Create role
  const roleId = randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO rbac_roles (id, name, description, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(roleId, validated.name, validated.description, validated.tenantId || null, now);

    // Assign permissions
    const assignStmt = db.prepare(`
      INSERT INTO rbac_role_permissions (role_id, permission_id)
      SELECT ?, id FROM rbac_permissions WHERE name = ?
    `);

    for (const permName of validated.permissions) {
      assignStmt.run(roleId, permName);
    }

    logger.info({ roleId, name: validated.name, permissionCount: validated.permissions.length }, 'Created custom role');

    return c.json(
      apiResponse({
        id: roleId,
        name: validated.name,
        description: validated.description,
        tenantId: validated.tenantId || null,
        permissions: validated.permissions,
        createdAt: now,
      }),
      201
    );
  } catch (error) {
    logger.error({ name: validated.name, error }, 'Failed to create role');
    return c.json(
      apiResponse({
        error: 'Failed to create role',
        code: 'CREATION_FAILED',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      500
    );
  }
});

/**
 * Update role permissions
 * PUT /api/rbac/roles/:id/permissions
 */
rbacApi.put('/roles/:id/permissions', checkPermission('rbac:write'), async (c) => {
  const { id } = c.req.param();

  const bodySchema = z.object({
    permissions: z.array(z.string()),
  });

  let validated;
  try {
    const body = await c.req.json();
    validated = bodySchema.parse(body);
  } catch (error) {
    return c.json(
      apiResponse({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error instanceof z.ZodError ? error.errors : undefined,
      }),
      400
    );
  }

  // Check if role exists
  const roleCheck = db.prepare(`SELECT id FROM rbac_roles WHERE id = ?`).get(id);
  if (!roleCheck) {
    return c.json(
      apiResponse({
        error: 'Role not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  // Validate permissions
  const validPermissions = PERMISSIONS.map((p) => p.name);
  const invalidPermissions = validated.permissions.filter((p) => !validPermissions.includes(p));

  if (invalidPermissions.length > 0) {
    return c.json(
      apiResponse({
        error: 'Invalid permissions',
        code: 'VALIDATION_ERROR',
        details: { invalidPermissions },
      }),
      400
    );
  }

  try {
    // Remove existing permissions
    db.prepare(`DELETE FROM rbac_role_permissions WHERE role_id = ?`).run(id);

    // Assign new permissions
    const assignStmt = db.prepare(`
      INSERT INTO rbac_role_permissions (role_id, permission_id)
      SELECT ?, id FROM rbac_permissions WHERE name = ?
    `);

    for (const permName of validated.permissions) {
      assignStmt.run(id, permName);
    }

    logger.info({ roleId: id, permissionCount: validated.permissions.length }, 'Updated role permissions');

    return c.json(
      apiResponse({
        message: 'Role permissions updated successfully',
        permissions: validated.permissions,
      })
    );
  } catch (error) {
    logger.error({ roleId: id, error }, 'Failed to update role permissions');
    return c.json(
      apiResponse({
        error: 'Failed to update role permissions',
        code: 'UPDATE_FAILED',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      500
    );
  }
});

/**
 * Delete a role
 * DELETE /api/rbac/roles/:id
 */
rbacApi.delete('/roles/:id', checkPermission('rbac:write'), (c) => {
  const { id } = c.req.param();

  const result = db.prepare(`DELETE FROM rbac_roles WHERE id = ?`).run(id);

  if (result.changes === 0) {
    return c.json(
      apiResponse({
        error: 'Role not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  logger.info({ roleId: id }, 'Deleted role');

  return c.json(apiResponse({ message: 'Role deleted successfully' }));
});

/**
 * Assign role to API key
 * POST /api/rbac/keys/:keyId/roles
 */
rbacApi.post('/keys/:keyId/roles', checkPermission('rbac:write'), async (c) => {
  const { keyId } = c.req.param();

  const bodySchema = z.object({
    roleName: z.string(),
    tenantId: z.string().optional(),
  });

  let validated;
  try {
    const body = await c.req.json();
    validated = bodySchema.parse(body);
  } catch (error) {
    return c.json(
      apiResponse({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error instanceof z.ZodError ? error.errors : undefined,
      }),
      400
    );
  }

  const success = assignRoleToApiKey(db, keyId, validated.roleName, validated.tenantId);

  if (!success) {
    return c.json(
      apiResponse({
        error: 'Failed to assign role to API key',
        code: 'ASSIGNMENT_FAILED',
      }),
      400
    );
  }

  logger.info({ apiKeyId: keyId, roleName: validated.roleName }, 'Assigned role to API key');

  return c.json(apiResponse({ message: 'Role assigned successfully' }));
});

/**
 * Remove role from API key
 * DELETE /api/rbac/keys/:keyId/roles/:roleName
 */
rbacApi.delete('/keys/:keyId/roles/:roleName', checkPermission('rbac:write'), (c) => {
  const { keyId, roleName } = c.req.param();
  const tenantId = c.req.query('tenantId');

  const success = removeRoleFromApiKey(db, keyId, roleName, tenantId || undefined);

  if (!success) {
    return c.json(
      apiResponse({
        error: 'Failed to remove role from API key',
        code: 'REMOVAL_FAILED',
      }),
      404
    );
  }

  logger.info({ apiKeyId: keyId, roleName }, 'Removed role from API key');

  return c.json(apiResponse({ message: 'Role removed successfully' }));
});

/**
 * Get permissions for an API key
 * GET /api/rbac/keys/:keyId/permissions
 */
rbacApi.get('/keys/:keyId/permissions', checkPermission('rbac:read'), (c) => {
  const { keyId } = c.req.param();

  const permissions = getApiKeyPermissions(db, keyId);

  logger.info({ apiKeyId: keyId, permissionCount: permissions.size }, 'Retrieved API key permissions');

  return c.json(
    apiResponse({
      apiKeyId: keyId,
      permissions: Array.from(permissions),
      count: permissions.size,
    })
  );
});
