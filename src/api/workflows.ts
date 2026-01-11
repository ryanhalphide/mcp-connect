import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { WorkflowEngine } from '../workflows/engine.js';
import type { WorkflowDefinition, WorkflowStatus } from '../workflows/types.js';
import { serverDatabase } from '../storage/db.js';
import { createChildLogger } from '../observability/logger.js';
import { checkPermission } from '../rbac/enforcer.js';
import { getAuditLogger } from '../observability/auditLog.js';
import { UsageTracker } from '../observability/usageTracker.js';

const logger = createChildLogger({ module: 'workflows-api' });

// Initialize usage tracker
const db = serverDatabase.getDatabase();
const usageTracker = new UsageTracker(db);

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Helper to extract API key and tenant ID from context
function getContextInfo(c: any): { apiKeyId: string | null; tenantId: string | null } {
  return {
    apiKeyId: c.get('apiKeyId') || null,
    tenantId: c.get('tenantId') || null,
  };
}

export const workflowsApi = new Hono();

// Schema for workflow creation/update
const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1, 'Workflow name is required'),
  description: z.string().optional(),
  steps: z.array(z.any()).min(1, 'At least one step is required'),
  errorHandling: z
    .object({
      strategy: z.enum(['rollback', 'continue']),
      onError: z.string().optional(),
    })
    .optional(),
  timeout: z.number().positive().optional(),
});

// Schema for workflow execution
const ExecuteWorkflowSchema = z.object({
  input: z.record(z.unknown()).optional(),
  triggeredBy: z.string().optional(),
});

// Schema for list query parameters
const ListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  enabled: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
});

// Schema for execution list query
const ExecutionListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
});

/**
 * GET /workflows
 * List all workflows
 */
