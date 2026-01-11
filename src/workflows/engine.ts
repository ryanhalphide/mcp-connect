import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowExecutionStep,
  WorkflowStatus,
  StepStatus,
  WorkflowStep,
} from './types.js';
import { WorkflowContext } from './context.js';
import { WorkflowExecutor } from './executor.js';
import { createChildLogger } from '../observability/logger.js';
import { stepCostTracker, type StepCostData } from './stepCostTracker.js';

const logger = createChildLogger({ module: 'workflow-engine' });

/**
 * Workflow orchestration engine
 * Manages workflow execution, state persistence, and error handling
 */
export class WorkflowEngine {
  private db: Database.Database;
  private executor: WorkflowExecutor;

  constructor(db: Database.Database) {
    this.db = db;
    this.executor = new WorkflowExecutor();
  }

  /**
   * Create a new workflow
   */
  createWorkflow(definition: WorkflowDefinition): Workflow {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO workflows (id, name, description, definition_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      definition.name,
      definition.description || '',
      JSON.stringify(definition),
      now,
      now
    );

    logger.info({ workflowId: id, name: definition.name }, 'Workflow created');

    return {
      id,
      name: definition.name,
      description: definition.description || '',
      definition,
      enabled: true,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(id: string): Workflow | null {
    const stmt = this.db.prepare(`
      SELECT id, name, description, definition_json, enabled, created_at, updated_at
      FROM workflows
      WHERE id = ?
    `);

    const row = stmt.get(id) as
      | {
          id: string;
          name: string;
          description: string;
          definition_json: string;
          enabled: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      definition: JSON.parse(row.definition_json),
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    input?: Record<string, unknown>,
    triggeredBy?: string
  ): Promise<WorkflowExecution> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (!workflow.enabled) {
      throw new Error(`Workflow is disabled: ${workflow.name}`);
    }

    // Create execution record
    const executionId = randomBytes(16).toString('hex');
    const startedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO workflow_executions (id, workflow_id, status, input_json, started_at, triggered_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(executionId, workflowId, 'running', JSON.stringify(input || {}), startedAt, triggeredBy || null);

    logger.info({ executionId, workflowId, workflowName: workflow.name }, 'Starting workflow execution');

    // Create execution context
    const context = new WorkflowContext(input || {});

    // Track costs across all steps
    const stepCosts: StepCostData[] = [];

    try {
      // Execute steps sequentially
      const output: Record<string, unknown> = {};

      for (let i = 0; i < workflow.definition.steps.length; i++) {
        const step = workflow.definition.steps[i];

        // Check if step has a condition
        if (step.condition && !context.evaluateCondition(step.condition)) {
          logger.info({ executionId, stepName: step.name }, 'Skipping step due to condition');
          await this.createExecutionStep(executionId, i, step.name, 'skipped');
          continue;
        }

        // Create step record
        const stepId = await this.createExecutionStep(executionId, i, step.name, 'running');

        try {
          // Execute step with retry if configured
          const result = await this.executor.executeWithRetry(step, context, step.retryConfig);

          if (result.success) {
            // Track cost data if available
            if (result.costData) {
              stepCosts.push(result.costData);
            }

            // Update step as completed
            await this.updateExecutionStep(stepId, 'completed', result.output, undefined, result.retries, result.costData);

            // Store output in context
            context.setStepOutput(step.name, result.output);
            output[step.name] = result.output;

            logger.info({ executionId, stepName: step.name, retries: result.retries }, 'Step completed');
          } else {
            // Handle step failure based on error strategy
            await this.updateExecutionStep(stepId, 'failed', undefined, result.error, result.retries, result.costData);
            context.setStepError(step.name, result.error || 'Unknown error');

            const errorStrategy = step.onError || 'stop';

            if (errorStrategy === 'stop') {
              throw new Error(`Step "${step.name}" failed: ${result.error}`);
            } else if (errorStrategy === 'continue') {
              logger.warn({ executionId, stepName: step.name, error: result.error }, 'Step failed, continuing');
              output[step.name] = { error: result.error };
            }
            // 'retry' is handled by executeWithRetry
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await this.updateExecutionStep(stepId, 'failed', undefined, errorMessage, 0);
          throw error;
        }
      }

      // Aggregate costs from all steps
      const aggregatedCosts = stepCostTracker.aggregateCosts(stepCosts);

      // Mark execution as completed
      await this.completeExecution(executionId, 'completed', output);

      logger.info(
        {
          executionId,
          workflowId,
          totalCost: aggregatedCosts.totalCost,
          totalTokens: aggregatedCosts.totalTokens
        },
        'Workflow execution completed successfully'
      );

      return this.getExecution(executionId)!;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.completeExecution(executionId, 'failed', undefined, errorMessage);

      logger.error({ executionId, workflowId, error: errorMessage }, 'Workflow execution failed');

      return this.getExecution(executionId)!;
    }
  }

  /**
   * Create a workflow execution step record
   */
  private async createExecutionStep(
    executionId: string,
    stepIndex: number,
    stepName: string,
    status: StepStatus
  ): Promise<string> {
    const stepId = randomBytes(16).toString('hex');
    const startedAt = status === 'running' ? new Date().toISOString() : null;

    const stmt = this.db.prepare(`
      INSERT INTO workflow_execution_steps (id, execution_id, step_index, step_name, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(stepId, executionId, stepIndex, stepName, status, startedAt);

    return stepId;
  }

  /**
   * Update a workflow execution step
   */
  private async updateExecutionStep(
    stepId: string,
    status: StepStatus,
    output?: unknown,
    error?: string,
    retryCount?: number,
    costData?: StepCostData
  ): Promise<void> {
    const completedAt = status === 'completed' || status === 'failed' ? new Date().toISOString() : null;

    const stmt = this.db.prepare(`
      UPDATE workflow_execution_steps
      SET status = ?, output_json = ?, error = ?, retry_count = ?, completed_at = ?,
          tokens_used = ?, cost_credits = ?, model_name = ?, duration_ms = ?
      WHERE id = ?
    `);

    stmt.run(
      status,
      output !== undefined ? JSON.stringify(output) : null,
      error || null,
      retryCount || 0,
      completedAt,
      costData?.tokensUsed || 0,
      costData?.costCredits || 0,
      costData?.modelName || null,
      costData?.durationMs || null,
      stepId
    );
  }

  /**
   * Complete a workflow execution
   */
  private async completeExecution(
    executionId: string,
    status: WorkflowStatus,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    const completedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE workflow_executions
      SET status = ?, output_json = ?, error = ?, completed_at = ?
      WHERE id = ?
    `);

    stmt.run(
      status,
      output ? JSON.stringify(output) : null,
      error || null,
      completedAt,
      executionId
    );
  }

  /**
   * Get a workflow execution by ID
   */
  getExecution(id: string): WorkflowExecution | null {
    const stmt = this.db.prepare(`
      SELECT id, workflow_id, status, input_json, output_json, error, started_at, completed_at, triggered_by
      FROM workflow_executions
      WHERE id = ?
    `);

    const row = stmt.get(id) as
      | {
          id: string;
          workflow_id: string;
          status: WorkflowStatus;
          input_json: string | null;
          output_json: string | null;
          error: string | null;
          started_at: string;
          completed_at: string | null;
          triggered_by: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      input: row.input_json ? JSON.parse(row.input_json) : undefined,
      output: row.output_json ? JSON.parse(row.output_json) : undefined,
      error: row.error || undefined,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      triggeredBy: row.triggered_by || undefined,
    };
  }

  /**
   * Get execution steps for an execution
   */
  getExecutionSteps(executionId: string): WorkflowExecutionStep[] {
    const stmt = this.db.prepare(`
      SELECT id, execution_id, step_index, step_name, status, input_json, output_json, error, retry_count, started_at, completed_at
      FROM workflow_execution_steps
      WHERE execution_id = ?
      ORDER BY step_index ASC
    `);

    const rows = stmt.all(executionId) as Array<{
      id: string;
      execution_id: string;
      step_index: number;
      step_name: string;
      status: StepStatus;
      input_json: string | null;
      output_json: string | null;
      error: string | null;
      retry_count: number;
      started_at: string | null;
      completed_at: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      stepIndex: row.step_index,
      stepName: row.step_name,
      status: row.status,
      input: row.input_json ? JSON.parse(row.input_json) : undefined,
      output: row.output_json ? JSON.parse(row.output_json) : undefined,
      error: row.error || undefined,
      retryCount: row.retry_count,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }));
  }

  /**
   * List all workflows
   */
  listWorkflows(options: { limit?: number; offset?: number; enabled?: boolean } = {}): {
    workflows: Workflow[];
    total: number;
  } {
    const { limit = 50, offset = 0, enabled } = options;

    let sql = 'SELECT * FROM workflows';
    const params: unknown[] = [];

    if (enabled !== undefined) {
      sql += ' WHERE enabled = ?';
      params.push(enabled ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: string;
      name: string;
      description: string;
      definition_json: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    }>;

    const workflows = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      definition: JSON.parse(row.definition_json),
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    const countStmt = this.db.prepare(
      enabled !== undefined
        ? 'SELECT COUNT(*) as count FROM workflows WHERE enabled = ?'
        : 'SELECT COUNT(*) as count FROM workflows'
    );

    const total = (
      enabled !== undefined ? countStmt.get(enabled ? 1 : 0) : countStmt.get()
    ) as { count: number };

    return { workflows, total: total.count };
  }

  /**
   * List executions for a workflow
   */
  listExecutions(
    workflowId?: string,
    options: { limit?: number; offset?: number; status?: WorkflowStatus } = {}
  ): { executions: WorkflowExecution[]; total: number } {
    const { limit = 50, offset = 0, status } = options;

    let sql = 'SELECT * FROM workflow_executions';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (workflowId) {
      conditions.push('workflow_id = ?');
      params.push(workflowId);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: string;
      workflow_id: string;
      status: WorkflowStatus;
      input_json: string | null;
      output_json: string | null;
      error: string | null;
      started_at: string;
      completed_at: string | null;
      triggered_by: string | null;
    }>;

    const executions = rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      input: row.input_json ? JSON.parse(row.input_json) : undefined,
      output: row.output_json ? JSON.parse(row.output_json) : undefined,
      error: row.error || undefined,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      triggeredBy: row.triggered_by || undefined,
    }));

    let countSql = 'SELECT COUNT(*) as count FROM workflow_executions';
    const countParams: unknown[] = [];

    if (conditions.length > 0) {
      countSql += ' WHERE ' + conditions.join(' AND ');
      countParams.push(...params.slice(0, conditions.length));
    }

    const countStmt = this.db.prepare(countSql);
    const total = countStmt.get(...countParams) as { count: number };

    return { executions, total: total.count };
  }

  /**
   * Delete a workflow
   */
  deleteWorkflow(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM workflows WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Update a workflow
   */
  updateWorkflow(id: string, definition: WorkflowDefinition): boolean {
    const stmt = this.db.prepare(`
      UPDATE workflows
      SET name = ?, description = ?, definition_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(
      definition.name,
      definition.description || '',
      JSON.stringify(definition),
      id
    );

    return result.changes > 0;
  }
}
