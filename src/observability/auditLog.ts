import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from './logger.js';

const logger = createChildLogger({ module: 'audit-log' });

export type AuditAction =
  | 'server.create'
  | 'server.update'
  | 'server.delete'
  | 'server.connect'
  | 'server.disconnect'
  | 'tool.invoke'
  | 'tool.invoke.success'
  | 'tool.invoke.failure'
  | 'apikey.create'
  | 'apikey.update'
  | 'apikey.delete'
  | 'apikey.regenerate'
  | 'group.create'
  | 'group.update'
  | 'group.delete'
  | 'cache.invalidate'
  | 'cache.clear'
  | 'circuit.open'
  | 'circuit.close'
  | 'circuit.reset'
  | 'auth.success'
  | 'auth.failure'
  | 'workflow.list'
  | 'workflow.create'
  | 'workflow.update'
  | 'workflow.delete'
  | 'workflow.execute'
  | 'workflow_template.list'
  | 'workflow_template.create'
  | 'workflow_template.update'
  | 'workflow_template.delete'
  | 'workflow_template.instantiate';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  apiKeyId: string | null;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  durationMs: number | null;
  success: boolean;
}

export interface AuditQueryOptions {
  action?: AuditAction | AuditAction[];
  apiKeyId?: string;
  resourceType?: string;
  resourceId?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEntries: number;
  byAction: Record<string, number>;
  byResourceType: Record<string, number>;
  successRate: number;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
}

/**
 * Audit logger for tracking all system actions
 */
export class AuditLogger {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
    logger.info('Audit logger initialized');
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        action TEXT NOT NULL,
        api_key_id TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        details_json TEXT,
        ip_address TEXT,
        user_agent TEXT,
        duration_ms INTEGER,
        success INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_api_key ON audit_log(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
    `);
  }

  /**
   * Log an audit entry
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const id = uuidv4();
    const timestamp = new Date();

    // Extract tenant_id from details if present
    const tenantId = (entry.details as any)?.tenantId || null;

    // Extract error from details if present
    const error = (entry.details as any)?.error || null;

    const stmt = this.db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, action, api_key_id, tenant_id, resource_type, resource_id,
        server_id, status, duration_ms, metadata_json, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      timestamp.toISOString(),
      entry.action,
      entry.apiKeyId,
      tenantId,
      entry.resourceType,
      entry.resourceId,
      null, // server_id - not used for most operations
      entry.success ? 'success' : 'failure',
      entry.durationMs,
      JSON.stringify(entry.details || {}),
      error
    );

    logger.debug(
      { id, action: entry.action, resourceType: entry.resourceType },
      'Audit entry logged'
    );

    return {
      id,
      timestamp,
      ...entry,
    };
  }

  /**
   * Log a server action
   */
  logServerAction(
    action: 'server.create' | 'server.update' | 'server.delete' | 'server.connect' | 'server.disconnect',
    serverId: string,
    details: Record<string, unknown>,
    context?: { apiKeyId?: string; ipAddress?: string; userAgent?: string }
  ): AuditEntry {
    return this.log({
      action,
      resourceType: 'server',
      resourceId: serverId,
      details,
      apiKeyId: context?.apiKeyId ?? null,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
      durationMs: null,
      success: true,
    });
  }

  /**
   * Log a tool invocation
   */
  logToolInvocation(
    toolName: string,
    serverId: string,
    success: boolean,
    durationMs: number,
    details: Record<string, unknown>,
    context?: { apiKeyId?: string; ipAddress?: string; userAgent?: string }
  ): AuditEntry {
    return this.log({
      action: success ? 'tool.invoke.success' : 'tool.invoke.failure',
      resourceType: 'tool',
      resourceId: toolName,
      details: { serverId, ...details },
      apiKeyId: context?.apiKeyId ?? null,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
      durationMs,
      success,
    });
  }

  /**
   * Log an API key action
   */
  logApiKeyAction(
    action: 'apikey.create' | 'apikey.update' | 'apikey.delete' | 'apikey.regenerate',
    apiKeyId: string,
    details: Record<string, unknown>,
    context?: { ipAddress?: string; userAgent?: string }
  ): AuditEntry {
    return this.log({
      action,
      resourceType: 'apikey',
      resourceId: apiKeyId,
      details,
      apiKeyId: null, // The acting key is not the same as the affected key
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
      durationMs: null,
      success: true,
    });
  }

  /**
   * Log an authentication attempt
   */
  logAuthAttempt(
    success: boolean,
    apiKeyId: string | null,
    details: Record<string, unknown>,
    context?: { ipAddress?: string; userAgent?: string }
  ): AuditEntry {
    return this.log({
      action: success ? 'auth.success' : 'auth.failure',
      resourceType: 'auth',
      resourceId: null,
      details,
      apiKeyId,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
      durationMs: null,
      success,
    });
  }

  /**
   * Query audit entries
   */
  query(options: AuditQueryOptions = {}): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.action) {
      if (Array.isArray(options.action)) {
        const placeholders = options.action.map(() => '?').join(', ');
        conditions.push(`action IN (${placeholders})`);
        params.push(...options.action);
      } else {
        conditions.push('action = ?');
        params.push(options.action);
      }
    }

    if (options.apiKeyId) {
      conditions.push('api_key_id = ?');
      params.push(options.apiKeyId);
    }

    if (options.resourceType) {
      conditions.push('resource_type = ?');
      params.push(options.resourceType);
    }

    if (options.resourceId) {
      conditions.push('resource_id = ?');
      params.push(options.resourceId);
    }

    if (options.success !== undefined) {
      conditions.push('success = ?');
      params.push(options.success ? 1 : 0);
    }

    if (options.startDate) {
      conditions.push('timestamp >= ?');
      params.push(options.startDate.toISOString());
    }

    if (options.endDate) {
      conditions.push('timestamp <= ?');
      params.push(options.endDate.toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const stmt = this.db.prepare(`
      SELECT * FROM audit_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    params.push(limit, offset);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map(this.rowToEntry);
  }

