/**
 * Workflow orchestration types and schemas
 */

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type StepType = 'tool' | 'prompt' | 'resource' | 'parallel' | 'condition' | 'sampling';
export type ErrorStrategy = 'stop' | 'continue' | 'retry';

/**
 * Retry configuration for workflow steps
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number; // Default 2 (exponential backoff)
}

/**
 * Condition for conditional steps
 */
export interface StepCondition {
  type: 'equals' | 'notEquals' | 'contains' | 'exists' | 'gt' | 'lt';
  path: string; // JSONPath to value in context
  value?: unknown;
}

/**
 * LLM message for sampling steps
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sampling step configuration
 */
export interface SamplingStepConfig {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

/**
 * Individual workflow step configuration
 */
export interface WorkflowStep {
  name: string;
  type: StepType;
  config: {
    // For tool steps
    server?: string;
    tool?: string;
    params?: Record<string, unknown>;

    // For prompt steps
    prompt?: string;
    arguments?: Record<string, string>;

    // For resource steps
    resource?: string;
    uri?: string;

    // For parallel steps
    steps?: WorkflowStep[];

    // For condition steps
    condition?: StepCondition;
    then?: WorkflowStep[];
    else?: WorkflowStep[];

    // For sampling steps
    sampling?: SamplingStepConfig;
  };
  onError?: ErrorStrategy;
  retryConfig?: RetryConfig;
  condition?: StepCondition; // Run step only if condition is true
}

/**
 * Complete workflow definition
 */
export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  errorHandling?: {
    strategy: 'rollback' | 'continue';
    onError?: string; // Workflow to execute on error
  };
  timeout?: number; // Timeout in milliseconds
}

/**
 * Workflow database record
 */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workflow execution input
 */
export interface WorkflowExecutionInput {
  workflowId: string;
  input?: Record<string, unknown>;
  triggeredBy?: string;
}

/**
 * Workflow execution record
 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  triggeredBy?: string;
}

/**
 * Workflow execution step record
 */
export interface WorkflowExecutionStep {
  id: string;
  executionId: string;
  stepIndex: number;
  stepName: string;
  status: StepStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  retryCount: number;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Execution context available to all steps
 */
export interface ExecutionContext {
  input: Record<string, unknown>;
  steps: Record<string, { output?: unknown; error?: string }>;
  env: Record<string, string>;
}
