/**
 * Step-level cost tracking for workflows
 * Tracks token usage and costs for individual workflow steps
 */

import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'step-cost-tracker' });

/**
 * Token pricing (credits per 1K tokens)
 * Based on typical LLM pricing models
 */
const TOKEN_PRICING = {
  'gpt-4-turbo': {
    input: 0.01, // $0.01 per 1K input tokens
    output: 0.03, // $0.03 per 1K output tokens
  },
  'gpt-4': {
    input: 0.03,
    output: 0.06,
  },
  'gpt-3.5-turbo': {
    input: 0.0005, // $0.0005 per 1K input tokens
    output: 0.0015, // $0.0015 per 1K output tokens
  },
  'claude-3-opus': {
    input: 0.015,
    output: 0.075,
  },
  'claude-3-sonnet': {
    input: 0.003,
    output: 0.015,
  },
  'claude-3-haiku': {
    input: 0.00025,
    output: 0.00125,
  },
  'claude-3.5-sonnet': {
    input: 0.003,
    output: 0.015,
  },
  'text-embedding-3-small': {
    input: 0.00002,
    output: 0, // Embeddings don't have output tokens
  },
  'text-embedding-3-large': {
    input: 0.00013,
    output: 0,
  },
  default: {
    input: 0.001,
    output: 0.002,
  },
};

export interface StepCostData {
  tokensUsed: number;
  costCredits: number;
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

export class StepCostTracker {
  /**
   * Calculate cost from token usage
   * @param model - Model name (e.g., 'gpt-4-turbo', 'claude-3-sonnet')
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @returns Cost in credits (1 credit = $1 USD)
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number = 0): number {
    const pricing =
      TOKEN_PRICING[model as keyof typeof TOKEN_PRICING] || TOKEN_PRICING.default;

    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Extract token usage from tool result
   * Different tools return token usage in different formats
   */
  extractTokenUsage(result: unknown): {
    inputTokens: number;
    outputTokens: number;
    model?: string;
  } {
    // Handle MCP tool responses that may contain usage metadata
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;

      // Check for OpenAI-style usage object
      if (obj.usage && typeof obj.usage === 'object') {
        const usage = obj.usage as Record<string, unknown>;
        return {
          inputTokens: (usage.prompt_tokens as number) || 0,
          outputTokens: (usage.completion_tokens as number) || 0,
          model: (obj.model as string) || undefined,
        };
      }

      // Check for Claude/Anthropic-style usage
      if (obj.usage && typeof obj.usage === 'object') {
        const usage = obj.usage as Record<string, unknown>;
        return {
          inputTokens: (usage.input_tokens as number) || 0,
          outputTokens: (usage.output_tokens as number) || 0,
          model: (obj.model as string) || undefined,
        };
      }

      // Check for direct token counts
      if ('tokens_used' in obj || 'tokensUsed' in obj) {
        return {
          inputTokens: ((obj.tokens_used || obj.tokensUsed) as number) || 0,
          outputTokens: 0,
          model: (obj.model as string) || undefined,
        };
      }
    }

    // No token usage found
    return { inputTokens: 0, outputTokens: 0 };
  }

  /**
   * Track cost for a workflow step
   * Returns cost data to be stored with the step execution
   */
  trackStepCost(
    stepName: string,
    stepType: string,
    result: unknown,
    durationMs: number
  ): StepCostData {
    // Extract token usage from result
    const { inputTokens, outputTokens, model } = this.extractTokenUsage(result);

    // Calculate cost if we have token data
    let costCredits = 0;
    let modelName = model;

    if (inputTokens > 0 || outputTokens > 0) {
      // Determine model name
      if (!modelName) {
        // Try to infer model from step type or default
        modelName = this.inferModel(stepType);
      }

      costCredits = this.calculateCost(modelName, inputTokens, outputTokens);

      logger.debug(
        {
          stepName,
          inputTokens,
          outputTokens,
          model: modelName,
          cost: costCredits,
        },
        'Step cost calculated'
      );
    }

    return {
      tokensUsed: inputTokens + outputTokens,
      costCredits,
      modelName,
      inputTokens,
      outputTokens,
      durationMs,
    };
  }

  /**
   * Infer model name from step type
   */
  private inferModel(stepType: string): string {
    // Default models for different step types
    const defaults: Record<string, string> = {
      tool: 'gpt-3.5-turbo', // Most tools use GPT-3.5
      prompt: 'gpt-4-turbo', // Prompts typically use GPT-4
      resource: 'text-embedding-3-small', // Resources might use embeddings
    };

    return defaults[stepType] || 'default';
  }

  /**
   * Aggregate costs from multiple steps
   */
  aggregateCosts(steps: StepCostData[]): {
    totalTokens: number;
    totalCost: number;
    totalDuration: number;
    modelBreakdown: Record<string, { tokens: number; cost: number }>;
  } {
    let totalTokens = 0;
    let totalCost = 0;
    let totalDuration = 0;
    const modelBreakdown: Record<string, { tokens: number; cost: number }> = {};

    for (const step of steps) {
      totalTokens += step.tokensUsed;
      totalCost += step.costCredits;
      totalDuration += step.durationMs;

      if (step.modelName) {
        if (!modelBreakdown[step.modelName]) {
          modelBreakdown[step.modelName] = { tokens: 0, cost: 0 };
        }
        modelBreakdown[step.modelName].tokens += step.tokensUsed;
        modelBreakdown[step.modelName].cost += step.costCredits;
      }
    }

    return {
      totalTokens,
      totalCost,
      totalDuration,
      modelBreakdown,
    };
  }
}

// Singleton instance
export const stepCostTracker = new StepCostTracker();
