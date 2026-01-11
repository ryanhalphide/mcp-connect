import { EventEmitter } from 'events';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'events' });

// Event types
export type EventType =
  | 'server.connected'
  | 'server.disconnected'
  | 'server.error'
  | 'server.created'
  | 'server.updated'
  | 'server.deleted'
  | 'tool.invoked'
  | 'tool.error'
  | 'circuit.opened'
  | 'circuit.closed'
  | 'circuit.half_open'
  | 'workflow_template.created'
  | 'workflow_template.instantiated'
  | 'workflow_template.deleted'
  | 'budget.threshold_50_reached'
  | 'budget.threshold_75_reached'
  | 'budget.threshold_90_reached'
  | 'budget.exceeded'
  | 'workflow.paused_budget'
  | 'key_exposure.detected'
  | 'key_exposure.blocked';

// Event payloads
export interface ServerEvent {
  serverId: string;
  serverName: string;
  timestamp: Date;
}

export interface ServerConnectedEvent extends ServerEvent {
  type: 'server.connected';
  toolCount: number;
}

export interface ServerDisconnectedEvent extends ServerEvent {
  type: 'server.disconnected';
}

export interface ServerErrorEvent extends ServerEvent {
  type: 'server.error';
  error: string;
}

export interface ServerCreatedEvent extends ServerEvent {
  type: 'server.created';
}

export interface ServerUpdatedEvent extends ServerEvent {
  type: 'server.updated';
  changes: string[];
}

export interface ServerDeletedEvent extends ServerEvent {
  type: 'server.deleted';
}

export interface ToolEvent {
  toolName: string;
  serverId: string;
  timestamp: Date;
}

export interface ToolInvokedEvent extends ToolEvent {
  type: 'tool.invoked';
  durationMs: number;
  success: boolean;
  apiKeyId?: string;
}

export interface ToolErrorEvent extends ToolEvent {
  type: 'tool.error';
  error: string;
}

export interface CircuitEvent {
  serverId: string;
  serverName: string;
  timestamp: Date;
}

export interface CircuitOpenedEvent extends CircuitEvent {
  type: 'circuit.opened';
  failureCount: number;
}

export interface CircuitClosedEvent extends CircuitEvent {
  type: 'circuit.closed';
}

export interface CircuitHalfOpenEvent extends CircuitEvent {
  type: 'circuit.half_open';
}

export interface WorkflowTemplateEvent {
  templateId: string;
  templateName?: string;
  timestamp: Date;
}

export interface WorkflowTemplateCreatedEvent extends WorkflowTemplateEvent {
  type: 'workflow_template.created';
  templateName: string;
}

export interface WorkflowTemplateInstantiatedEvent extends WorkflowTemplateEvent {
  type: 'workflow_template.instantiated';
  workflowId?: string;
}

export interface WorkflowTemplateDeletedEvent extends WorkflowTemplateEvent {
  type: 'workflow_template.deleted';
}

// Budget events
export interface BudgetThresholdEvent {
  budgetId: string;
  threshold: number;
  currentSpend: number;
  budgetLimit: number;
  percentageUsed: number;
  timestamp: Date;
}

export interface BudgetThreshold50Event extends BudgetThresholdEvent {
  type: 'budget.threshold_50_reached';
  threshold: 50;
}

export interface BudgetThreshold75Event extends BudgetThresholdEvent {
  type: 'budget.threshold_75_reached';
  threshold: 75;
}

export interface BudgetThreshold90Event extends BudgetThresholdEvent {
  type: 'budget.threshold_90_reached';
  threshold: 90;
}

export interface BudgetExceededEvent extends BudgetThresholdEvent {
  type: 'budget.exceeded';
  threshold: 100;
}

export interface WorkflowPausedBudgetEvent {
  workflowId: string;
  reason: string;
  budgetId?: string;
  timestamp: Date;
  type: 'workflow.paused_budget';
}

// Security events
export interface KeyExposureDetectedEvent {
  detectionId: string;
  provider: string;
  location: string;
  severity: 'high' | 'medium' | 'low';
  timestamp: Date;
  type: 'key_exposure.detected';
}

export interface KeyExposureBlockedEvent {
  detectionId: string;
  provider: string;
  entityType: string;
  entityId: string;
  timestamp: Date;
  type: 'key_exposure.blocked';
}

