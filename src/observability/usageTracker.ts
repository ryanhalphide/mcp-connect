/**
 * Usage Tracking and Cost Metrics
 * Tracks token usage and costs for billing and analytics
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from './logger.js';

const logger = createChildLogger({ module: 'usage-tracker' });

export type UsageActionType =
  | 'tool:invoke'
  | 'resource:read'
  | 'prompt:get'
  | 'workflow:execute'
  | 'search:query'
  | 'embedding:generate'
  | 'llm:completion'
  | 'llm:chat';

export interface UsageMetric {
  id: string;
  timestamp: string;
  apiKeyId: string | null;
  tenantId: string | null;
  serverId: string | null;
  actionType: UsageActionType;
  count: number;
  durationMs: number | null;
  tokensUsed: number;
  costCredits: number;
  metadata: Record<string, unknown>;
}

export interface UsageOptions {
  apiKeyId?: string;
  tenantId?: string;
  serverId?: string;
  durationMs?: number;
  tokensUsed?: number;
  costCredits?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  totalActions: number;
  totalTokens: number;
  totalCost: number;
  averageDuration: number;
  breakdownByAction: Array<{
    actionType: string;
    count: number;
    tokens: number;
    cost: number;
  }>;
  period: {
    start: string;
    end: string;
  };
}

/**
 * Token pricing (credits per 1K tokens)
 * Based on typical LLM pricing models
 */
const TOKEN_PRICING = {
  'gpt-4-turbo': {
    input: 0.01, // $0.01 per 1K input tokens
    output: 0.03, // $0.03 per 1K output tokens
  },
  'gpt-3.5-turbo': {
    input: 0.0005, // $0.0005 per 1K input tokens
    output: 0.0015, // $0.0015 per 1K output tokens
  },
  'claude-3-opus': {
    input: 0.015,
    output: 0.075,
  },
  'claude-3-sonnet': {
    input: 0.003,
    output: 0.015,
  },
  'text-embedding-3-small': {
    input: 0.00002,
    output: 0, // Embeddings don't have output tokens
  },
  'text-embedding-3-large': {
    input: 0.00013,
    output: 0,
  },
  default: {
    input: 0.001,
    output: 0.002,
  },
};

