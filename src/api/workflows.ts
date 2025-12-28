import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { WorkflowEngine } from '../workflows/engine.js';
import type { WorkflowDefinition, WorkflowStatus } from '../workflows/types.js';
import { serverDatabase } from '../storage/db.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'workflows-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
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
workflowsApi.get('/', (c) => {
  try {
    const queryParams = c.req.query();
    const validated = ListQuerySchema.parse(queryParams);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const result = engine.listWorkflows({
      limit: validated.limit,
      offset: validated.offset,
      enabled: validated.enabled,
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
workflowsApi.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = WorkflowDefinitionSchema.parse(body);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const workflow = engine.createWorkflow(validated as WorkflowDefinition);

    logger.info({ workflowId: workflow.id, name: workflow.name }, 'Workflow created via API');

    return c.json(apiResponse(workflow), 201);
  } catch (error) {
    logger.error({ error }, 'Failed to create workflow');
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
workflowsApi.get('/:id', (c) => {
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
workflowsApi.put('/:id', async (c) => {
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

    return c.json(apiResponse(workflow));
  } catch (error) {
    logger.error({ error }, 'Failed to update workflow');
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
workflowsApi.delete('/:id', (c) => {
  try {
    const id = c.req.param('id');
    const engine = new WorkflowEngine(serverDatabase.getDatabase());
    const deleted = engine.deleteWorkflow(id);

    if (!deleted) {
      return c.json(apiResponse(null, false, 'Workflow not found'), 404);
    }

    logger.info({ workflowId: id }, 'Workflow deleted via API');

    return c.json(apiResponse({ message: 'Workflow deleted successfully' }));
  } catch (error) {
    logger.error({ error }, 'Failed to delete workflow');
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
workflowsApi.post('/:id/execute', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const validated = ExecuteWorkflowSchema.parse(body);

    const engine = new WorkflowEngine(serverDatabase.getDatabase());

    logger.info({ workflowId: id, triggeredBy: validated.triggeredBy }, 'Starting workflow execution via API');

    // Execute workflow asynchronously (don't await)
    const execution = await engine.executeWorkflow(id, validated.input, validated.triggeredBy);

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
workflowsApi.get('/:id/executions', (c) => {
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
workflowsApi.get('/executions/:id', (c) => {
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