export type AppEvent =
  | ServerConnectedEvent
  | ServerDisconnectedEvent
  | ServerErrorEvent
  | ServerCreatedEvent
  | ServerUpdatedEvent
  | ServerDeletedEvent
  | ToolInvokedEvent
  | ToolErrorEvent
  | CircuitOpenedEvent
  | CircuitClosedEvent
  | CircuitHalfOpenEvent
  | WorkflowTemplateCreatedEvent
  | WorkflowTemplateInstantiatedEvent
  | WorkflowTemplateDeletedEvent
  | BudgetThreshold50Event
  | BudgetThreshold75Event
  | BudgetThreshold90Event
  | BudgetExceededEvent
  | WorkflowPausedBudgetEvent
  | KeyExposureDetectedEvent
  | KeyExposureBlockedEvent;

/**
 * Typed event emitter for application events
 */
class AppEventEmitter extends EventEmitter {
  emit<T extends AppEvent>(event: T['type'], payload: Omit<T, 'type' | 'timestamp'>): boolean {
    const fullPayload = {
      ...payload,
      type: event,
      timestamp: new Date(),
    };

    logger.debug({ event, serverId: (payload as { serverId?: string }).serverId }, 'Event emitted');

    return super.emit(event, fullPayload);
  }

  on<T extends AppEvent>(event: T['type'], listener: (payload: T) => void): this {
    return super.on(event, listener);
  }

  once<T extends AppEvent>(event: T['type'], listener: (payload: T) => void): this {
    return super.once(event, listener);
  }

  off<T extends AppEvent>(event: T['type'], listener: (payload: T) => void): this {
    return super.off(event, listener);
  }

  // Emit server events
  emitServerConnected(serverId: string, serverName: string, toolCount: number): void {
    this.emit<ServerConnectedEvent>('server.connected', { serverId, serverName, toolCount });
  }

  emitServerDisconnected(serverId: string, serverName: string): void {
    this.emit<ServerDisconnectedEvent>('server.disconnected', { serverId, serverName });
  }

  emitServerError(serverId: string, serverName: string, error: string): void {
    this.emit<ServerErrorEvent>('server.error', { serverId, serverName, error });
  }

  emitServerCreated(serverId: string, serverName: string): void {
    this.emit<ServerCreatedEvent>('server.created', { serverId, serverName });
  }

  emitServerUpdated(serverId: string, serverName: string, changes: string[]): void {
    this.emit<ServerUpdatedEvent>('server.updated', { serverId, serverName, changes });
  }

  emitServerDeleted(serverId: string, serverName: string): void {
    this.emit<ServerDeletedEvent>('server.deleted', { serverId, serverName });
  }

  // Emit tool events
  emitToolInvoked(
    toolName: string,
    serverId: string,
    durationMs: number,
    success: boolean,
    apiKeyId?: string
  ): void {
    this.emit<ToolInvokedEvent>('tool.invoked', {
      toolName,
      serverId,
      durationMs,
      success,
      apiKeyId,
    });
  }

  emitToolError(toolName: string, serverId: string, error: string): void {
    this.emit<ToolErrorEvent>('tool.error', { toolName, serverId, error });
  }

  // Emit circuit breaker events
  emitCircuitOpened(serverId: string, serverName: string, failureCount: number): void {
    this.emit<CircuitOpenedEvent>('circuit.opened', { serverId, serverName, failureCount });
  }

  emitCircuitClosed(serverId: string, serverName: string): void {
    this.emit<CircuitClosedEvent>('circuit.closed', { serverId, serverName });
  }

  emitCircuitHalfOpen(serverId: string, serverName: string): void {
    this.emit<CircuitHalfOpenEvent>('circuit.half_open', { serverId, serverName });
  }

  // Emit workflow template events
  emitWorkflowTemplateCreated(templateId: string, templateName: string): void {
    this.emit<WorkflowTemplateCreatedEvent>('workflow_template.created', {
      templateId,
      templateName,
    });
  }

  emitWorkflowTemplateInstantiated(templateId: string, workflowId?: string): void {
    this.emit<WorkflowTemplateInstantiatedEvent>('workflow_template.instantiated', {
      templateId,
      workflowId,
    });
  }

  emitWorkflowTemplateDeleted(templateId: string): void {
    this.emit<WorkflowTemplateDeletedEvent>('workflow_template.deleted', {
      templateId,
    });
  }
}

// Singleton instance
export const appEvents = new AppEventEmitter();

// All event types for filtering
export const ALL_EVENT_TYPES: EventType[] = [
  'server.connected',
  'server.disconnected',
  'server.error',
  'server.created',
  'server.updated',
  'server.deleted',
  'tool.invoked',
  'tool.error',
  'circuit.opened',
  'circuit.closed',
  'circuit.half_open',
  'workflow_template.created',
  'workflow_template.instantiated',
  'workflow_template.deleted',
  'budget.threshold_50_reached',
  'budget.threshold_75_reached',
  'budget.threshold_90_reached',
  'budget.exceeded',
  'workflow.paused_budget',
  'key_exposure.detected',
  'key_exposure.blocked',
];
