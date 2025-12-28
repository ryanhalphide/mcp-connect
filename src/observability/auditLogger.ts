/**
 * Audit Logging System
 * Tracks all important actions for compliance and security
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from './logger.js';

const logger = createChildLogger({ module: 'audit-logger' });

export type AuditAction =
  | 'tool:invoke'
  | 'resource:read'
  | 'prompt:get'
  | 'workflow:create'
  | 'workflow:update'
  | 'workflow:delete'
  | 'workflow:execute'
  | 'server:connect'
  | 'server:disconnect'
  | 'server:create'
  | 'server:update'
  | 'server:delete'
  | 'key:create'
  | 'key:revoke'
  | 'key:delete'
  | 'role:assign'
  | 'role:remove'
  | 'tenant:create'
  | 'tenant:update'
  | 'tenant:delete'
  | 'cache:invalidate'
  | 'search:query';

export type AuditResourceType =
  | 'tool'
  | 'resource'
  | 'prompt'
  | 'workflow'
  | 'server'
  | 'api_key'
  | 'role'
  | 'tenant'
  | 'cache'
  | 'search';

export type AuditStatus = 'success' | 'failure';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  apiKeyId: string | null;
  tenantId: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  serverId: string | null;
  status: AuditStatus;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  error: string | null;
}

export interface AuditLogOptions {
  apiKeyId?: string;
  tenantId?: string;
  resourceId?: string;
  serverId?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class AuditLogger {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Log an audit event
   */
  log(
    action: AuditAction,
    resourceType: AuditResourceType,
    status: AuditStatus,
    options: AuditLogOptions = {}
  ): void {
    const id = randomBytes(16).toString('hex');
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, api_key_id, tenant_id, action, resource_type, resource_id,
        server_id, status, duration_ms, metadata_json, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id,
        timestamp,
        options.apiKeyId || null,
        options.tenantId || null,
        action,
        resourceType,
        options.resourceId || null,
        options.serverId || null,
        status,
        null, // duration_ms will be set separately
        JSON.stringify(options.metadata || {}),
        options.error || null
      );

      logger.debug({ action, resourceType, status }, 'Audit log entry created');
    } catch (error) {
      logger.error({ action, resourceType, error }, 'Failed to write audit log');
    }
  }

  /**
   * Log with duration tracking
   * Returns a function to be called when the operation completes
   */
  logWithDuration(
    action: AuditAction,
    resourceType: AuditResourceType,
    options: AuditLogOptions = {}
  ): (status: AuditStatus, error?: string) => void {
    const id = randomBytes(16).toString('hex');
    const timestamp = new Date().toISOString();
    const startTime = Date.now();

    return (status: AuditStatus, error?: string) => {
      const durationMs = Date.now() - startTime;

      const stmt = this.db.prepare(`
        INSERT INTO audit_log (
          id, timestamp, api_key_id, tenant_id, action, resource_type, resource_id,
          server_id, status, duration_ms, metadata_json, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      try {
        stmt.run(
          id,
          timestamp,
          options.apiKeyId || null,
          options.tenantId || null,
          action,
          resourceType,
          options.resourceId || null,
          options.serverId || null,
          status,
          durationMs,
          JSON.stringify(options.metadata || {}),
          error || options.error || null
        );

        logger.debug({ action, resourceType, status, durationMs }, 'Audit log entry created');
      } catch (err) {
        logger.error({ action, resourceType, error: err }, 'Failed to write audit log');
      }
    };
  }

  /**
   * Query audit logs
   */
  query(filters: {
    startDate?: string;
    endDate?: string;
    apiKeyId?: string;
    tenantId?: string;
    action?: AuditAction;
    resourceType?: AuditResourceType;
    status?: AuditStatus;
    limit?: number;
    offset?: number;
  }): {
    logs: AuditLogEntry[];
    total: number;
  } {
    const { startDate, endDate, apiKeyId, tenantId, action, resourceType, status, limit = 100, offset = 0 } = filters;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (startDate) {
      whereClauses.push('timestamp >= ?');
      params.push(startDate);
    }

    if (endDate) {
      whereClauses.push('timestamp <= ?');
      params.push(endDate);
    }

    if (apiKeyId) {
      whereClauses.push('api_key_id = ?');
      params.push(apiKeyId);
    }

    if (tenantId) {
      whereClauses.push('tenant_id = ?');
      params.push(tenantId);
    }

    if (action) {
      whereClauses.push('action = ?');
      params.push(action);
    }

    if (resourceType) {
      whereClauses.push('resource_type = ?');
      params.push(resourceType);
    }

    if (status) {
      whereClauses.push('status = ?');
      params.push(status);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Get total count
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM audit_log ${whereClause}`);
    const countRow = countStmt.get(...params) as { count: number };
    const total = countRow.count;

    // Get paginated results
    const stmt = this.db.prepare(`
      SELECT
        id, timestamp, api_key_id, tenant_id, action, resource_type, resource_id,
        server_id, status, duration_ms, metadata_json, error
      FROM audit_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...params, limit, offset) as {
      id: string;
      timestamp: string;
      api_key_id: string | null;
      tenant_id: string | null;
      action: AuditAction;
      resource_type: AuditResourceType;
      resource_id: string | null;
      server_id: string | null;
      status: AuditStatus;
      duration_ms: number | null;
      metadata_json: string;
      error: string | null;
    }[];

    const logs = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      apiKeyId: row.api_key_id,
      tenantId: row.tenant_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      serverId: row.server_id,
      status: row.status,
      durationMs: row.duration_ms,
      metadata: JSON.parse(row.metadata_json),
      error: row.error,
    }));

    return { logs, total };
  }

  /**
   * Get audit statistics
   */
  getStats(filters: {
    startDate?: string;
    endDate?: string;
    tenantId?: string;
  }): {
    totalEvents: number;
    successRate: number;
    averageDuration: number;
    topActions: Array<{ action: string; count: number }>;
    topResourceTypes: Array<{ resourceType: string; count: number }>;
  } {
    const { startDate, endDate, tenantId } = filters;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (startDate) {
      whereClauses.push('timestamp >= ?');
      params.push(startDate);
    }

    if (endDate) {
      whereClauses.push('timestamp <= ?');
      params.push(endDate);
    }

    if (tenantId) {
      whereClauses.push('tenant_id = ?');
      params.push(tenantId);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Total events and success rate
    const statsStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        AVG(duration_ms) as avg_duration
      FROM audit_log
      ${whereClause}
    `);

    const stats = statsStmt.get(...params) as {
      total_events: number;
      success_count: number;
      avg_duration: number;
    };

    // Top actions
    const actionsStmt = this.db.prepare(`
      SELECT action, COUNT(*) as count
      FROM audit_log
      ${whereClause}
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `);

    const topActions = actionsStmt.all(...params) as Array<{ action: string; count: number }>;

    // Top resource types
    const resourcesStmt = this.db.prepare(`
      SELECT resource_type, COUNT(*) as count
      FROM audit_log
      ${whereClause}
      GROUP BY resource_type
      ORDER BY count DESC
      LIMIT 10
    `);

    const topResourceTypes = resourcesStmt.all(...params) as Array<{ resourceType: string; count: number }>;

    return {
      totalEvents: stats.total_events || 0,
      successRate: stats.total_events > 0 ? (stats.success_count / stats.total_events) * 100 : 0,
      averageDuration: stats.avg_duration || 0,
      topActions,
      topResourceTypes,
    };
  }

  /**
   * Clean up old audit logs
   * Removes logs older than the specified number of days
   */
  cleanup(daysToKeep: number = 90): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const stmt = this.db.prepare(`
      DELETE FROM audit_log
      WHERE timestamp < ?
    `);

    const result = stmt.run(cutoffDate.toISOString());
    logger.info({ deletedCount: result.changes, daysToKeep }, 'Cleaned up old audit logs');

    return result.changes;
  }
}
