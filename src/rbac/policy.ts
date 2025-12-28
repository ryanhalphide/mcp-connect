/**
 * RBAC Policy Definitions
 * Defines all permissions and built-in roles for the system
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'rbac-policy' });

/**
 * Permission definition
 */
export interface Permission {
  name: string;
  resource: string;
  action: string;
  description: string;
}

/**
 * Role definition
 */
export interface Role {
  name: string;
  description: string;
  permissions: string[]; // Permission names
}

/**
 * All system permissions
 */
export const PERMISSIONS: Permission[] = [
  // Server management
  { name: 'servers:read', resource: 'servers', action: 'read', description: 'View servers' },
  { name: 'servers:write', resource: 'servers', action: 'write', description: 'Create/update servers' },
  { name: 'servers:delete', resource: 'servers', action: 'delete', description: 'Delete servers' },
  { name: 'servers:connect', resource: 'servers', action: 'connect', description: 'Connect/disconnect servers' },

  // Tool invocation
  { name: 'tools:read', resource: 'tools', action: 'read', description: 'List tools' },
  { name: 'tools:execute', resource: 'tools', action: 'execute', description: 'Execute tools' },

  // Resource access
  { name: 'resources:read', resource: 'resources', action: 'read', description: 'List and read resources' },

  // Prompt access
  { name: 'prompts:read', resource: 'prompts', action: 'read', description: 'List and get prompts' },

  // Workflow management
  { name: 'workflows:read', resource: 'workflows', action: 'read', description: 'View workflows' },
  { name: 'workflows:write', resource: 'workflows', action: 'write', description: 'Create/update workflows' },
  { name: 'workflows:delete', resource: 'workflows', action: 'delete', description: 'Delete workflows' },
  { name: 'workflows:execute', resource: 'workflows', action: 'execute', description: 'Execute workflows' },

  // Webhook management
  { name: 'webhooks:read', resource: 'webhooks', action: 'read', description: 'View webhooks' },
  { name: 'webhooks:write', resource: 'webhooks', action: 'write', description: 'Create/update webhooks' },
  { name: 'webhooks:delete', resource: 'webhooks', action: 'delete', description: 'Delete webhooks' },

  // API key management
  { name: 'keys:read', resource: 'keys', action: 'read', description: 'View API keys' },
  { name: 'keys:write', resource: 'keys', action: 'write', description: 'Create/update API keys' },
  { name: 'keys:delete', resource: 'keys', action: 'delete', description: 'Delete API keys' },

  // Audit log access
  { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },

  // Usage metrics
  { name: 'usage:read', resource: 'usage', action: 'read', description: 'View usage metrics' },

  // RBAC management
  { name: 'rbac:read', resource: 'rbac', action: 'read', description: 'View roles and permissions' },
  { name: 'rbac:write', resource: 'rbac', action: 'write', description: 'Manage roles and permissions' },

  // Tenant management
  { name: 'tenants:read', resource: 'tenants', action: 'read', description: 'View tenants' },
  { name: 'tenants:write', resource: 'tenants', action: 'write', description: 'Manage tenants' },

  // Template management
  { name: 'templates:read', resource: 'templates', action: 'read', description: 'View templates' },
  { name: 'templates:write', resource: 'templates', action: 'write', description: 'Manage templates' },

  // Search
  { name: 'search:use', resource: 'search', action: 'use', description: 'Use semantic search' },

  // Cache management
  { name: 'cache:read', resource: 'cache', action: 'read', description: 'View cache stats' },
  { name: 'cache:write', resource: 'cache', action: 'write', description: 'Manage cache' },
];

/**
 * Built-in system roles
 */
export const BUILT_IN_ROLES: Role[] = [
  {
    name: 'admin',
    description: 'Full system access',
    permissions: PERMISSIONS.map((p) => p.name), // All permissions
  },
  {
    name: 'developer',
    description: 'Read and execute access',
    permissions: [
      'servers:read',
      'tools:read',
      'tools:execute',
      'resources:read',
      'prompts:read',
      'workflows:read',
      'workflows:execute',
      'search:use',
      'templates:read',
      'usage:read',
    ],
  },
  {
    name: 'operator',
    description: 'Execute workflows and tools',
    permissions: [
      'tools:read',
      'tools:execute',
      'resources:read',
      'prompts:read',
      'workflows:read',
      'workflows:execute',
      'templates:read',
    ],
  },
  {
    name: 'viewer',
    description: 'Read-only access',
    permissions: [
      'servers:read',
      'tools:read',
      'resources:read',
      'prompts:read',
      'workflows:read',
      'templates:read',
      'usage:read',
    ],
  },
];

