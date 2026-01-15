import Handlebars from 'handlebars';
import type { ExecutionContext } from './types.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'workflow-context' });

/**
 * LRU Cache for compiled Handlebars templates
 * Avoids recompiling the same template strings repeatedly
 *
 * For workflows with 100+ steps, this can eliminate thousands of
 * redundant Handlebars.compile() calls when steps use similar patterns.
 */
class TemplateCache {
  private cache: Map<string, Handlebars.TemplateDelegate>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get a compiled template, using cache if available
   */
  get(templateString: string): Handlebars.TemplateDelegate {
    let template = this.cache.get(templateString);

    if (template) {
      // Move to end (most recently used) by re-inserting
      this.cache.delete(templateString);
      this.cache.set(templateString, template);
      return template;
    }

    // Compile and cache
    template = Handlebars.compile(templateString);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(templateString, template);
    return template;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number } {
    return { size: this.cache.size, maxSize: this.maxSize };
  }
}

// Shared template cache across all workflow contexts
// This allows templates to be reused across workflow executions
const globalTemplateCache = new TemplateCache(1000);

/**
 * Workflow execution context manager
 * Handles variable interpolation using Handlebars templates
 *
 * Performance optimizations:
 * - Template caching: Compiled Handlebars templates are cached globally
 * - LRU eviction: Old templates are evicted when cache is full
 */
export class WorkflowContext {
  private context: ExecutionContext;
  private templateCache: TemplateCache;

  constructor(input: Record<string, unknown> = {}) {
    this.context = {
      input,
      steps: {},
      env: process.env as Record<string, string>,
    };
    // Use shared global cache for better cross-execution performance
    this.templateCache = globalTemplateCache;
  }

  /**
   * Get the current context
   */
  getContext(): ExecutionContext {
    return this.context;
  }

  /**
   * Set the output of a completed step
   */
  setStepOutput(stepName: string, output: unknown): void {
    this.context.steps[stepName] = {
      ...this.context.steps[stepName],
      output,
    };
  }

  /**
   * Set the error of a failed step
   */
  setStepError(stepName: string, error: string): void {
    this.context.steps[stepName] = {
      ...this.context.steps[stepName],
      error,
    };
  }

  /**
   * Get the output of a specific step
   */
  getStepOutput(stepName: string): unknown {
    return this.context.steps[stepName]?.output;
  }

  /**
   * Interpolate variables in a value using Handlebars
   * Supports: {{ input.fieldName }}, {{ steps.stepName.output.field }}, {{ env.VAR_NAME }}
   *
   * OPTIMIZATION: Uses template cache to avoid recompiling same templates.
   * For 100+ step workflows with similar patterns, this can eliminate
   * thousands of redundant Handlebars.compile() calls.
   */
  interpolate(value: unknown): unknown {
    if (typeof value === 'string') {
      try {
        // Check if the string contains Handlebars expressions
        if (value.includes('{{')) {
          // OPTIMIZATION: Use cached template instead of recompiling
          const template = this.templateCache.get(value);
          const result = template(this.context);

          // Try to parse as JSON if it looks like a JSON structure
          if ((result.startsWith('{') && result.endsWith('}')) ||
              (result.startsWith('[') && result.endsWith(']'))) {
            try {
              return JSON.parse(result);
            } catch {
              return result;
            }
          }

          return result;
        }
        return value;
      } catch (error) {
        logger.error({ value, error }, 'Failed to interpolate value');
        throw new Error(`Template interpolation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (Array.isArray(value)) {
      return value.map((item) => this.interpolate(item));
    } else if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.interpolate(val);
      }
      return result;
    }
    return value;
  }

  /**
   * Get template cache statistics (for debugging/monitoring)
   */
  getTemplateCacheStats(): { size: number; maxSize: number } {
    return this.templateCache.stats();
  }

  /**
   * Evaluate a condition against the current context
   */
  evaluateCondition(condition: {
    type: 'equals' | 'notEquals' | 'contains' | 'exists' | 'gt' | 'lt';
    path: string;
    value?: unknown;
  }): boolean {
    try {
      // Extract value from context using path
      const contextValue = this.getValueByPath(condition.path);

      switch (condition.type) {
        case 'equals':
          return contextValue === condition.value;
        case 'notEquals':
          return contextValue !== condition.value;
        case 'contains':
          if (typeof contextValue === 'string' && typeof condition.value === 'string') {
            return contextValue.includes(condition.value);
          }
          if (Array.isArray(contextValue)) {
            return contextValue.includes(condition.value);
          }
          return false;
        case 'exists':
          return contextValue !== undefined && contextValue !== null;
        case 'gt':
          if (typeof contextValue === 'number' && typeof condition.value === 'number') {
            return contextValue > condition.value;
          }
          return false;
        case 'lt':
          if (typeof contextValue === 'number' && typeof condition.value === 'number') {
            return contextValue < condition.value;
          }
          return false;
        default:
          return false;
      }
    } catch (error) {
      logger.error({ condition, error }, 'Failed to evaluate condition');
      return false;
    }
  }

  /**
   * Get a value from context using a path like "input.user.name" or "steps.fetchData.output.id"
   */
  private getValueByPath(path: string): unknown {
    const parts = path.split('.');
    let current: unknown = this.context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Clone the context
   */
  clone(): WorkflowContext {
    const newContext = new WorkflowContext(this.context.input);
    newContext.context = {
      ...this.context,
      steps: { ...this.context.steps },
      env: { ...this.context.env },
    };
    return newContext;
  }
}