workflowsApi.get('/', checkPermission('workflows:read'), (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);

  try {
    const queryParams = c.req.query();
    const validated = ListQuerySchema.parse(queryParams);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const result = engine.listWorkflows({
      limit: validated.limit,
      offset: validated.offset,
      enabled: validated.enabled,
    });

    // Audit log successful workflow list
    getAuditLogger().log({
      action: 'workflow.list',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: null,
      details: {
        tenantId,
        count: result.total,
        limit: validated.limit,
        offset: validated.offset,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(
      apiResponse({
        workflows: result.workflows,
        total: result.total,
        limit: validated.limit,
        offset: validated.offset,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to list workflows');

    // Audit log failed workflow list
    getAuditLogger().log({
      action: 'workflow.list',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: null,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to list workflows'),
      500
    );
  }
});

/**
 * POST /workflows
 * Create a new workflow
 */
workflowsApi.post('/', checkPermission('workflows:write'), async (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);

  try {
    const body = await c.req.json();
    const validated = WorkflowDefinitionSchema.parse(body);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const workflow = engine.createWorkflow(validated as WorkflowDefinition);

    logger.info({ workflowId: workflow.id, name: workflow.name }, 'Workflow created via API');

    // Audit log workflow creation
    getAuditLogger().log({
      action: 'workflow.create',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: workflow.id,
      details: {
        tenantId,
        name: workflow.name,
        stepCount: workflow.definition.steps.length,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(apiResponse(workflow), 201);
  } catch (error) {
    logger.error({ error }, 'Failed to create workflow');

    // Audit log failed workflow creation
    getAuditLogger().log({
      action: 'workflow.create',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: null,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to create workflow'),
      500
    );
  }
});

/**
 * GET /workflows/:id
 * Get a specific workflow
 */
workflowsApi.get('/:id', checkPermission('workflows:read'), (c) => {
  try {
    const id = c.req.param('id');
    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const workflow = engine.getWorkflow(id);

    if (!workflow) {
      return c.json(apiResponse(null, false, 'Workflow not found'), 404);
    }

    return c.json(apiResponse(workflow));
  } catch (error) {
    logger.error({ error }, 'Failed to get workflow');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get workflow'),
      500
    );
  }
});

/**
 * PUT /workflows/:id
 * Update a workflow
 */
workflowsApi.put('/:id', checkPermission('workflows:write'), async (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);

  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const validated = WorkflowDefinitionSchema.parse(body);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const updated = engine.updateWorkflow(id, validated as WorkflowDefinition);

    if (!updated) {
      return c.json(apiResponse(null, false, 'Workflow not found'), 404);
    }

    const workflow = engine.getWorkflow(id);
    logger.info({ workflowId: id, name: workflow?.name }, 'Workflow updated via API');

    // Audit log workflow update
    getAuditLogger().log({
      action: 'workflow.update',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: id,
      details: {
        tenantId,
        name: workflow?.name,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(apiResponse(workflow));
  } catch (error) {
    logger.error({ error }, 'Failed to update workflow');

    // Audit log failed workflow update
    getAuditLogger().log({
      action: 'workflow.update',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: c.req.param('id'),
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to update workflow'),
      500
    );
  }
});

/**
 * DELETE /workflows/:id
 * Delete a workflow
 */
workflowsApi.delete('/:id', checkPermission('workflows:delete'), (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);
  const id = c.req.param('id');

  try {
    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const deleted = engine.deleteWorkflow(id);

    if (!deleted) {
      return c.json(apiResponse(null, false, 'Workflow not found'), 404);
    }

    logger.info({ workflowId: id }, 'Workflow deleted via API');

    // Audit log workflow deletion
    getAuditLogger().log({
      action: 'workflow.delete',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: id,
      details: {
        tenantId,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(apiResponse({ message: 'Workflow deleted successfully' }));
  } catch (error) {
    logger.error({ error }, 'Failed to delete workflow');

    // Audit log failed workflow deletion
    getAuditLogger().log({
      action: 'workflow.delete',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: id,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to delete workflow'),
      500
    );
  }
});

/**
 * POST /workflows/:id/execute
 * Execute a workflow
 */
workflowsApi.post('/:id/execute', checkPermission('workflows:execute'), async (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);
  const id = c.req.param('id');

  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = ExecuteWorkflowSchema.parse(body);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());

    logger.info({ workflowId: id, triggeredBy: validated.triggeredBy }, 'Starting workflow execution via API');

    // Execute workflow asynchronously (don't await)
    const execution = await engine.executeWorkflow(id, validated.input, validated.triggeredBy);

    const durationMs = Date.now() - startTime;

    // Get step costs from database
    const stepCostStmt = db.prepare(`
      SELECT SUM(tokens_used) as total_tokens, SUM(cost_credits) as total_cost
      FROM workflow_execution_steps
      WHERE execution_id = ?
    `);
    const stepCosts = stepCostStmt.get(execution.id) as {
      total_tokens: number | null;
      total_cost: number | null;
    };

    const totalTokens = stepCosts.total_tokens || 0;
    const totalCost = stepCosts.total_cost || 0;

    // Audit log workflow execution
    getAuditLogger().log({
      action: 'workflow.execute',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: id,
      details: {
        tenantId,
        executionId: execution.id,
        triggeredBy: validated.triggeredBy,
        status: execution.status,
        hasInput: !!validated.input,
        totalTokens,
        totalCost,
      },
      ipAddress: null,
      userAgent: null,
      durationMs,
      success: execution.status !== 'failed',
    });

    // Track usage and cost with actual step costs
    usageTracker.track('workflow:execute', {
      apiKeyId: apiKeyId || undefined,
      tenantId: tenantId || undefined,
      serverId: undefined, // Workflows can span multiple servers
      durationMs,
      tokensUsed: totalTokens,
      costCredits: totalCost,
      metadata: {
        workflowId: id,
        executionId: execution.id,
        status: execution.status,
      },
    });

    return c.json(
      apiResponse({
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        startedAt: execution.startedAt,
      }),
      202 // Accepted
    );
  } catch (error) {
    logger.error({ error }, 'Failed to execute workflow');

    // Audit log failed workflow execution
    getAuditLogger().log({
      action: 'workflow.execute',
      apiKeyId,
      resourceType: 'workflow',
      resourceId: id,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to execute workflow'),
      500
    );
  }
});

/**
 * GET /workflows/:id/executions
 * List executions for a workflow
 */
workflowsApi.get('/:id/executions', checkPermission('workflows:read'), (c) => {
  try {
    const id = c.req.param('id');
    const queryParams = c.req.query();
    const validated = ExecutionListQuerySchema.parse(queryParams);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const result = engine.listExecutions(id, {
      limit: validated.limit,
      offset: validated.offset,
      status: validated.status as WorkflowStatus | undefined,
    });

    return c.json(
      apiResponse({
        executions: result.executions,
        total: result.total,
        limit: validated.limit,
        offset: validated.offset,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to list executions');
    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to list executions'),
      500
    );
  }
});

/**
 * GET /executions/:id
 * Get execution details including steps
 */
workflowsApi.get('/executions/:id', checkPermission('workflows:read'), (c) => {
  try {
    const id = c.req.param('id');
    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const execution = engine.getExecution(id);

    if (!execution) {
      return c.json(apiResponse(null, false, 'Execution not found'), 404);
    }

    const steps = engine.getExecutionSteps(id);

    return c.json(
      apiResponse({
        ...execution,
        steps,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get execution');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get execution'),
      500
    );
  }
});

/**
 * GET /executions
 * List all executions across all workflows
 */
workflowsApi.get('/executions', (c) => {
  try {
    const queryParams = c.req.query();
    const validated = ExecutionListQuerySchema.parse(queryParams);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const result = engine.listExecutions(undefined, {
      limit: validated.limit,
      offset: validated.offset,
      status: validated.status as WorkflowStatus | undefined,
    });

    return c.json(
      apiResponse({
        executions: result.executions,
        total: result.total,
        limit: validated.limit,
        offset: validated.offset,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to list executions');
    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to list executions'),
      500
    );
  }
});
