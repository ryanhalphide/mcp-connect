/**
 * Budget Notification Service
 * Handles notifications for budget events
 */

import { createChildLogger } from '../observability/logger.js';
import { appEvents } from '../core/events.js';
import { webhookDeliveryService } from '../core/webhookDelivery.js';

const logger = createChildLogger({ module: 'budget-notifications' });

export interface BudgetEvent {
  type: 'threshold_reached' | 'budget_exceeded' | 'workflow_paused';
  budgetId: string;
  budgetName?: string;
  threshold?: number;
  currentSpend: number;
  budgetLimit: number;
  percentageUsed: number;
  workflowId?: string;
  timestamp: Date;
}

export class BudgetNotificationService {
  private sseClients: Set<any> = new Set();

  /**
   * Start listening to budget events
   */
  start(): void {
    // Listen to all threshold events
    (appEvents as any).on('budget.threshold_50_reached', (payload: any) =>
      this.handleThresholdEvent(50, payload)
    );
    (appEvents as any).on('budget.threshold_75_reached', (payload: any) =>
      this.handleThresholdEvent(75, payload)
    );
    (appEvents as any).on('budget.threshold_90_reached', (payload: any) =>
      this.handleThresholdEvent(90, payload)
    );
    (appEvents as any).on('budget.exceeded', (payload: any) =>
      this.handleBudgetExceeded(payload)
    );
    (appEvents as any).on('workflow.paused_budget', (payload: any) =>
      this.handleWorkflowPaused(payload)
    );

    logger.info('Budget notification service started');
  }

  /**
   * Handle threshold reached event
   */
  private async handleThresholdEvent(threshold: number, payload: any): Promise<void> {
    const event: BudgetEvent = {
      type: 'threshold_reached',
      budgetId: payload.budgetId,
      threshold,
      currentSpend: payload.currentSpend,
      budgetLimit: payload.budgetLimit,
      percentageUsed: payload.percentageUsed,
      timestamp: new Date(),
    };

    await this.notifyThresholdReached(event);
  }

  /**
   * Handle budget exceeded event
   */
  private async handleBudgetExceeded(payload: any): Promise<void> {
    const event: BudgetEvent = {
      type: 'budget_exceeded',
      budgetId: payload.budgetId,
      currentSpend: payload.currentSpend,
      budgetLimit: payload.budgetLimit,
      percentageUsed: payload.percentageUsed,
      timestamp: new Date(),
    };

    await this.notifyBudgetExceeded(event);
  }

  /**
   * Handle workflow paused event
   */
  private async handleWorkflowPaused(payload: any): Promise<void> {
    const event: BudgetEvent = {
      type: 'workflow_paused',
      budgetId: payload.budgetId || 'unknown',
      workflowId: payload.workflowId,
      currentSpend: 0,
      budgetLimit: 0,
      percentageUsed: 100,
      timestamp: new Date(),
    };

    await this.notifyWorkflowPaused(event);
  }

  /**
   * Notify threshold reached
   */
  async notifyThresholdReached(event: BudgetEvent): Promise<void> {
    const message = `Budget threshold ${event.threshold}% reached: ${event.currentSpend.toFixed(2)} / ${event.budgetLimit.toFixed(2)} credits (${event.percentageUsed.toFixed(1)}%)`;

    logger.info(
      { budgetId: event.budgetId, threshold: event.threshold },
      message
    );

    // Send SSE events
    await this.sendSSEEvent({
      event: 'budget.threshold_reached',
      data: event,
    });

    // Webhooks are automatically delivered by the webhook delivery service
    // since it listens to all appEvents
  }

  /**
   * Notify budget exceeded
   */
  async notifyBudgetExceeded(event: BudgetEvent): Promise<void> {
    const message = `Budget exceeded: ${event.currentSpend.toFixed(2)} / ${event.budgetLimit.toFixed(2)} credits`;

    logger.warn({ budgetId: event.budgetId }, message);

    // Send SSE events
    await this.sendSSEEvent({
      event: 'budget.exceeded',
      data: event,
    });
  }

  /**
   * Notify workflow paused
   */
  async notifyWorkflowPaused(event: BudgetEvent): Promise<void> {
    const message = `Workflow ${event.workflowId} paused due to budget exceeded`;

    logger.warn(
      { budgetId: event.budgetId, workflowId: event.workflowId },
      message
    );

    // Send SSE events
    await this.sendSSEEvent({
      event: 'workflow.paused_budget',
      data: event,
    });
  }

  /**
   * Send Server-Sent Event
   */
  async sendSSEEvent(event: { event: string; data: any }): Promise<void> {
    const message = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch (error) {
        logger.error({ error }, 'Failed to send SSE event');
        this.sseClients.delete(client);
      }
    }

    logger.debug({ event: event.event, clientCount: this.sseClients.size }, 'SSE event sent');
  }

  /**
   * Register SSE client
   */
  registerSSEClient(client: any): void {
    this.sseClients.add(client);
    logger.debug({ clientCount: this.sseClients.size }, 'SSE client registered');
  }

  /**
   * Unregister SSE client
   */
  unregisterSSEClient(client: any): void {
    this.sseClients.delete(client);
    logger.debug({ clientCount: this.sseClients.size }, 'SSE client unregistered');
  }

  /**
   * Get notification summary
   */
  getSummary(): {
    activeClients: number;
    webhookEnabled: boolean;
  } {
    return {
      activeClients: this.sseClients.size,
      webhookEnabled: true, // Webhooks are handled by webhook delivery service
    };
  }
}

// Singleton instance
export const budgetNotificationService = new BudgetNotificationService();