/**
 * Initialize RBAC system with permissions and built-in roles
 */
export function initializeRBAC(db: Database.Database, tenantId?: string): void {
  logger.info('Initializing RBAC system');

  // Insert all permissions
  const permStmt = db.prepare(`
    INSERT OR IGNORE INTO rbac_permissions (id, name, resource, action, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const perm of PERMISSIONS) {
    const id = randomBytes(16).toString('hex');
    permStmt.run(id, perm.name, perm.resource, perm.action, perm.description);
  }

  logger.info({ permissionCount: PERMISSIONS.length }, 'Permissions initialized');

  // Insert built-in roles
  for (const role of BUILT_IN_ROLES) {
    const roleId = randomBytes(16).toString('hex');

    // Check if role already exists for this tenant
    const existingRole = db
      .prepare(
        `SELECT id FROM rbac_roles WHERE name = ? AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))`
      )
      .get(role.name, tenantId || null, tenantId || null) as { id: string } | undefined;

    if (existingRole) {
      logger.debug({ roleName: role.name, tenantId }, 'Role already exists');
      continue;
    }

    // Insert role
    db.prepare(`INSERT INTO rbac_roles (id, name, description, tenant_id) VALUES (?, ?, ?, ?)`).run(
      roleId,
      role.name,
      role.description,
      tenantId || null
    );

    // Assign permissions to role
    const rolePermStmt = db.prepare(`
      INSERT INTO rbac_role_permissions (role_id, permission_id)
      SELECT ?, id FROM rbac_permissions WHERE name = ?
    `);

    for (const permName of role.permissions) {
      rolePermStmt.run(roleId, permName);
    }

    logger.info({ roleName: role.name, permissionCount: role.permissions.length, tenantId }, 'Role created');
  }

  logger.info('RBAC system initialized');
}

/**
 * Get permissions for an API key
 */
export function getApiKeyPermissions(db: Database.Database, apiKeyId: string): Set<string> {
  const stmt = db.prepare(`
    SELECT DISTINCT p.name
    FROM rbac_permissions p
    JOIN rbac_role_permissions rp ON p.id = rp.permission_id
    JOIN rbac_api_key_roles akr ON rp.role_id = akr.role_id
    WHERE akr.api_key_id = ?
  `);

  const rows = stmt.all(apiKeyId) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/**
 * Check if an API key has a specific permission
 */
export function hasPermission(db: Database.Database, apiKeyId: string, permission: string): boolean {
  const permissions = getApiKeyPermissions(db, apiKeyId);
  return permissions.has(permission);
}

/**
 * Assign a role to an API key
 */
export function assignRoleToApiKey(
  db: Database.Database,
  apiKeyId: string,
  roleName: string,
  tenantId?: string
): boolean {
  // Find role
  const role = db
    .prepare(
      `SELECT id FROM rbac_roles WHERE name = ? AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))`
    )
    .get(roleName, tenantId || null, tenantId || null) as { id: string } | undefined;

  if (!role) {
    logger.warn({ roleName, tenantId }, 'Role not found');
    return false;
  }

  // Assign role to API key
  try {
    db.prepare(`INSERT OR IGNORE INTO rbac_api_key_roles (api_key_id, role_id) VALUES (?, ?)`).run(
      apiKeyId,
      role.id
    );
    logger.info({ apiKeyId, roleName }, 'Role assigned to API key');
    return true;
  } catch (error) {
    logger.error({ apiKeyId, roleName, error }, 'Failed to assign role');
    return false;
  }
}

/**
 * Remove a role from an API key
 */
export function removeRoleFromApiKey(
  db: Database.Database,
  apiKeyId: string,
  roleName: string,
  tenantId?: string
): boolean {
  // Find role
  const role = db
    .prepare(
      `SELECT id FROM rbac_roles WHERE name = ? AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))`
    )
    .get(roleName, tenantId || null, tenantId || null) as { id: string } | undefined;

  if (!role) {
    return false;
  }

  // Remove role from API key
  const result = db
    .prepare(`DELETE FROM rbac_api_key_roles WHERE api_key_id = ? AND role_id = ?`)
    .run(apiKeyId, role.id);

  return result.changes > 0;
}
