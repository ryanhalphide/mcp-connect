/**
 * Budget Enforcer
 * Enforces budget limits on workflow execution
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../observability/logger.js';
import { BudgetManager } from './budgetManager.js';
import { appEvents } from '../core/events.js';

const logger = createChildLogger({ module: 'budget-enforcer' });

export interface WorkflowBudgetCheck {
  allowed: boolean;
  reason?: string;
  budgetId?: string;
  currentSpend: number;
  budgetLimit: number;
  percentageUsed: number;
}

export interface BudgetViolation {
  id: string;
  budgetId: string;
  workflowExecutionId: string | null;
  exceededByCredits: number;
  actionTaken: 'alert_only' | 'workflow_paused' | 'execution_blocked';
  occurredAt: Date;
}

export class BudgetEnforcer {
  private db: Database.Database;
  private budgetManager: BudgetManager;

  constructor(db: Database.Database) {
    this.db = db;
    this.budgetManager = new BudgetManager(db);
  }

  /**
   * Check if a workflow can be executed based on budget constraints
   */
  canExecuteWorkflow(workflowId: string): WorkflowBudgetCheck {
    // Get workflow details
    const workflow = this.getWorkflowDetails(workflowId);
    if (!workflow) {
      return {
        allowed: false,
        reason: 'Workflow not found',
        currentSpend: 0,
        budgetLimit: 0,
        percentageUsed: 0,
      };
    }

    // Check workflow-specific budget
    const workflowCheck = this.budgetManager.checkBudget('workflow', workflowId);
    if (!workflowCheck.allowed) {
      return {
        allowed: false,
        reason: workflowCheck.reason,
        budgetId: workflowCheck.budgetId,
        currentSpend: workflowCheck.currentSpend,
        budgetLimit: workflowCheck.budgetCredits,
        percentageUsed: workflowCheck.percentageUsed,
      };
    }

    // Check tenant budget if workflow has tenant context
    // (For now, this is simplified - in production you'd get tenant from API key context)

    // Check global budget
    const globalCheck = this.budgetManager.checkBudget('global');
    if (!globalCheck.allowed) {
      return {
        allowed: false,
        reason: globalCheck.reason,
        budgetId: globalCheck.budgetId,
        currentSpend: globalCheck.currentSpend,
        budgetLimit: globalCheck.budgetCredits,
        percentageUsed: globalCheck.percentageUsed,
      };
    }

    // All checks passed
    return {
      allowed: true,
      budgetId: workflowCheck.budgetId || globalCheck.budgetId,
      currentSpend: workflowCheck.currentSpend || globalCheck.currentSpend,
      budgetLimit: workflowCheck.budgetCredits || globalCheck.budgetCredits,
      percentageUsed: workflowCheck.percentageUsed || globalCheck.percentageUsed,
    };
  }

  /**
   * Record workflow execution cost and check for threshold violations
   */
  async recordWorkflowCost(executionId: string, cost: number): Promise<void> {
    // Get execution details
    const execution = this.getExecutionDetails(executionId);
    if (!execution) {
      logger.warn({ executionId }, 'Execution not found for cost recording');
      return;
    }

    const { workflowId } = execution;

    // Record spend against applicable budgets
    this.budgetManager.recordSpend('workflow', workflowId, cost);
    this.budgetManager.recordSpend('global', undefined, cost);

    // Check thresholds for all applicable budgets
    await this.checkThresholds('workflow', workflowId);
    await this.checkThresholds('global', undefined);

    logger.info(
      { executionId, workflowId, cost },
      'Recorded workflow cost'
    );
  }

  /**
   * Check budget thresholds and trigger alerts
   */
  async checkThresholds(scope: 'workflow' | 'global', scopeId?: string): Promise<void> {
    const budgets = this.budgetManager.listBudgets({
      scope,
      scopeId,
      enabled: true,
      limit: 10,
    });

    for (const budget of budgets.budgets) {
      const status = this.budgetManager.getBudgetStatus(budget.id);
      if (!status) continue;

      // Get alerts for this budget
      const alerts = this.getBudgetAlerts(budget.id);

      for (const alert of alerts) {
        // Check if threshold is reached and alert not yet triggered
        if (status.percentage >= alert.threshold_percent && !alert.triggered_at) {
          await this.triggerAlert(budget.id, alert.id, alert.threshold_percent, status);
        }
      }

      // Check if budget is exceeded
      if (status.exceeded && budget.enforceLimit) {
        await this.handleBudgetExceeded(budget, scopeId);
      }
    }
  }

  /**
   * Get budget alerts for a budget
   */
  private getBudgetAlerts(budgetId: string): Array<{
    id: string;
    threshold_percent: number;
    triggered_at: string | null;
    notification_sent: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, threshold_percent, triggered_at, notification_sent
      FROM budget_alerts
      WHERE budget_id = ?
      ORDER BY threshold_percent ASC
    `);

    return stmt.all(budgetId) as any[];
  }

  /**
   * Trigger a threshold alert
   */
  private async triggerAlert(
    budgetId: string,
    alertId: string,
    threshold: number,
    status: { current: number; limit: number; percentage: number }
  ): Promise<void> {
    const now = new Date().toISOString();

    // Update alert record
    const stmt = this.db.prepare(`
      UPDATE budget_alerts
      SET triggered_at = ?, notification_sent = 1
      WHERE id = ?
    `);

    stmt.run(now, alertId);

    // Emit event based on threshold
    const eventType = this.getThresholdEventType(threshold);
    if (eventType) {
      (appEvents as any).emit(eventType, {
        budgetId,
        threshold,
        currentSpend: status.current,
        budgetLimit: status.limit,
        percentageUsed: status.percentage,
      });
    }

    logger.info(
      { budgetId, threshold, percentage: status.percentage },
      'Budget threshold alert triggered'
    );
  }

  /**
   * Get event type for threshold
   */
  private getThresholdEventType(threshold: number): string | null {
    switch (threshold) {
      case 50:
        return 'budget.threshold_50_reached';
      case 75:
        return 'budget.threshold_75_reached';
      case 90:
        return 'budget.threshold_90_reached';
      case 100:
        return 'budget.exceeded';
      default:
        return null;
    }
  }

  /**
   * Handle budget exceeded
   */
  private async handleBudgetExceeded(
    budget: any,
    scopeId?: string
  ): Promise<void> {
    // If workflow budget, pause the workflow
    if (budget.scope === 'workflow' && scopeId) {
      await this.pauseWorkflow(scopeId, `Budget "${budget.name}" exceeded`);

      // Record violation
      this.recordViolation(budget.id, null, budget.currentSpend - budget.budgetCredits, 'workflow_paused');

      logger.warn(
        { budgetId: budget.id, workflowId: scopeId },
        'Workflow paused due to budget exceeded'
      );
    } else {
      // Record violation with alert only
      this.recordViolation(budget.id, null, budget.currentSpend - budget.budgetCredits, 'alert_only');

      logger.warn({ budgetId: budget.id, scope: budget.scope }, 'Budget exceeded');
    }
  }

  /**
   * Pause a workflow
   */
  async pauseWorkflow(workflowId: string, reason: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE workflows
      SET enabled = 0, updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(workflowId);

    // Emit event
    (appEvents as any).emit('workflow.paused_budget', {
      workflowId,
      reason,
    });

    logger.info({ workflowId, reason }, 'Workflow paused');
  }

  /**
   * Record budget violation
   */
  private recordViolation(
    budgetId: string,
    workflowExecutionId: string | null,
    exceededBy: number,
    actionTaken: 'alert_only' | 'workflow_paused' | 'execution_blocked'
  ): void {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO budget_violations (id, budget_id, workflow_execution_id, exceeded_by_credits, action_taken, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, budgetId, workflowExecutionId, exceededBy, actionTaken, now);

    logger.info(
      { budgetId, actionTaken, exceededBy },
      'Budget violation recorded'
    );
  }

  /**
   * Get workflow details
   */
  private getWorkflowDetails(workflowId: string): { id: string; name: string } | null {
    const stmt = this.db.prepare('SELECT id, name FROM workflows WHERE id = ?');
    const row = stmt.get(workflowId) as any;
    return row || null;
  }

  /**
   * Get execution details
   */
  private getExecutionDetails(executionId: string): { workflowId: string } | null {
    const stmt = this.db.prepare('SELECT workflow_id FROM workflow_executions WHERE id = ?');
    const row = stmt.get(executionId) as any;
    return row ? { workflowId: row.workflow_id } : null;
  }

  /**
   * Get violations for a budget
   */
  getViolations(budgetId: string, limit = 50): BudgetViolation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM budget_violations
      WHERE budget_id = ?
      ORDER BY occurred_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(budgetId, limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      budgetId: row.budget_id,
      workflowExecutionId: row.workflow_execution_id,
      exceededByCredits: row.exceeded_by_credits,
      actionTaken: row.action_taken,
      occurredAt: new Date(row.occurred_at),
    }));
  }
}
