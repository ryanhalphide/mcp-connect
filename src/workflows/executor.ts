import type { WorkflowStep, RetryConfig } from './types.js';
import type { WorkflowContext } from './context.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { resourceRegistry } from '../core/resourceRegistry.js';
import { promptRegistry } from '../core/promptRegistry.js';
import { callTool } from '../mcp/client.js';
import { readResource } from '../mcp/client.js';
import { getPrompt } from '../mcp/client.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createChildLogger } from '../observability/logger.js';
import { stepCostTracker, type StepCostData } from './stepCostTracker.js';

const logger = createChildLogger({ module: 'workflow-executor' });

/**
 * Executes individual workflow steps
 */
export class WorkflowExecutor {
  /**
   * Execute a single workflow step
   */
  async executeStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<{ success: boolean; output?: unknown; error?: string; costData?: StepCostData }> {
    logger.info({ stepName: step.name, stepType: step.type }, 'Executing workflow step');

    const startTime = Date.now();

    try {
      // Interpolate step configuration
      const interpolatedConfig = context.interpolate(step.config) as WorkflowStep['config'];

      // Execute based on step type
      let output: unknown;

      switch (step.type) {
        case 'tool':
          output = await this.executeTool(interpolatedConfig, context);
          break;
        case 'prompt':
          output = await this.executePrompt(interpolatedConfig, context);
          break;
        case 'resource':
          output = await this.executeResource(interpolatedConfig, context);
          break;
        case 'parallel':
          output = await this.executeParallel(interpolatedConfig, context);
          break;
        case 'condition':
          output = await this.executeCondition(interpolatedConfig, context);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // Track step cost
      const durationMs = Date.now() - startTime;
      const costData = stepCostTracker.trackStepCost(step.name, step.type, output, durationMs);

      logger.info({ stepName: step.name, ...costData }, 'Step completed successfully');
      return { success: true, output, costData };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;
      logger.error({ stepName: step.name, error: errorMessage }, 'Step execution failed');
      return { success: false, error: errorMessage, costData: { tokensUsed: 0, costCredits: 0, durationMs } };
    }
  }

  /**
   * Execute a tool invocation step
   */
  private async executeTool(
    config: WorkflowStep['config'],
    context: WorkflowContext
  ): Promise<unknown> {
    if (!config.server || !config.tool) {
      throw new Error('Tool step requires "server" and "tool" configuration');
    }

    // Find the tool in registry
    const toolEntry = toolRegistry.findTool(`${config.server}/${config.tool}`);
    if (!toolEntry) {
      throw new Error(`Tool not found: ${config.server}/${config.tool}`);
    }

    // Get MCP client
    const client = connectionPool.getClient(toolEntry.serverId);
    if (!client) {
      throw new Error(`Server not connected: ${config.server}`);
    }

    // Execute tool
    const params = config.params || {};
    const result = await callTool(client as Client, config.tool, params);

    return result;
  }

  /**
   * Execute a prompt step
   */
  private async executePrompt(
    config: WorkflowStep['config'],
    context: WorkflowContext
  ): Promise<unknown> {
    if (!config.prompt) {
      throw new Error('Prompt step requires "prompt" configuration');
    }

    // Find the prompt in registry
    const promptEntry = promptRegistry.findPrompt(config.prompt);
    if (!promptEntry) {
      throw new Error(`Prompt not found: ${config.prompt}`);
    }

    // Get MCP client
    const client = connectionPool.getClient(promptEntry.serverId);
    if (!client) {
      throw new Error(`Server not connected for prompt: ${config.prompt}`);
    }

    // Extract prompt name (remove server prefix)
    const promptName = config.prompt.includes('/')
      ? config.prompt.split('/').slice(1).join('/')
      : config.prompt;

    // Execute prompt
    const args = config.arguments || {};
    const result = await getPrompt(client as Client, promptName, args);

    return result;
  }

  /**
   * Execute a resource read step
   */
  private async executeResource(
    config: WorkflowStep['config'],
    context: WorkflowContext
  ): Promise<unknown> {
    if (!config.uri) {
      throw new Error('Resource step requires "uri" configuration');
    }

    // Find the resource in registry
    const resourceEntry = resourceRegistry.findResource(config.uri);
    if (!resourceEntry) {
      throw new Error(`Resource not found: ${config.uri}`);
    }

    // Get MCP client
    const client = connectionPool.getClient(resourceEntry.serverId);
    if (!client) {
      throw new Error(`Server not connected for resource: ${config.uri}`);
    }

    // Read resource
    const result = await readResource(client as Client, config.uri);

    return result;
  }

  /**
   * Execute parallel steps
   */
  private async executeParallel(
    config: WorkflowStep['config'],
    context: WorkflowContext
  ): Promise<unknown> {
    if (!config.steps || !Array.isArray(config.steps)) {
      throw new Error('Parallel step requires "steps" array configuration');
    }

    // Execute all steps in parallel
    const results = await Promise.all(
      config.steps.map(async (step) => {
        const result = await this.executeStep(step, context);
        if (!result.success) {
          throw new Error(`Parallel step "${step.name}" failed: ${result.error}`);
        }
        return { name: step.name, output: result.output };
      })
    );

    // Return results as object with step names as keys
    const output: Record<string, unknown> = {};
    for (const result of results) {
      output[result.name] = result.output;
    }

    return output;
  }

  /**
   * Execute conditional step
   */
  private async executeCondition(
    config: WorkflowStep['config'],
    context: WorkflowContext
  ): Promise<unknown> {
    if (!config.condition) {
      throw new Error('Condition step requires "condition" configuration');
    }

    const conditionResult = context.evaluateCondition(config.condition);

    // Execute then or else branch
    const branch = conditionResult ? config.then : config.else;

    if (!branch || !Array.isArray(branch)) {
      return { conditionResult, executed: false };
    }

    // Execute steps in the chosen branch
    const results: Record<string, unknown> = {};
    for (const step of branch) {
      const result = await this.executeStep(step, context);
      if (!result.success) {
        throw new Error(`Condition branch step "${step.name}" failed: ${result.error}`);
      }
      results[step.name] = result.output;
      context.setStepOutput(step.name, result.output);
    }

    return { conditionResult, executed: true, results };
  }

  /**
   * Execute a step with retry logic
   */
  async executeWithRetry(
    step: WorkflowStep,
    context: WorkflowContext,
    retryConfig?: RetryConfig
  ): Promise<{ success: boolean; output?: unknown; error?: string; retries: number; costData?: StepCostData }> {
    const config = retryConfig || step.retryConfig;
    const maxAttempts = config?.maxAttempts || 1;
    const backoffMs = config?.backoffMs || 1000;
    const backoffMultiplier = config?.backoffMultiplier || 2;

    let lastError: string | undefined;
    let lastCostData: StepCostData | undefined;
    let currentDelay = backoffMs;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.executeStep(step, context);

      // Track cost data from each attempt
      if (result.costData) {
        lastCostData = result.costData;
      }

      if (result.success) {
        return { ...result, retries: attempt };
      }

      lastError = result.error;

      // Don't sleep after the last attempt
      if (attempt < maxAttempts - 1) {
        logger.warn(
          { stepName: step.name, attempt: attempt + 1, maxAttempts, delayMs: currentDelay },
          'Step failed, retrying after delay'
        );
        await this.sleep(currentDelay);
        currentDelay *= backoffMultiplier;
      }
    }

    return {
      success: false,
      error: lastError || 'Unknown error',
      retries: maxAttempts - 1,
      costData: lastCostData,
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
