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
import { KeyGuardian } from '../security/keyGuardian.js';
import { BudgetEnforcer } from '../budgets/budgetEnforcer.js';

const logger = createChildLogger({ module: 'workflow-engine' });

/**
 * Step execution result for batch processing
 */
interface StepResult {
  stepId: string;
  stepIndex: number;
  stepName: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  retryCount: number;
  costData?: StepCostData;
  startedAt: string;
  completedAt?: string;
}

/**
 * Workflow orchestration engine
 * Manages workflow execution, state persistence, and error handling
 */
export class WorkflowEngine {
  private db: Database.Database;
  private executor: WorkflowExecutor;
  private keyGuardian: KeyGuardian;
  private budgetEnforcer: BudgetEnforcer;

  constructor(db: Database.Database) {
    this.db = db;
    this.executor = new WorkflowExecutor();
    this.keyGuardian = new KeyGuardian(db);
    this.budgetEnforcer = new BudgetEnforcer(db);
  }

  /**
   * Batch insert step records in a single transaction
   * Reduces N inserts to 1 transaction
   *
   * For 100+ step workflows, this reduces database I/O from N separate
   * INSERT operations to a single atomic transaction.
   */
  private batchCreateSteps(
    executionId: string,
    steps: Array<{ stepIndex: number; stepName: string; status: StepStatus }>
  ): string[] {
    const stepIds: string[] = [];

    const transaction = this.db.transaction(() => {
      const insertStmt = this.db.prepare(`
        INSERT INTO workflow_execution_steps (id, execution_id, step_index, step_name, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const step of steps) {
        const stepId = randomBytes(16).toString('hex');
        const startedAt = step.status === 'running' ? new Date().toISOString() : null;
        insertStmt.run(stepId, executionId, step.stepIndex, step.stepName, step.status, startedAt);
        stepIds.push(stepId);
      }
    });

    transaction();
    return stepIds;
  }

  /**
   * Batch update step records in a single transaction
   * Reduces N updates to 1 transaction
   *
   * For 100+ step workflows, this reduces database I/O from N separate
   * UPDATE operations to a single atomic transaction.
   */
  private batchUpdateSteps(results: StepResult[]): void {
    if (results.length === 0) return;

    const transaction = this.db.transaction(() => {
      const updateStmt = this.db.prepare(`
        UPDATE workflow_execution_steps
        SET status = ?, output_json = ?, error = ?, retry_count = ?, completed_at = ?,
            tokens_used = ?, cost_credits = ?, model_name = ?, duration_ms = ?
        WHERE id = ?
      `);

      for (const result of results) {
        updateStmt.run(
          result.status,
          result.output !== undefined ? JSON.stringify(result.output) : null,
          result.error || null,
          result.retryCount,
          result.completedAt || null,
          result.costData?.tokensUsed || 0,
          result.costData?.costCredits || 0,
          result.costData?.modelName || null,
          result.costData?.durationMs || null,
          result.stepId
        );
      }
    });

    transaction();
  }

  /**
   * Create a new workflow
   */
  createWorkflow(definition: WorkflowDefinition): Workflow {
    // Scan for API key exposure before creating
    const scanResult = this.keyGuardian.scanWorkflowDefinition(definition);

    if (scanResult.keysDetected.length > 0) {
      // Record detections
      for (const detected of scanResult.keysDetected) {
        this.keyGuardian.recordDetection(
          'workflow_definition',
          'workflow',
          definition.name,
          detected
        );
      }

      // Block workflow creation
      const errorMessage = `API key exposure detected in workflow definition. Found ${scanResult.keysDetected.length} key(s): ${scanResult.keysDetected.map(k => `${k.provider} at ${k.location}`).join(', ')}`;
      logger.error({ workflowName: definition.name, keysDetected: scanResult.keysDetected }, 'Workflow creation blocked due to API key exposure');
      throw new Error(errorMessage);
    }

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
   * Execute a workflow with optimized batch database operations
   *
   * Performance optimizations:
   * 1. Pre-allocate all step records in a single transaction
   * 2. Collect step results in memory during execution
   * 3. Batch update all step records in a single transaction at the end
   *
   * This reduces database writes from 2N (N inserts + N updates) to 2 transactions
   * for workflows with 100+ steps.
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

    // Check budget before execution
    const budgetCheck = this.budgetEnforcer.canExecuteWorkflow(workflowId);
    if (!budgetCheck.allowed) {
      logger.warn(
        { workflowId, reason: budgetCheck.reason },
        'Workflow execution blocked by budget'
      );
      throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
    }

    // Create execution record
    const executionId = randomBytes(16).toString('hex');
    const startedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO workflow_executions (id, workflow_id, status, input_json, started_at, triggered_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(executionId, workflowId, 'running', JSON.stringify(input || {}), startedAt, triggeredBy || null);

    const stepCount = workflow.definition.steps.length;
    logger.info(
      { executionId, workflowId, workflowName: workflow.name, stepCount },
      'Starting workflow execution'
    );

    // Create execution context
    const context = new WorkflowContext(input || {});

    // OPTIMIZATION: Pre-allocate all step records in a single transaction
    const stepsToCreate = workflow.definition.steps.map((step, index) => ({
      stepIndex: index,
      stepName: step.name,
      status: 'pending' as StepStatus,
    }));

    const stepIds = this.batchCreateSteps(executionId, stepsToCreate);
    logger.debug({ executionId, stepCount }, 'Batch created step records');

    // Track step results for batch update
    const stepResults: StepResult[] = [];
    const stepCosts: StepCostData[] = [];

    try {
      // Execute steps sequentially
      const output: Record<string, unknown> = {};

      for (let i = 0; i < workflow.definition.steps.length; i++) {
        const step = workflow.definition.steps[i];
        const stepId = stepIds[i];
        const stepStartedAt = new Date().toISOString();

        // Check if step has a condition
        if (step.condition && !context.evaluateCondition(step.condition)) {
          logger.info({ executionId, stepName: step.name }, 'Skipping step due to condition');
          stepResults.push({
            stepId,
            stepIndex: i,
            stepName: step.name,
            status: 'skipped',
            retryCount: 0,
            startedAt: stepStartedAt,
            completedAt: stepStartedAt,
          });
          continue;
        }

        try {
          // Execute step with retry if configured
          const result = await this.executor.executeWithRetry(step, context, step.retryConfig);
          const stepCompletedAt = new Date().toISOString();

          if (result.success) {
            // Track cost data if available
            if (result.costData) {
              stepCosts.push(result.costData);
            }

            // Store result for batch update
            stepResults.push({
              stepId,
              stepIndex: i,
              stepName: step.name,
              status: 'completed',
              output: result.output,
              retryCount: result.retries,
              costData: result.costData,
              startedAt: stepStartedAt,
              completedAt: stepCompletedAt,
            });

            // Store output in context
            context.setStepOutput(step.name, result.output);
            output[step.name] = result.output;

            logger.info({ executionId, stepName: step.name, retries: result.retries }, 'Step completed');
          } else {
            // Store failure result for batch update
            stepResults.push({
              stepId,
              stepIndex: i,
              stepName: step.name,
              status: 'failed',
              error: result.error,
              retryCount: result.retries,
              costData: result.costData,
              startedAt: stepStartedAt,
              completedAt: stepCompletedAt,
            });

            context.setStepError(step.name, result.error || 'Unknown error');

            const errorStrategy = step.onError || 'stop';

            if (errorStrategy === 'stop') {
              // Batch update all results collected so far before throwing
              this.batchUpdateSteps(stepResults);
              throw new Error(`Step "${step.name}" failed: ${result.error}`);
            } else if (errorStrategy === 'continue') {
              logger.warn({ executionId, stepName: step.name, error: result.error }, 'Step failed, continuing');
              output[step.name] = { error: result.error };
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Check if this error was already recorded (from errorStrategy === 'stop')
          if (!stepResults.find(r => r.stepId === stepId)) {
            stepResults.push({
              stepId,
              stepIndex: i,
              stepName: step.name,
              status: 'failed',
              error: errorMessage,
              retryCount: 0,
              startedAt: stepStartedAt,
              completedAt: new Date().toISOString(),
            });
            this.batchUpdateSteps(stepResults);
          }
          throw error;
        }
      }

      // OPTIMIZATION: Batch update all step records in a single transaction
      this.batchUpdateSteps(stepResults);
      logger.debug({ executionId, resultCount: stepResults.length }, 'Batch updated step records');

      // Aggregate costs from all steps
      const aggregatedCosts = stepCostTracker.aggregateCosts(stepCosts);

      // Record workflow cost against budgets
      await this.budgetEnforcer.recordWorkflowCost(executionId, aggregatedCosts.totalCost);

      // Mark execution as completed
      await this.completeExecution(executionId, 'completed', output);

      logger.info(
        {
          executionId,
          workflowId,
          stepCount,
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
  ): { executions: (WorkflowExecution & { totalCostCredits?: number; totalTokensUsed?: number })[]; total: number } {
    const { limit = 50, offset = 0, status } = options;

    let sql = `
      SELECT
        we.*,
        COALESCE(SUM(wes.cost_credits), 0) as total_cost_credits,
        COALESCE(SUM(wes.tokens_used), 0) as total_tokens_used
      FROM workflow_executions we
      LEFT JOIN workflow_execution_steps wes ON we.id = wes.execution_id
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (workflowId) {
      conditions.push('we.workflow_id = ?');
      params.push(workflowId);
    }

    if (status) {
      conditions.push('we.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY we.id ORDER BY we.started_at DESC LIMIT ? OFFSET ?';
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
      total_cost_credits: number;
      total_tokens_used: number;
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
      totalCostCredits: row.total_cost_credits,
      totalTokensUsed: row.total_tokens_used,
    }));

    let countSql = 'SELECT COUNT(*) as count FROM workflow_executions';
    const countParams: unknown[] = [];

    if (workflowId || status) {
      countSql += ' WHERE ';
      const countConditions: string[] = [];
      if (workflowId) {
        countConditions.push('workflow_id = ?');
        countParams.push(workflowId);
      }
      if (status) {
        countConditions.push('status = ?');
        countParams.push(status);
      }
      countSql += countConditions.join(' AND ');
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
