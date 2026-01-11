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

  // Workflow template management
  { name: 'workflow_templates:read', resource: 'workflow_templates', action: 'read', description: 'View workflow templates' },
  { name: 'workflow_templates:write', resource: 'workflow_templates', action: 'write', description: 'Create/update workflow templates' },
  { name: 'workflow_templates:delete', resource: 'workflow_templates', action: 'delete', description: 'Delete workflow templates' },
  { name: 'workflow_templates:execute', resource: 'workflow_templates', action: 'execute', description: 'Instantiate workflow templates' },

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

  // Analytics dashboard
  { name: 'analytics:read', resource: 'analytics', action: 'read', description: 'View analytics and cost reports' },

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

  // LLM Sampling (Track 1)
  { name: 'sampling:execute', resource: 'sampling', action: 'execute', description: 'Execute LLM sampling requests' },
  { name: 'sampling:configure', resource: 'sampling', action: 'admin', description: 'Configure LLM providers' },
  { name: 'sampling:usage', resource: 'sampling', action: 'read', description: 'View sampling usage statistics' },

  // Budget Management (Track 4A)
  { name: 'budgets:read', resource: 'budgets', action: 'read', description: 'View cost budgets and alerts' },
  { name: 'budgets:write', resource: 'budgets', action: 'write', description: 'Create/update cost budgets' },
  { name: 'budgets:delete', resource: 'budgets', action: 'delete', description: 'Delete cost budgets' },
  { name: 'budgets:admin', resource: 'budgets', action: 'admin', description: 'Manage budget policies and violations' },

  // KeyGuardian Security (Track 4B)
  { name: 'security:read', resource: 'security', action: 'read', description: 'View key exposure detections' },
  { name: 'security:write', resource: 'security', action: 'write', description: 'Manage security patterns and resolve detections' },
  { name: 'security:admin', resource: 'security', action: 'admin', description: 'Configure KeyGuardian and security policies' },
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
      'workflow_templates:read',
      'workflow_templates:execute',
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
      'workflow_templates:read',
      'workflow_templates:execute',
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
      'workflow_templates:read',
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
 * Checks both role-based permissions AND API key scopes (from metadata)
 */
export function hasPermission(db: Database.Database, apiKeyId: string, permission: string): boolean {
  // First check role-based permissions
  const rolePermissions = getApiKeyPermissions(db, apiKeyId);
  if (rolePermissions.has(permission)) {
    return true;
  }

  // Also check API key scopes in metadata (direct scope-based permissions)
  const apiKeyRow = db
    .prepare(`SELECT metadata FROM api_keys WHERE id = ? AND enabled = 1`)
    .get(apiKeyId) as { metadata: string } | undefined;

  if (apiKeyRow) {
    try {
      const metadata = JSON.parse(apiKeyRow.metadata);
      const scopes = metadata.scopes || [];

      // Check if permission is in scopes (exact match or wildcard)
      if (scopes.includes(permission) || scopes.includes('*')) {
        return true;
      }
    } catch (error) {
      logger.warn({ apiKeyId, error }, 'Failed to parse API key metadata');
    }
  }

  return false;
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
