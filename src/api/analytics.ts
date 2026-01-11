import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { serverDatabase } from '../storage/db.js';
import { createChildLogger } from '../observability/logger.js';
import { checkPermission } from '../rbac/enforcer.js';

const logger = createChildLogger({ module: 'analytics-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Schema for date range queries
const DateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  interval: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  limit: z.coerce.number().min(1).max(1000).default(100),
});

// Schema for cost breakdown queries
const CostBreakdownSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  groupBy: z.enum(['workflow', 'model', 'tenant', 'step', 'apiKey']).default('workflow'),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// Schema for workflow analytics
const WorkflowAnalyticsSchema = z.object({
  workflowId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  includeSteps: z.coerce.boolean().default(false),
});

export const analyticsApi = new Hono();

/**
 * GET /analytics/cost/overview
 * High-level cost metrics overview
 */
analyticsApi.get('/cost/overview', checkPermission('analytics:read'), (c) => {
  try {
    const db = serverDatabase.getDatabase();

    // Total cost across all workflows
    const totalCostStmt = db.prepare(`
      SELECT
        SUM(cost_credits) as total_cost,
        SUM(tokens_used) as total_tokens,
        COUNT(DISTINCT execution_id) as total_executions,
        COUNT(*) as total_steps
      FROM workflow_execution_steps
      WHERE cost_credits > 0 OR tokens_used > 0
    `);
    const totalCost = totalCostStmt.get() as {
      total_cost: number | null;
      total_tokens: number | null;
      total_executions: number;
      total_steps: number;
    };

    // Cost breakdown by model
    const modelBreakdownStmt = db.prepare(`
      SELECT
        model_name,
        COUNT(*) as uses,
        SUM(tokens_used) as total_tokens,
        SUM(cost_credits) as total_cost,
        AVG(cost_credits) as avg_cost
      FROM workflow_execution_steps
      WHERE model_name IS NOT NULL
      GROUP BY model_name
      ORDER BY total_cost DESC
    `);
    const modelBreakdown = modelBreakdownStmt.all() as Array<{
      model_name: string;
      uses: number;
      total_tokens: number;
      total_cost: number;
      avg_cost: number;
    }>;

    // Recent trend (last 7 days)
    const trendStmt = db.prepare(`
      SELECT
        DATE(wes.started_at) as date,
        SUM(wes.cost_credits) as daily_cost,
        SUM(wes.tokens_used) as daily_tokens,
        COUNT(DISTINCT wes.execution_id) as daily_executions
      FROM workflow_execution_steps wes
      WHERE wes.started_at >= datetime('now', '-7 days')
      GROUP BY DATE(wes.started_at)
      ORDER BY date DESC
    `);
    const trend = trendStmt.all() as Array<{
      date: string;
      daily_cost: number;
      daily_tokens: number;
      daily_executions: number;
    }>;

    return c.json(
      apiResponse({
        totalCost: totalCost.total_cost || 0,
        totalTokens: totalCost.total_tokens || 0,
        totalExecutions: totalCost.total_executions,
        totalSteps: totalCost.total_steps,
        modelBreakdown,
        recentTrend: trend,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get cost overview');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get cost overview'),
      500
    );
  }
});

/**
 * GET /analytics/cost/timeseries
 * Time-series cost data for charting
 */
analyticsApi.get('/cost/timeseries', checkPermission('analytics:read'), (c) => {
  try {
    const queryParams = c.req.query();
    const validated = DateRangeSchema.parse(queryParams);
    const db = serverDatabase.getDatabase();

    let dateFormat: string;
    let groupBy: string;

    switch (validated.interval) {
      case 'hour':
        dateFormat = '%Y-%m-%d %H:00:00';
        groupBy = "strftime('%Y-%m-%d %H:00:00', wes.started_at)";
        break;
      case 'week':
        dateFormat = '%Y-W%W';
        groupBy = "strftime('%Y-W%W', wes.started_at)";
        break;
      case 'month':
        dateFormat = '%Y-%m';
        groupBy = "strftime('%Y-%m', wes.started_at)";
        break;
      case 'day':
      default:
        dateFormat = '%Y-%m-%d';
        groupBy = "DATE(wes.started_at)";
        break;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (validated.startDate) {
      conditions.push('wes.started_at >= ?');
      params.push(validated.startDate);
    }
    if (validated.endDate) {
      conditions.push('wes.started_at <= ?');
      params.push(validated.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = db.prepare(`
      SELECT
        ${groupBy} as period,
        SUM(wes.cost_credits) as total_cost,
        SUM(wes.tokens_used) as total_tokens,
        COUNT(DISTINCT wes.execution_id) as executions,
        COUNT(*) as steps,
        AVG(wes.cost_credits) as avg_step_cost,
        AVG(wes.duration_ms) as avg_duration
      FROM workflow_execution_steps wes
      ${whereClause}
      GROUP BY period
      ORDER BY period DESC
      LIMIT ?
    `);

    const timeseries = stmt.all(...params, validated.limit) as Array<{
      period: string;
      total_cost: number;
      total_tokens: number;
      executions: number;
      steps: number;
      avg_step_cost: number;
      avg_duration: number;
    }>;

    return c.json(
      apiResponse({
        interval: validated.interval,
        data: timeseries,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get cost timeseries');
    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get cost timeseries'),
      500
    );
  }
});

/**
 * GET /analytics/cost/breakdown
 * Cost breakdown by different dimensions
 */
analyticsApi.get('/cost/breakdown', checkPermission('analytics:read'), (c) => {
  try {
    const queryParams = c.req.query();
    const validated = CostBreakdownSchema.parse(queryParams);
    const db = serverDatabase.getDatabase();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (validated.startDate) {
      conditions.push('wes.started_at >= ?');
      params.push(validated.startDate);
    }
    if (validated.endDate) {
      conditions.push('wes.started_at <= ?');
      params.push(validated.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let query: string;
    let groupByField: string;

    switch (validated.groupBy) {
      case 'workflow':
        groupByField = 'w.name';
        query = `
          SELECT
            w.id as id,
            w.name as name,
            COUNT(DISTINCT wes.execution_id) as executions,
            COUNT(*) as steps,
            SUM(wes.cost_credits) as total_cost,
            SUM(wes.tokens_used) as total_tokens,
            AVG(wes.cost_credits) as avg_step_cost,
            AVG(wes.duration_ms) as avg_duration
          FROM workflow_execution_steps wes
          JOIN workflow_executions we ON wes.execution_id = we.id
          JOIN workflows w ON we.workflow_id = w.id
          ${whereClause}
          GROUP BY w.id, w.name
          ORDER BY total_cost DESC
          LIMIT ?
        `;
        break;

      case 'model':
        groupByField = 'wes.model_name';
        query = `
          SELECT
            wes.model_name as name,
            COUNT(*) as uses,
            SUM(wes.cost_credits) as total_cost,
            SUM(wes.tokens_used) as total_tokens,
            AVG(wes.cost_credits) as avg_cost,
            AVG(wes.duration_ms) as avg_duration
          FROM workflow_execution_steps wes
          ${whereClause ? whereClause + ' AND wes.model_name IS NOT NULL' : 'WHERE wes.model_name IS NOT NULL'}
          GROUP BY wes.model_name
          ORDER BY total_cost DESC
          LIMIT ?
        `;
        break;

      case 'step':
        groupByField = 'wes.step_name';
        query = `
          SELECT
            wes.step_name as name,
            COUNT(*) as executions,
            SUM(wes.cost_credits) as total_cost,
            SUM(wes.tokens_used) as total_tokens,
            AVG(wes.cost_credits) as avg_cost,
            AVG(wes.duration_ms) as avg_duration,
            MIN(wes.cost_credits) as min_cost,
            MAX(wes.cost_credits) as max_cost
          FROM workflow_execution_steps wes
          ${whereClause}
          GROUP BY wes.step_name
          ORDER BY total_cost DESC
          LIMIT ?
        `;
        break;

      case 'tenant':
        groupByField = 'um.tenant_id';
        query = `
          SELECT
            um.tenant_id as id,
            um.tenant_id as name,
            SUM(um.count) as actions,
            SUM(um.tokens_used) as total_tokens,
            SUM(um.cost_credits) as total_cost,
            AVG(um.duration_ms) as avg_duration
          FROM usage_metrics um
          WHERE um.action_type = 'workflow:execute'
            ${validated.startDate ? 'AND um.timestamp >= ?' : ''}
            ${validated.endDate ? 'AND um.timestamp <= ?' : ''}
          GROUP BY um.tenant_id
          ORDER BY total_cost DESC
          LIMIT ?
        `;
        params.length = 0; // Reset params for usage_metrics query
        if (validated.startDate) params.push(validated.startDate);
        if (validated.endDate) params.push(validated.endDate);
        break;

      case 'apiKey':
        groupByField = 'ak.name';
        query = `
          SELECT
            ak.id as id,
            ak.name as name,
            SUM(um.count) as actions,
            SUM(um.tokens_used) as total_tokens,
            SUM(um.cost_credits) as total_cost,
            AVG(um.duration_ms) as avg_duration
          FROM usage_metrics um
          JOIN api_keys ak ON um.api_key_id = ak.id
          WHERE um.action_type = 'workflow:execute'
            ${validated.startDate ? 'AND um.timestamp >= ?' : ''}
            ${validated.endDate ? 'AND um.timestamp <= ?' : ''}
          GROUP BY ak.id, ak.name
          ORDER BY total_cost DESC
          LIMIT ?
        `;
        params.length = 0; // Reset params for usage_metrics query
        if (validated.startDate) params.push(validated.startDate);
        if (validated.endDate) params.push(validated.endDate);
        break;

      default:
        throw new Error(`Invalid groupBy: ${validated.groupBy}`);
    }

    const stmt = db.prepare(query);
    const breakdown = stmt.all(...params, validated.limit);

    return c.json(
      apiResponse({
        groupBy: validated.groupBy,
        data: breakdown,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get cost breakdown');
    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get cost breakdown'),
      500
    );
  }
});

/**
 * GET /analytics/workflows/:id/costs
 * Detailed cost analytics for a specific workflow
 */
analyticsApi.get('/workflows/:id/costs', checkPermission('analytics:read'), (c) => {
  try {
    const workflowId = c.req.param('id');
    const queryParams = c.req.query();
    const validated = WorkflowAnalyticsSchema.parse(queryParams);
    const db = serverDatabase.getDatabase();

    // Workflow summary
    const summaryStmt = db.prepare(`
      SELECT
        w.id,
        w.name,
        w.description,
        COUNT(DISTINCT we.id) as total_executions,
        COUNT(wes.id) as total_steps,
        SUM(wes.cost_credits) as total_cost,
        SUM(wes.tokens_used) as total_tokens,
        AVG(wes.cost_credits) as avg_step_cost,
        AVG(wes.duration_ms) as avg_step_duration,
        MIN(we.started_at) as first_execution,
        MAX(we.started_at) as last_execution
      FROM workflows w
      LEFT JOIN workflow_executions we ON w.id = we.workflow_id
      LEFT JOIN workflow_execution_steps wes ON we.id = wes.execution_id
      WHERE w.id = ?
        ${validated.startDate ? 'AND we.started_at >= ?' : ''}
        ${validated.endDate ? 'AND we.started_at <= ?' : ''}
      GROUP BY w.id
    `);

    const params: unknown[] = [workflowId];
    if (validated.startDate) params.push(validated.startDate);
    if (validated.endDate) params.push(validated.endDate);

    const summary = summaryStmt.get(...params) as {
      id: string;
      name: string;
      description: string;
      total_executions: number;
      total_steps: number;
      total_cost: number;
      total_tokens: number;
      avg_step_cost: number;
      avg_step_duration: number;
      first_execution: string;
      last_execution: string;
    } | undefined;

    if (!summary) {
      return c.json(apiResponse(null, false, 'Workflow not found'), 404);
    }

    // Step-level breakdown
    const stepBreakdownStmt = db.prepare(`
      SELECT
        wes.step_name,
        COUNT(*) as executions,
        SUM(wes.cost_credits) as total_cost,
        SUM(wes.tokens_used) as total_tokens,
        AVG(wes.cost_credits) as avg_cost,
        AVG(wes.duration_ms) as avg_duration,
        MIN(wes.cost_credits) as min_cost,
        MAX(wes.cost_credits) as max_cost,
        wes.model_name
      FROM workflow_execution_steps wes
      JOIN workflow_executions we ON wes.execution_id = we.id
      WHERE we.workflow_id = ?
        ${validated.startDate ? 'AND we.started_at >= ?' : ''}
        ${validated.endDate ? 'AND we.started_at <= ?' : ''}
      GROUP BY wes.step_name, wes.model_name
      ORDER BY total_cost DESC
    `);

    const stepBreakdown = stepBreakdownStmt.all(...params);

    // Model usage for this workflow
    const modelUsageStmt = db.prepare(`
      SELECT
        wes.model_name,
        COUNT(*) as uses,
        SUM(wes.cost_credits) as total_cost,
        SUM(wes.tokens_used) as total_tokens
      FROM workflow_execution_steps wes
      JOIN workflow_executions we ON wes.execution_id = we.id
      WHERE we.workflow_id = ? AND wes.model_name IS NOT NULL
        ${validated.startDate ? 'AND we.started_at >= ?' : ''}
        ${validated.endDate ? 'AND we.started_at <= ?' : ''}
      GROUP BY wes.model_name
      ORDER BY total_cost DESC
    `);

    const modelUsage = modelUsageStmt.all(...params);

    // Cost trend over time
    const trendStmt = db.prepare(`
      SELECT
        DATE(we.started_at) as date,
        COUNT(DISTINCT we.id) as executions,
        SUM(wes.cost_credits) as daily_cost,
        SUM(wes.tokens_used) as daily_tokens
      FROM workflow_executions we
      JOIN workflow_execution_steps wes ON we.id = wes.execution_id
      WHERE we.workflow_id = ?
        ${validated.startDate ? 'AND we.started_at >= ?' : ''}
        ${validated.endDate ? 'AND we.started_at <= ?' : ''}
      GROUP BY DATE(we.started_at)
      ORDER BY date DESC
      LIMIT 30
    `);

    const trend = trendStmt.all(...params);

    const response: any = {
      summary,
      stepBreakdown,
      modelUsage,
      trend,
    };

    // Include detailed step data if requested
    if (validated.includeSteps) {
      const recentExecutionsStmt = db.prepare(`
        SELECT
          we.id as execution_id,
          we.started_at,
          we.completed_at,
          we.status,
          json_group_array(
            json_object(
              'stepName', wes.step_name,
              'status', wes.status,
              'tokensUsed', wes.tokens_used,
              'costCredits', wes.cost_credits,
              'modelName', wes.model_name,
              'durationMs', wes.duration_ms
            )
          ) as steps
        FROM workflow_executions we
        LEFT JOIN workflow_execution_steps wes ON we.id = wes.execution_id
        WHERE we.workflow_id = ?
          ${validated.startDate ? 'AND we.started_at >= ?' : ''}
          ${validated.endDate ? 'AND we.started_at <= ?' : ''}
        GROUP BY we.id
        ORDER BY we.started_at DESC
        LIMIT 10
      `);

      response.recentExecutions = recentExecutionsStmt.all(...params);
    }

    return c.json(apiResponse(response));
  } catch (error) {
    logger.error({ error }, 'Failed to get workflow costs');
    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get workflow costs'),
      500
    );
  }
});

/**
 * GET /analytics/cost/comparison
 * Compare costs across different time periods
 */
analyticsApi.get('/cost/comparison', checkPermission('analytics:read'), (c) => {
  try {
    const db = serverDatabase.getDatabase();

    // Current period (last 7 days)
    const currentPeriodStmt = db.prepare(`
      SELECT
        SUM(cost_credits) as total_cost,
        SUM(tokens_used) as total_tokens,
        COUNT(DISTINCT execution_id) as executions
      FROM workflow_execution_steps
      WHERE started_at >= datetime('now', '-7 days')
    `);
    const currentPeriod = currentPeriodStmt.get() as {
      total_cost: number;
      total_tokens: number;
      executions: number;
    };

    // Previous period (7-14 days ago)
    const previousPeriodStmt = db.prepare(`
      SELECT
        SUM(cost_credits) as total_cost,
        SUM(tokens_used) as total_tokens,
        COUNT(DISTINCT execution_id) as executions
      FROM workflow_execution_steps
      WHERE started_at >= datetime('now', '-14 days')
        AND started_at < datetime('now', '-7 days')
    `);
    const previousPeriod = previousPeriodStmt.get() as {
      total_cost: number;
      total_tokens: number;
      executions: number;
    };

    // Calculate percentage changes
    const costChange =
      previousPeriod.total_cost > 0
        ? ((currentPeriod.total_cost - previousPeriod.total_cost) / previousPeriod.total_cost) * 100
        : 0;

    const tokenChange =
      previousPeriod.total_tokens > 0
        ? ((currentPeriod.total_tokens - previousPeriod.total_tokens) / previousPeriod.total_tokens) * 100
        : 0;

    const executionChange =
      previousPeriod.executions > 0
        ? ((currentPeriod.executions - previousPeriod.executions) / previousPeriod.executions) * 100
        : 0;

    // Top growing workflows by cost
    const growingWorkflowsStmt = db.prepare(`
      SELECT
        w.name,
        current.total_cost as current_cost,
        previous.total_cost as previous_cost,
        ((current.total_cost - COALESCE(previous.total_cost, 0)) / COALESCE(previous.total_cost, 1)) * 100 as growth_percent
      FROM (
        SELECT
          we.workflow_id,
          SUM(wes.cost_credits) as total_cost
        FROM workflow_execution_steps wes
        JOIN workflow_executions we ON wes.execution_id = we.id
        WHERE wes.started_at >= datetime('now', '-7 days')
        GROUP BY we.workflow_id
      ) current
      JOIN workflows w ON current.workflow_id = w.id
      LEFT JOIN (
        SELECT
          we.workflow_id,
          SUM(wes.cost_credits) as total_cost
        FROM workflow_execution_steps wes
        JOIN workflow_executions we ON wes.execution_id = we.id
        WHERE wes.started_at >= datetime('now', '-14 days')
          AND wes.started_at < datetime('now', '-7 days')
        GROUP BY we.workflow_id
      ) previous ON current.workflow_id = previous.workflow_id
      ORDER BY growth_percent DESC
      LIMIT 5
    `);

    const growingWorkflows = growingWorkflowsStmt.all();

    return c.json(
      apiResponse({
        currentPeriod: {
          ...currentPeriod,
          period: 'Last 7 days',
        },
        previousPeriod: {
          ...previousPeriod,
          period: '7-14 days ago',
        },
        changes: {
          costChange: Math.round(costChange * 100) / 100,
          tokenChange: Math.round(tokenChange * 100) / 100,
          executionChange: Math.round(executionChange * 100) / 100,
        },
        growingWorkflows,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get cost comparison');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get cost comparison'),
      500
    );
  }
});

/**
 * GET /analytics/performance
 * Performance metrics for workflows
 */
analyticsApi.get('/performance', checkPermission('analytics:read'), (c) => {
  try {
    const db = serverDatabase.getDatabase();

    // Slowest steps
    const slowestStepsStmt = db.prepare(`
      SELECT
        step_name,
        AVG(duration_ms) as avg_duration,
        MAX(duration_ms) as max_duration,
        MIN(duration_ms) as min_duration,
        COUNT(*) as executions
      FROM workflow_execution_steps
      WHERE duration_ms IS NOT NULL
      GROUP BY step_name
      ORDER BY avg_duration DESC
      LIMIT 10
    `);
    const slowestSteps = slowestStepsStmt.all();

    // Workflows by success rate
    const successRateStmt = db.prepare(`
      SELECT
        w.name as workflow_name,
        COUNT(*) as total_executions,
        SUM(CASE WHEN we.status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN we.status = 'failed' THEN 1 ELSE 0 END) as failed,
        (SUM(CASE WHEN we.status = 'completed' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as success_rate
      FROM workflow_executions we
      JOIN workflows w ON we.workflow_id = w.id
      GROUP BY w.id, w.name
      HAVING COUNT(*) >= 5
      ORDER BY success_rate ASC
      LIMIT 10
    `);
    const successRates = successRateStmt.all();

    // Cost efficiency (cost per successful execution)
    const efficiencyStmt = db.prepare(`
      SELECT
        w.name as workflow_name,
        COUNT(DISTINCT we.id) as executions,
        SUM(CASE WHEN we.status = 'completed' THEN 1 ELSE 0 END) as successful_executions,
        SUM(wes.cost_credits) as total_cost,
        (SUM(wes.cost_credits) / NULLIF(SUM(CASE WHEN we.status = 'completed' THEN 1 ELSE 0 END), 0)) as cost_per_success
      FROM workflow_execution_steps wes
      JOIN workflow_executions we ON wes.execution_id = we.id
      JOIN workflows w ON we.workflow_id = w.id
      GROUP BY w.id, w.name
      HAVING successful_executions > 0
      ORDER BY cost_per_success DESC
      LIMIT 10
    `);
    const efficiency = efficiencyStmt.all();

    return c.json(
      apiResponse({
        slowestSteps,
        successRates,
        efficiency,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get performance metrics');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get performance metrics'),
      500
    );
  }
});