export class UsageTracker {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Track a usage event
   */
  track(actionType: UsageActionType, options: UsageOptions = {}): void {
    const id = randomBytes(16).toString('hex');
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO usage_metrics (
        id, timestamp, api_key_id, tenant_id, server_id, action_type,
        count, duration_ms, tokens_used, cost_credits, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id,
        timestamp,
        options.apiKeyId || null,
        options.tenantId || null,
        options.serverId || null,
        actionType,
        1, // count
        options.durationMs || null,
        options.tokensUsed || 0,
        options.costCredits || 0,
        JSON.stringify(options.metadata || {})
      );

      logger.debug({ actionType, tokensUsed: options.tokensUsed, cost: options.costCredits }, 'Usage metric tracked');
    } catch (error) {
      logger.error({ actionType, error }, 'Failed to track usage metric');
    }
  }

  /**
   * Calculate cost from token usage
   * @param model - Model name (e.g., 'gpt-4-turbo', 'claude-3-sonnet')
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @returns Cost in credits (1 credit = $1 USD)
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number = 0): number {
    const pricing = TOKEN_PRICING[model as keyof typeof TOKEN_PRICING] || TOKEN_PRICING.default;

    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Track usage with automatic cost calculation
   */
  trackWithCost(
    actionType: UsageActionType,
    model: string,
    inputTokens: number,
    outputTokens: number = 0,
    options: Omit<UsageOptions, 'tokensUsed' | 'costCredits'> = {}
  ): void {
    const totalTokens = inputTokens + outputTokens;
    const cost = this.calculateCost(model, inputTokens, outputTokens);

    this.track(actionType, {
      ...options,
      tokensUsed: totalTokens,
      costCredits: cost,
      metadata: {
        ...options.metadata,
        model,
        inputTokens,
        outputTokens,
      },
    });
  }

  /**
   * Get usage summary for a time period
   */
  getSummary(filters: {
    startDate?: string;
    endDate?: string;
    apiKeyId?: string;
    tenantId?: string;
    serverId?: string;
  }): UsageSummary {
    const { startDate, endDate, apiKeyId, tenantId, serverId } = filters;

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

    if (serverId) {
      whereClauses.push('server_id = ?');
      params.push(serverId);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Get overall stats
    const statsStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_actions,
        SUM(tokens_used) as total_tokens,
        SUM(cost_credits) as total_cost,
        AVG(duration_ms) as avg_duration
      FROM usage_metrics
      ${whereClause}
    `);

    const stats = statsStmt.get(...params) as {
      total_actions: number;
      total_tokens: number;
      total_cost: number;
      avg_duration: number;
    };

    // Get breakdown by action type
    const breakdownStmt = this.db.prepare(`
      SELECT
        action_type,
        COUNT(*) as count,
        SUM(tokens_used) as tokens,
        SUM(cost_credits) as cost
      FROM usage_metrics
      ${whereClause}
      GROUP BY action_type
      ORDER BY cost DESC
    `);

    const breakdown = breakdownStmt.all(...params) as Array<{
      action_type: string;
      count: number;
      tokens: number;
      cost: number;
    }>;

    return {
      totalActions: stats.total_actions || 0,
      totalTokens: stats.total_tokens || 0,
      totalCost: stats.total_cost || 0,
      averageDuration: stats.avg_duration || 0,
      breakdownByAction: breakdown.map((row) => ({
        actionType: row.action_type,
        count: row.count,
        tokens: row.tokens || 0,
        cost: row.cost || 0,
      })),
      period: {
        start: startDate || 'beginning',
        end: endDate || 'now',
      },
    };
  }

  /**
   * Get usage metrics as time series
   */
  getTimeSeries(filters: {
    startDate?: string;
    endDate?: string;
    apiKeyId?: string;
    tenantId?: string;
    serverId?: string;
    interval?: 'hour' | 'day' | 'week' | 'month';
  }): Array<{
    period: string;
    actions: number;
    tokens: number;
    cost: number;
  }> {
    const { startDate, endDate, apiKeyId, tenantId, serverId, interval = 'day' } = filters;

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

    if (serverId) {
      whereClauses.push('server_id = ?');
      params.push(serverId);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Determine date grouping format
    let dateFormat: string;
    switch (interval) {
      case 'hour':
        dateFormat = "strftime('%Y-%m-%d %H:00', timestamp)";
        break;
      case 'week':
        dateFormat = "strftime('%Y-W%W', timestamp)";
        break;
      case 'month':
        dateFormat = "strftime('%Y-%m', timestamp)";
        break;
      case 'day':
      default:
        dateFormat = "strftime('%Y-%m-%d', timestamp)";
        break;
    }

    const stmt = this.db.prepare(`
      SELECT
        ${dateFormat} as period,
        COUNT(*) as actions,
        SUM(tokens_used) as tokens,
        SUM(cost_credits) as cost
      FROM usage_metrics
      ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `);

    const rows = stmt.all(...params) as Array<{
      period: string;
      actions: number;
      tokens: number;
      cost: number;
    }>;

    return rows.map((row) => ({
      period: row.period,
      actions: row.actions,
      tokens: row.tokens || 0,
      cost: row.cost || 0,
    }));
  }

  /**
   * Get top consumers (by tenant, API key, or server)
   */
  getTopConsumers(
    by: 'tenant' | 'api_key' | 'server',
    filters: {
      startDate?: string;
      endDate?: string;
      limit?: number;
    } = {}
  ): Array<{
    id: string;
    name?: string;
    actions: number;
    tokens: number;
    cost: number;
  }> {
    const { startDate, endDate, limit = 10 } = filters;

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

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    let groupByColumn: string;
    switch (by) {
      case 'tenant':
        groupByColumn = 'tenant_id';
        break;
      case 'api_key':
        groupByColumn = 'api_key_id';
        break;
      case 'server':
        groupByColumn = 'server_id';
        break;
    }

    const stmt = this.db.prepare(`
      SELECT
        ${groupByColumn} as id,
        COUNT(*) as actions,
        SUM(tokens_used) as tokens,
        SUM(cost_credits) as cost
      FROM usage_metrics
      ${whereClause}
      GROUP BY ${groupByColumn}
      HAVING ${groupByColumn} IS NOT NULL
      ORDER BY cost DESC
      LIMIT ?
    `);

    const rows = stmt.all(...params, limit) as Array<{
      id: string;
      actions: number;
      tokens: number;
      cost: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      actions: row.actions,
      tokens: row.tokens || 0,
      cost: row.cost || 0,
    }));
  }

  /**
   * Clean up old usage metrics
   * Removes metrics older than the specified number of days
   */
  cleanup(daysToKeep: number = 90): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const stmt = this.db.prepare(`
      DELETE FROM usage_metrics
      WHERE timestamp < ?
    `);

    const result = stmt.run(cutoffDate.toISOString());
    logger.info({ deletedCount: result.changes, daysToKeep }, 'Cleaned up old usage metrics');

    return result.changes;
  }
}
