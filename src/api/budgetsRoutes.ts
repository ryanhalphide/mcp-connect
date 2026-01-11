/**
 * Budget Routes
 * Hono routes for budget API
 */

import { Hono } from 'hono';
import { serverDatabase } from '../storage/db.js';
import { BudgetManager } from '../budgets/budgetManager.js';
import { BudgetEnforcer } from '../budgets/budgetEnforcer.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'budget-api-routes' });
const app = new Hono();
const db = serverDatabase.getDatabase();
const budgetManager = new BudgetManager(db);
const budgetEnforcer = new BudgetEnforcer(db);

// List all budgets
app.get('/', async (c) => {
  try {
    const { scope, scopeId, enabled, limit, offset } = c.req.query();

    const result = budgetManager.listBudgets({
      scope: scope as any,
      scopeId: scopeId as string,
      enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    return c.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to list budgets');
    return c.json({ error: 'Failed to list budgets' }, 500);
  }
});

// Get budget dashboard
app.get('/dashboard', async (c) => {
  try {
    const { budgets, total } = budgetManager.listBudgets({ limit: 100 });

    const dashboard = {
      totalBudgets: total,
      budgets: budgets.map((budget) => {
        const status = budgetManager.getBudgetStatus(budget.id);
        return {
          id: budget.id,
          name: budget.name,
          scope: budget.scope,
          scopeId: budget.scopeId,
          period: budget.period,
          enabled: budget.enabled,
          enforceLimit: budget.enforceLimit,
          status,
        };
      }),
    };

    return c.json(dashboard);
  } catch (error) {
    logger.error({ error }, 'Failed to get budget dashboard');
    return c.json({ error: 'Failed to get budget dashboard' }, 500);
  }
});

// Get budget details
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const budget = budgetManager.getBudget(id);

    if (!budget) {
      return c.json({ error: 'Budget not found' }, 404);
    }

    return c.json(budget);
  } catch (error) {
    logger.error({ error }, 'Failed to get budget');
    return c.json({ error: 'Failed to get budget' }, 500);
  }
});

// Get budget status
app.get('/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const status = budgetManager.getBudgetStatus(id);

    if (!status) {
      return c.json({ error: 'Budget not found' }, 404);
    }

    return c.json(status);
  } catch (error) {
    logger.error({ error }, 'Failed to get budget status');
    return c.json({ error: 'Failed to get budget status' }, 500);
  }
});

// Get violations
app.get('/:id/violations', async (c) => {
  try {
    const id = c.req.param('id');
    const { limit } = c.req.query();

    const violations = budgetEnforcer.getViolations(
      id,
      limit ? parseInt(limit) : undefined
    );

    return c.json({ violations });
  } catch (error) {
    logger.error({ error }, 'Failed to get violations');
    return c.json({ error: 'Failed to get violations' }, 500);
  }
});

// Create budget
app.post('/', async (c) => {
  try {
    const config = await c.req.json();

    // Validate required fields
    if (!config.name || !config.scope || !config.budgetCredits || !config.period) {
      return c.json({
        error: 'Missing required fields: name, scope, budgetCredits, period',
      }, 400);
    }

    const budget = budgetManager.createBudget(config);
    return c.json(budget, 201);
  } catch (error) {
    logger.error({ error }, 'Failed to create budget');
    if (error instanceof Error && error.message.includes('already exists')) {
      return c.json({ error: error.message }, 409);
    }
    return c.json({ error: 'Failed to create budget' }, 500);
  }
});

// Update budget
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const updates = await c.req.json();

    const budget = budgetManager.updateBudget(id, updates);

    if (!budget) {
      return c.json({ error: 'Budget not found' }, 404);
    }

    return c.json(budget);
  } catch (error) {
    logger.error({ error }, 'Failed to update budget');
    return c.json({ error: 'Failed to update budget' }, 500);
  }
});

// Delete budget
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const deleted = budgetManager.deleteBudget(id);

    if (!deleted) {
      return c.json({ error: 'Budget not found' }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    logger.error({ error }, 'Failed to delete budget');
    return c.json({ error: 'Failed to delete budget' }, 500);
  }
});

// Reset budget period
app.post('/:id/reset', async (c) => {
  try {
    const id = c.req.param('id');

    const budget = budgetManager.getBudget(id);
    if (!budget) {
      return c.json({ error: 'Budget not found' }, 404);
    }

    budgetManager.resetBudgetPeriod(id);

    const updatedBudget = budgetManager.getBudget(id);
    return c.json(updatedBudget);
  } catch (error) {
    logger.error({ error }, 'Failed to reset budget');
    return c.json({ error: 'Failed to reset budget' }, 500);
  }
});

export const budgetsApi = app;
