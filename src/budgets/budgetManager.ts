/**
 * Budget Manager
 * Manages cost budgets with different scopes (workflow, tenant, api_key, global)
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'budget-manager' });

export type BudgetScope = 'workflow' | 'tenant' | 'api_key' | 'global';
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly' | 'total';

export interface BudgetConfig {
  name: string;
  scope: BudgetScope;
  scopeId?: string; // null for global scope
  budgetCredits: number;
  period: BudgetPeriod;
  periodStart?: string; // ISO date string
  periodEnd?: string; // ISO date string, null for rolling periods
  enabled?: boolean;
  enforceLimit?: boolean;
}

export interface Budget {
  id: string;
  name: string;
  scope: BudgetScope;
  scopeId: string | null;
  budgetCredits: number;
  period: BudgetPeriod;
  periodStart: string;
  periodEnd: string | null;
  currentSpend: number;
  enabled: boolean;
  enforceLimit: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  budgetId?: string;
  currentSpend: number;
  budgetCredits: number;
  percentageUsed: number;
  reason?: string;
}

export interface BudgetStatus {
  current: number;
  limit: number;
  percentage: number;
  exceeded: boolean;
  remaining: number;
}

export class BudgetManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new budget
   */
  createBudget(config: BudgetConfig): Budget {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const periodStart = config.periodStart || now;

    // Calculate period end if not provided
    let periodEnd = config.periodEnd || null;
    if (!periodEnd && config.period !== 'total') {
      periodEnd = this.calculatePeriodEnd(periodStart, config.period);
    }

    const stmt = this.db.prepare(`
      INSERT INTO cost_budgets (
        id, name, scope, scope_id, budget_credits, period, period_start, period_end,
        enabled, enforce_limit, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id,
        config.name,
        config.scope,
        config.scopeId || null,
        config.budgetCredits,
        config.period,
        periodStart,
        periodEnd,
        config.enabled !== false ? 1 : 0,
        config.enforceLimit !== false ? 1 : 0,
        now,
        now
      );

      // Create alert thresholds (50%, 75%, 90%, 100%)
      this.createBudgetAlerts(id);

      logger.info({ budgetId: id, name: config.name, scope: config.scope }, 'Budget created');

      return this.getBudget(id)!;
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Budget already exists for ${config.scope}${config.scopeId ? `: ${config.scopeId}` : ''} with period ${config.period}`);
      }
      throw error;
    }
  }

  /**
   * Create alert thresholds for a budget
   */
  private createBudgetAlerts(budgetId: string): void {
    const thresholds = [50, 75, 90, 100];
    const stmt = this.db.prepare(`
      INSERT INTO budget_alerts (id, budget_id, threshold_percent)
      VALUES (?, ?, ?)
    `);

    for (const threshold of thresholds) {
      const alertId = randomBytes(16).toString('hex');
      stmt.run(alertId, budgetId, threshold);
    }
  }

  /**
   * Calculate period end date
   */
  private calculatePeriodEnd(periodStart: string, period: BudgetPeriod): string {
    const start = new Date(periodStart);
    const end = new Date(start);

    switch (period) {
      case 'daily':
        end.setDate(end.getDate() + 1);
        break;
      case 'weekly':
        end.setDate(end.getDate() + 7);
        break;
      case 'monthly':
        end.setMonth(end.getMonth() + 1);
        break;
      case 'total':
        // No end date for total budgets
        return null!;
    }

    return end.toISOString();
  }

  /**
   * Get a budget by ID
   */
  getBudget(id: string): Budget | null {
    const stmt = this.db.prepare(`
      SELECT * FROM cost_budgets WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.mapRowToBudget(row);
  }

  /**
   * Update a budget
   */
  updateBudget(id: string, updates: Partial<BudgetConfig>): Budget | null {
    const budget = this.getBudget(id);
    if (!budget) return null;

    const updateFields: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      params.push(updates.name);
    }

    if (updates.budgetCredits !== undefined) {
      updateFields.push('budget_credits = ?');
      params.push(updates.budgetCredits);
    }

    if (updates.enabled !== undefined) {
      updateFields.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }

    if (updates.enforceLimit !== undefined) {
      updateFields.push('enforce_limit = ?');
      params.push(updates.enforceLimit ? 1 : 0);
    }

    if (updates.periodEnd !== undefined) {
      updateFields.push('period_end = ?');
      params.push(updates.periodEnd);
    }

    if (updateFields.length === 0) {
      return budget;
    }

    updateFields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE cost_budgets
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...params);

    logger.info({ budgetId: id }, 'Budget updated');

    return this.getBudget(id);
  }

  /**
   * Delete a budget
   */
  deleteBudget(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM cost_budgets WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ budgetId: id }, 'Budget deleted');
      return true;
    }

    return false;
  }

  /**
   * List budgets with optional filters
   */
  listBudgets(filters: {
    scope?: BudgetScope;
    scopeId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
  } = {}): { budgets: Budget[]; total: number } {
    const { scope, scopeId, enabled, limit = 50, offset = 0 } = filters;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (scope !== undefined) {
      whereClauses.push('scope = ?');
      params.push(scope);
    }

    if (scopeId !== undefined) {
      whereClauses.push('scope_id = ?');
      params.push(scopeId);
    }

    if (enabled !== undefined) {
      whereClauses.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Get total count
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM cost_budgets ${whereClause}`);
    const countRow = countStmt.get(...params) as { count: number };

    // Get paginated results
    const stmt = this.db.prepare(`
      SELECT * FROM cost_budgets
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...params, limit, offset) as any[];

    return {
      budgets: rows.map(this.mapRowToBudget),
      total: countRow.count,
    };
  }

  /**
   * Check if a budget allows spending
   */
  checkBudget(scope: BudgetScope, scopeId?: string): BudgetCheckResult {
    // Find applicable budgets in order of precedence
    const budgets = this.getApplicableBudgets(scope, scopeId);

    if (budgets.length === 0) {
      return {
        allowed: true,
        currentSpend: 0,
        budgetCredits: 0,
        percentageUsed: 0,
      };
    }

    // Check most specific budget first
    for (const budget of budgets) {
      if (!budget.enabled) continue;

      // Check if period has expired and needs reset
      if (budget.periodEnd) {
        const now = new Date();
        const periodEnd = new Date(budget.periodEnd);
        if (now > periodEnd) {
          this.resetBudgetPeriod(budget.id);
          continue; // Re-check after reset
        }
      }

      const percentageUsed = (budget.currentSpend / budget.budgetCredits) * 100;
      const exceeded = budget.currentSpend >= budget.budgetCredits;

      if (exceeded && budget.enforceLimit) {
        return {
          allowed: false,
          budgetId: budget.id,
          currentSpend: budget.currentSpend,
          budgetCredits: budget.budgetCredits,
          percentageUsed,
          reason: `Budget "${budget.name}" exceeded (${percentageUsed.toFixed(1)}%)`,
        };
      }
    }

    // All checks passed
    const primaryBudget = budgets[0];
    const percentageUsed = (primaryBudget.currentSpend / primaryBudget.budgetCredits) * 100;

    return {
      allowed: true,
      budgetId: primaryBudget.id,
      currentSpend: primaryBudget.currentSpend,
      budgetCredits: primaryBudget.budgetCredits,
      percentageUsed,
    };
  }

  /**
   * Get applicable budgets in order of precedence
   */
  private getApplicableBudgets(scope: BudgetScope, scopeId?: string): Budget[] {
    const budgets: Budget[] = [];

    // 1. Scope-specific budget (most specific)
    if (scopeId) {
      const stmt = this.db.prepare(`
        SELECT * FROM cost_budgets
        WHERE scope = ? AND scope_id = ? AND enabled = 1
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const row = stmt.get(scope, scopeId) as any;
      if (row) {
        budgets.push(this.mapRowToBudget(row));
      }
    }

    // 2. Scope-level budget (without specific ID)
    const scopeStmt = this.db.prepare(`
      SELECT * FROM cost_budgets
      WHERE scope = ? AND scope_id IS NULL AND enabled = 1
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const scopeRow = scopeStmt.get(scope) as any;
    if (scopeRow) {
      budgets.push(this.mapRowToBudget(scopeRow));
    }

    // 3. Global budget (least specific)
    const globalStmt = this.db.prepare(`
      SELECT * FROM cost_budgets
      WHERE scope = 'global' AND enabled = 1
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const globalRow = globalStmt.get() as any;
    if (globalRow) {
      budgets.push(this.mapRowToBudget(globalRow));
    }

    return budgets;
  }

  /**
   * Record spending against a budget
   */
  recordSpend(scope: BudgetScope, scopeId: string | undefined, credits: number): void {
    const budgets = this.getApplicableBudgets(scope, scopeId);

    for (const budget of budgets) {
      if (!budget.enabled) continue;

      const stmt = this.db.prepare(`
        UPDATE cost_budgets
        SET current_spend = current_spend + ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(credits, new Date().toISOString(), budget.id);

      logger.debug(
        { budgetId: budget.id, credits, newTotal: budget.currentSpend + credits },
        'Recorded spend'
      );
    }
  }

  /**
   * Reset a budget period (e.g., for rolling daily/weekly/monthly budgets)
   */
  resetBudgetPeriod(budgetId: string): void {
    const budget = this.getBudget(budgetId);
    if (!budget) return;

    const now = new Date().toISOString();
    const newPeriodEnd = budget.period !== 'total' ? this.calculatePeriodEnd(now, budget.period) : null;

    const stmt = this.db.prepare(`
      UPDATE cost_budgets
      SET current_spend = 0, period_start = ?, period_end = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(now, newPeriodEnd, now, budgetId);

    // Reset alerts
    const alertStmt = this.db.prepare(`
      UPDATE budget_alerts
      SET triggered_at = NULL, notification_sent = 0
      WHERE budget_id = ?
    `);

    alertStmt.run(budgetId);

    logger.info({ budgetId, period: budget.period }, 'Budget period reset');
  }

  /**
   * Get budget status
   */
  getBudgetStatus(budgetId: string): BudgetStatus | null {
    const budget = this.getBudget(budgetId);
    if (!budget) return null;

    const percentage = (budget.currentSpend / budget.budgetCredits) * 100;
    const exceeded = budget.currentSpend >= budget.budgetCredits;
    const remaining = Math.max(0, budget.budgetCredits - budget.currentSpend);

    return {
      current: budget.currentSpend,
      limit: budget.budgetCredits,
      percentage,
      exceeded,
      remaining,
    };
  }

  /**
   * Map database row to Budget object
   */
  private mapRowToBudget(row: any): Budget {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      scopeId: row.scope_id,
      budgetCredits: row.budget_credits,
      period: row.period,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      currentSpend: row.current_spend,
      enabled: row.enabled === 1,
      enforceLimit: row.enforce_limit === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