  /**
   * Get audit entry by ID
   */
  getById(id: string): AuditEntry | null {
    const stmt = this.db.prepare('SELECT * FROM audit_log WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    return row ? this.rowToEntry(row) : null;
  }

  /**
   * Get audit statistics
   */
  getStats(since?: Date): AuditStats {
    const sinceClause = since ? 'WHERE timestamp >= ?' : '';
    const sinceParams = since ? [since.toISOString()] : [];

    // Total entries
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM audit_log ${sinceClause}`);
    const { count: totalEntries } = countStmt.get(...sinceParams) as { count: number };

    // By action
    const actionStmt = this.db.prepare(`
      SELECT action, COUNT(*) as count FROM audit_log ${sinceClause}
      GROUP BY action
    `);
    const actionRows = actionStmt.all(...sinceParams) as Array<{ action: string; count: number }>;
    const byAction: Record<string, number> = {};
    for (const row of actionRows) {
      byAction[row.action] = row.count;
    }

    // By resource type
    const resourceStmt = this.db.prepare(`
      SELECT resource_type, COUNT(*) as count FROM audit_log ${sinceClause}
      GROUP BY resource_type
    `);
    const resourceRows = resourceStmt.all(...sinceParams) as Array<{ resource_type: string; count: number }>;
    const byResourceType: Record<string, number> = {};
    for (const row of resourceRows) {
      byResourceType[row.resource_type] = row.count;
    }

    // Success rate
    const successStmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(*) as total
      FROM audit_log ${sinceClause}
    `);
    const { successes, total } = successStmt.get(...sinceParams) as { successes: number; total: number };
    const successRate = total > 0 ? Math.round((successes / total) * 100) / 100 : 1;

    // Recent activity (last 7 days)
    const activityStmt = this.db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM audit_log
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `);
    const activityRows = activityStmt.all() as Array<{ date: string; count: number }>;
    const recentActivity = activityRows.map((row) => ({
      date: row.date,
      count: row.count,
    }));

    return {
      totalEntries,
      byAction,
      byResourceType,
      successRate,
      recentActivity,
    };
  }

  /**
   * Export audit entries as JSON
   */
  export(options: AuditQueryOptions = {}): string {
    const entries = this.query({ ...options, limit: 10000 });
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Export audit entries as CSV
   */
  exportCsv(options: AuditQueryOptions = {}): string {
    const entries = this.query({ ...options, limit: 10000 });

    const headers = [
      'id',
      'timestamp',
      'action',
      'api_key_id',
      'resource_type',
      'resource_id',
      'success',
      'duration_ms',
      'ip_address',
      'user_agent',
      'details',
    ];

    const rows = entries.map((entry) => [
      entry.id,
      entry.timestamp.toISOString(),
      entry.action,
      entry.apiKeyId || '',
      entry.resourceType,
      entry.resourceId || '',
      entry.success ? 'true' : 'false',
      entry.durationMs?.toString() || '',
      entry.ipAddress || '',
      entry.userAgent || '',
      JSON.stringify(entry.details).replace(/"/g, '""'), // Escape quotes for CSV
    ]);

    const csvRows = [headers.join(',')];
    for (const row of rows) {
      csvRows.push(row.map((v) => `"${v}"`).join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * Cleanup old entries
   */
  cleanup(olderThanDays: number = 90): number {
    const stmt = this.db.prepare(`
      DELETE FROM audit_log
      WHERE timestamp < datetime('now', ? || ' days')
    `);
    const result = stmt.run(`-${olderThanDays}`);

    if (result.changes > 0) {
      logger.info({ deletedCount: result.changes, olderThanDays }, 'Audit log entries cleaned up');
    }

    return result.changes;
  }

  private rowToEntry(row: Record<string, unknown>): AuditEntry {
    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string),
      action: row.action as AuditAction,
      apiKeyId: row.api_key_id as string | null,
      resourceType: row.resource_type as string,
      resourceId: row.resource_id as string | null,
      details: JSON.parse((row.details_json as string) || '{}'),
      ipAddress: row.ip_address as string | null,
      userAgent: row.user_agent as string | null,
      durationMs: row.duration_ms as number | null,
      success: (row.success as number) === 1,
    };
  }
}

// Singleton instance - will be initialized after database is ready
let instance: AuditLogger | null = null;

export function initializeAuditLogger(db: Database.Database): AuditLogger {
  if (!instance) {
    instance = new AuditLogger(db);
  }
  return instance;
}

export function getAuditLogger(): AuditLogger {
  if (!instance) {
    throw new Error('Audit logger not initialized. Call initializeAuditLogger() first.');
  }
  return instance;
}
