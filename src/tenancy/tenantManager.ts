/**
 * Tenant Management
 * Multi-tenancy support for enterprise deployments
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'tenant-manager' });

export interface Tenant {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUsage {
  tenantId: string;
  tenantName: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  period: {
    start: string;
    end: string;
  };
}

export class TenantManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new tenant
   */
  createTenant(name: string, metadata: Record<string, unknown> = {}): Tenant {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO tenants (id, name, metadata_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);

    try {
      stmt.run(id, name, JSON.stringify(metadata), now, now);
      logger.info({ tenantId: id, name }, 'Tenant created');

      return {
        id,
        name,
        metadata,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      logger.error({ name, error }, 'Failed to create tenant');
      throw new Error(`Failed to create tenant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get tenant by ID
   */
  getTenant(id: string): Tenant | null {
    const stmt = this.db.prepare(`
      SELECT id, name, metadata_json, enabled, created_at, updated_at
      FROM tenants
      WHERE id = ?
    `);

    const row = stmt.get(id) as {
      id: string;
      name: string;
      metadata_json: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      metadata: JSON.parse(row.metadata_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get tenant by name
   */
  getTenantByName(name: string): Tenant | null {
    const stmt = this.db.prepare(`
      SELECT id, name, metadata_json, enabled, created_at, updated_at
      FROM tenants
      WHERE name = ?
    `);

    const row = stmt.get(name) as {
      id: string;
      name: string;
      metadata_json: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      metadata: JSON.parse(row.metadata_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List all tenants
   */
  listTenants(options: { enabled?: boolean; limit?: number; offset?: number } = {}): {
    tenants: Tenant[];
    total: number;
  } {
    const { enabled, limit = 100, offset = 0 } = options;

    // Build query
    let whereClause = '';
    const params: unknown[] = [];

    if (enabled !== undefined) {
      whereClause = 'WHERE enabled = ?';
      params.push(enabled ? 1 : 0);
    }

    // Get total count
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM tenants ${whereClause}`);
    const countRow = countStmt.get(...params) as { count: number };
    const total = countRow.count;

    // Get paginated results
    const stmt = this.db.prepare(`
      SELECT id, name, metadata_json, enabled, created_at, updated_at
      FROM tenants
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...params, limit, offset) as {
      id: string;
      name: string;
      metadata_json: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    }[];

    const tenants = rows.map((row) => ({
      id: row.id,
      name: row.name,
      metadata: JSON.parse(row.metadata_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return { tenants, total };
  }

  /**
   * Update tenant
   */
  updateTenant(id: string, updates: { name?: string; metadata?: Record<string, unknown>; enabled?: boolean }): boolean {
    const current = this.getTenant(id);
    if (!current) {
      return false;
    }

    const name = updates.name ?? current.name;
    const metadata = updates.metadata ?? current.metadata;
    const enabled = updates.enabled ?? current.enabled;
    const updatedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE tenants
      SET name = ?, metadata_json = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(name, JSON.stringify(metadata), enabled ? 1 : 0, updatedAt, id);

    if (result.changes > 0) {
      logger.info({ tenantId: id, updates }, 'Tenant updated');
      return true;
    }

    return false;
  }

  /**
   * Delete tenant (and all associated data)
   */
  deleteTenant(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM tenants WHERE id = ?`);
    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ tenantId: id }, 'Tenant deleted');
      return true;
    }

    return false;
  }

  /**
   * Get tenant usage statistics
   */
  getTenantUsage(
    tenantId: string,
    options: { startDate?: string; endDate?: string } = {}
  ): TenantUsage | null {
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      return null;
    }

    const { startDate, endDate } = options;
    const params: unknown[] = [tenantId];
    let dateFilter = '';

    if (startDate) {
      dateFilter += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      dateFilter += ' AND timestamp <= ?';
      params.push(endDate);
    }

    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(tokens_used) as total_tokens,
        SUM(cost_credits) as total_cost
      FROM usage_metrics
      WHERE tenant_id = ? ${dateFilter}
    `);

    const row = stmt.get(...params) as {
      total_requests: number;
      total_tokens: number;
      total_cost: number;
    } | undefined;

    if (!row) {
      return {
        tenantId,
        tenantName: tenant.name,
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0,
        period: {
          start: startDate || 'beginning',
          end: endDate || 'now',
        },
      };
    }

    return {
      tenantId,
      tenantName: tenant.name,
      totalRequests: row.total_requests || 0,
      totalTokens: row.total_tokens || 0,
      totalCost: row.total_cost || 0,
      period: {
        start: startDate || 'beginning',
        end: endDate || 'now',
      },
    };
  }

  /**
   * Get API keys for a tenant
   */
  getTenantApiKeys(tenantId: string): Array<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    enabled: boolean;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, name, created_at, last_used_at, enabled
      FROM api_keys
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(tenantId) as {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
      enabled: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      enabled: row.enabled === 1,
    }));
  }

  /**
   * Assign API key to tenant
   */
  assignApiKeyToTenant(apiKeyId: string, tenantId: string): boolean {
    // Verify tenant exists
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      logger.warn({ apiKeyId, tenantId }, 'Cannot assign: tenant not found');
      return false;
    }

    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET tenant_id = ?
      WHERE id = ?
    `);

    const result = stmt.run(tenantId, apiKeyId);

    if (result.changes > 0) {
      logger.info({ apiKeyId, tenantId }, 'API key assigned to tenant');
      return true;
    }

    return false;
  }

  /**
   * Remove API key from tenant
   */
  removeApiKeyFromTenant(apiKeyId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET tenant_id = NULL
      WHERE id = ?
    `);

    const result = stmt.run(apiKeyId);

    if (result.changes > 0) {
      logger.info({ apiKeyId }, 'API key removed from tenant');
      return true;
    }

    return false;
  }
}
