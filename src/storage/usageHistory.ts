import Database from 'better-sqlite3';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'usage-history' });

export interface UsageRecord {
  id: number;
  apiKeyId: string;
  toolName: string;
  serverId: string;
  success: boolean;
  durationMs: number;
  errorMessage?: string;
  params?: Record<string, unknown>;
  createdAt: Date;
}

export interface UsageStats {
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  averageDurationMs: number;
  toolBreakdown: Array<{ toolName: string; count: number; avgDurationMs: number }>;
}

export class UsageHistoryStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        server_id TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        params TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage_history(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_history(tool_name);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_api_key_tool ON usage_history(api_key_id, tool_name);
    `);
    logger.info('Usage history table initialized');
  }

  recordUsage(
    apiKeyId: string,
    toolName: string,
    serverId: string,
    success: boolean,
    durationMs: number,
    errorMessage?: string,
    params?: Record<string, unknown>
  ): UsageRecord {
    const now = new Date();

    const stmt = this.db.prepare(`
      INSERT INTO usage_history (api_key_id, tool_name, server_id, success, duration_ms, error_message, params, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const paramsJson = params ? JSON.stringify(params) : null;
    const result = stmt.run(
      apiKeyId,
      toolName,
      serverId,
      success ? 1 : 0,
      durationMs,
      errorMessage || null,
      paramsJson,
      now.toISOString()
    );

    logger.debug({ apiKeyId, toolName, success, durationMs }, 'Usage recorded');

    return {
      id: result.lastInsertRowid as number,
      apiKeyId,
      toolName,
      serverId,
      success,
      durationMs,
      errorMessage,
      params,
      createdAt: now,
    };
  }

  getRecentUsage(apiKeyId: string, limit: number = 50): UsageRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, api_key_id, tool_name, server_id, success, duration_ms, error_message, params, created_at
      FROM usage_history
      WHERE api_key_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(apiKeyId, limit) as Array<{
      id: number;
      api_key_id: string;
      tool_name: string;
      server_id: string;
      success: number;
      duration_ms: number;
      error_message: string | null;
      params: string | null;
      created_at: string;
    }>;

    return rows.map((row) => this.rowToUsageRecord(row));
  }

  getToolHistory(toolName: string, apiKeyId?: string, limit: number = 50): UsageRecord[] {
    let sql = `
      SELECT id, api_key_id, tool_name, server_id, success, duration_ms, error_message, params, created_at
      FROM usage_history
      WHERE tool_name = ?
    `;
    const params: (string | number)[] = [toolName];

    if (apiKeyId) {
      sql += ' AND api_key_id = ?';
      params.push(apiKeyId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      api_key_id: string;
      tool_name: string;
      server_id: string;
      success: number;
      duration_ms: number;
      error_message: string | null;
      params: string | null;
      created_at: string;
    }>;

    return rows.map((row) => this.rowToUsageRecord(row));
  }

  getRecentlyUsedTools(apiKeyId: string, limit: number = 10): Array<{ toolName: string; lastUsed: Date; count: number }> {
    const stmt = this.db.prepare(`
      SELECT tool_name, MAX(created_at) as last_used, COUNT(*) as count
      FROM usage_history
      WHERE api_key_id = ?
      GROUP BY tool_name
      ORDER BY last_used DESC
      LIMIT ?
    `);

    const rows = stmt.all(apiKeyId, limit) as Array<{
      tool_name: string;
      last_used: string;
      count: number;
    }>;

    return rows.map((row) => ({
      toolName: row.tool_name,
      lastUsed: new Date(row.last_used),
      count: row.count,
    }));
  }

  getMostUsedTools(apiKeyId: string, limit: number = 10): Array<{ toolName: string; count: number; avgDurationMs: number }> {
    const stmt = this.db.prepare(`
      SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration
      FROM usage_history
      WHERE api_key_id = ?
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT ?
    `);

    const rows = stmt.all(apiKeyId, limit) as Array<{
      tool_name: string;
      count: number;
      avg_duration: number;
    }>;

    return rows.map((row) => ({
      toolName: row.tool_name,
      count: row.count,
      avgDurationMs: Math.round(row.avg_duration),
    }));
  }

  getUsageStats(apiKeyId: string, since?: Date): UsageStats {
    let sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count,
        AVG(duration_ms) as avg_duration
      FROM usage_history
      WHERE api_key_id = ?
    `;
    const params: (string | number)[] = [apiKeyId];

    if (since) {
      sql += ' AND created_at >= ?';
      params.push(since.toISOString());
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as {
      total: number;
      success_count: number;
      error_count: number;
      avg_duration: number | null;
    };

    // Get tool breakdown
    let breakdownSql = `
      SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration
      FROM usage_history
      WHERE api_key_id = ?
    `;
    const breakdownParams: (string | number)[] = [apiKeyId];

    if (since) {
      breakdownSql += ' AND created_at >= ?';
      breakdownParams.push(since.toISOString());
    }

    breakdownSql += ' GROUP BY tool_name ORDER BY count DESC LIMIT 20';

    const breakdownStmt = this.db.prepare(breakdownSql);
    const breakdownRows = breakdownStmt.all(...breakdownParams) as Array<{
      tool_name: string;
      count: number;
      avg_duration: number;
    }>;

    return {
      totalInvocations: row.total,
      successCount: row.success_count,
      errorCount: row.error_count,
      averageDurationMs: row.avg_duration ? Math.round(row.avg_duration) : 0,
      toolBreakdown: breakdownRows.map((r) => ({
        toolName: r.tool_name,
        count: r.count,
        avgDurationMs: Math.round(r.avg_duration),
      })),
    };
  }

  getGlobalStats(since?: Date): {
    totalInvocations: number;
    uniqueUsers: number;
    uniqueTools: number;
    successRate: number;
    topTools: Array<{ toolName: string; count: number }>;
  } {
    let sql = `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT api_key_id) as unique_users,
        COUNT(DISTINCT tool_name) as unique_tools,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
      FROM usage_history
    `;
    const params: string[] = [];

    if (since) {
      sql += ' WHERE created_at >= ?';
      params.push(since.toISOString());
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as {
      total: number;
      unique_users: number;
      unique_tools: number;
      success_rate: number | null;
    };

    // Get top tools
    let topToolsSql = `
      SELECT tool_name, COUNT(*) as count
      FROM usage_history
    `;
    const topParams: string[] = [];

    if (since) {
      topToolsSql += ' WHERE created_at >= ?';
      topParams.push(since.toISOString());
    }

    topToolsSql += ' GROUP BY tool_name ORDER BY count DESC LIMIT 10';

    const topStmt = this.db.prepare(topToolsSql);
    const topRows = topStmt.all(...topParams) as Array<{
      tool_name: string;
      count: number;
    }>;

    return {
      totalInvocations: row.total,
      uniqueUsers: row.unique_users,
      uniqueTools: row.unique_tools,
      successRate: row.success_rate ? Math.round(row.success_rate * 100) / 100 : 0,
      topTools: topRows.map((r) => ({
        toolName: r.tool_name,
        count: r.count,
      })),
    };
  }

  clearHistory(apiKeyId: string, olderThan?: Date): number {
    let sql = 'DELETE FROM usage_history WHERE api_key_id = ?';
    const params: (string | number)[] = [apiKeyId];

    if (olderThan) {
      sql += ' AND created_at < ?';
      params.push(olderThan.toISOString());
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);

    logger.info({ apiKeyId, count: result.changes, olderThan }, 'Usage history cleared');

    return result.changes;
  }

  private rowToUsageRecord(row: {
    id: number;
    api_key_id: string;
    tool_name: string;
    server_id: string;
    success: number;
    duration_ms: number;
    error_message: string | null;
    params: string | null;
    created_at: string;
  }): UsageRecord {
    return {
      id: row.id,
      apiKeyId: row.api_key_id,
      toolName: row.tool_name,
      serverId: row.server_id,
      success: row.success === 1,
      durationMs: row.duration_ms,
      errorMessage: row.error_message || undefined,
      params: row.params ? JSON.parse(row.params) : undefined,
      createdAt: new Date(row.created_at),
    };
  }
}

// Create singleton instance using the same database path as favorites
const usageHistoryDb = new Database(process.env.DB_PATH || './data/mcp-connect.db');
export const usageHistoryStore = new UsageHistoryStore(usageHistoryDb);
