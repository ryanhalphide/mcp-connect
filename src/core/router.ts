import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolResult } from './types.js';
import { connectionPool } from './pool.js';
import { toolRegistry } from './registry.js';
import { rateLimiter, RateLimitExceededError } from './rateLimiter.js';
import { getEnhancedRateLimiter } from './rateLimiterFactory.js';
import { getServerRateLimitConfig } from './rateLimiterEnhanced.js';
import { getCache } from './cacheFactory.js';
import { circuitBreakerRegistry, CircuitBreakerOpenError } from './circuitBreaker.js';
import { getEnhancedCircuitBreaker } from './circuitBreakerFactory.js';
import { callTool } from '../mcp/client.js';
import { createChildLogger } from '../observability/logger.js';
import { serverDatabase } from '../storage/db.js';

const logger = createChildLogger({ module: 'tool-router' });

export interface ToolResultWithRateLimit extends ToolResult {
  rateLimit?: {
    remaining: { perMinute: number; perDay: number };
    resetAt: { minute: string; day: string };
  };
  circuitBreaker?: {
    state: string;
    retryAfterMs?: number;
  };
}

export class ToolRouter {
  async invoke(
    toolName: string,
    params: Record<string, unknown>,
    apiKeyId?: string
  ): Promise<ToolResultWithRateLimit> {
    const startTime = Date.now();

    logger.info({ toolName, params, apiKeyId }, 'Invoking tool');

    // Find the tool in the registry
    const toolEntry = toolRegistry.findTool(toolName);
    if (!toolEntry) {
      const error = `Tool not found: ${toolName}`;
      logger.warn({ toolName }, error);
      return {
        success: false,
        error,
        serverId: '',
        toolName,
        durationMs: Date.now() - startTime,
      };
    }

    // Check circuit breaker first - use enhanced breaker if available
    let breaker;
    try {
      const enhancedBreakers = getEnhancedCircuitBreaker();
      breaker = enhancedBreakers.getBreaker(toolEntry.serverId);
    } catch (error) {
      // Fall back to legacy circuit breaker if enhanced not initialized
      logger.debug({ error }, 'Enhanced circuit breaker not available, using legacy');
      breaker = circuitBreakerRegistry.getBreaker(toolEntry.serverId);
    }

    if (!breaker.canExecute()) {
      const retryAfterMs = breaker.getTimeUntilRetry();
      const error = new CircuitBreakerOpenError(toolEntry.serverId, retryAfterMs);
      logger.warn(
        { toolName, serverId: toolEntry.serverId, retryAfterMs },
        'Circuit breaker is open'
      );
      return {
        success: false,
        error: error.message,
        serverId: toolEntry.serverId,
        toolName,
        durationMs: Date.now() - startTime,
        circuitBreaker: {
          state: 'OPEN',
          retryAfterMs,
        },
      };
    }

    // Check rate limit - use enhanced limiter if API key provided
    let rateLimitResult: {
      allowed: boolean;
      minuteRemaining: number;
      minuteResetAt: number;
      dayRemaining: number;
      dayResetAt: number;
      retryAfterMs?: number;
    };

    if (apiKeyId) {
      try {
        const enhancedLimiter = getEnhancedRateLimiter();
        const server = serverDatabase.getServer(toolEntry.serverId);
        const config = server ? getServerRateLimitConfig(server) : undefined;

        const result = enhancedLimiter.checkLimit(apiKeyId, toolEntry.serverId, config);

        rateLimitResult = {
          allowed: result.allowed,
          minuteRemaining: result.minuteRemaining,
          minuteResetAt: result.minuteResetAt,
          dayRemaining: result.dayRemaining,
          dayResetAt: result.dayResetAt,
          retryAfterMs: result.allowed ? undefined : Math.max(result.minuteResetAt - Date.now(), 0),
        };
      } catch (error) {
        // Fall back to old rate limiter if enhanced limiter not initialized
        logger.warn({ error }, 'Enhanced rate limiter not available, falling back to legacy limiter');
        const oldResult = rateLimiter.consume(toolEntry.serverId);
        rateLimitResult = {
          allowed: oldResult.allowed,
          minuteRemaining: oldResult.remaining.perMinute,
          minuteResetAt: oldResult.resetAt.minute.getTime(),
          dayRemaining: oldResult.remaining.perDay,
          dayResetAt: oldResult.resetAt.day.getTime(),
          retryAfterMs: oldResult.retryAfterMs,
        };
      }
    } else {
      // No API key - use old rate limiter (per-server only)
      const oldResult = rateLimiter.consume(toolEntry.serverId);
      rateLimitResult = {
        allowed: oldResult.allowed,
        minuteRemaining: oldResult.remaining.perMinute,
        minuteResetAt: oldResult.resetAt.minute.getTime(),
        dayRemaining: oldResult.remaining.perDay,
        dayResetAt: oldResult.resetAt.day.getTime(),
        retryAfterMs: oldResult.retryAfterMs,
      };
    }

    if (!rateLimitResult.allowed) {
      const error = new RateLimitExceededError(
        toolEntry.serverId,
        rateLimitResult.retryAfterMs!,
        {
          perMinute: rateLimitResult.minuteRemaining,
          perDay: rateLimitResult.dayRemaining,
        }
      );
      logger.warn(
        { toolName, serverId: toolEntry.serverId, apiKeyId, retryAfterMs: rateLimitResult.retryAfterMs },
        'Rate limit exceeded'
      );
      return {
        success: false,
        error: error.message,
        serverId: toolEntry.serverId,
        toolName,
        durationMs: Date.now() - startTime,
        rateLimit: {
          remaining: {
            perMinute: rateLimitResult.minuteRemaining,
            perDay: rateLimitResult.dayRemaining,
          },
          resetAt: {
            minute: new Date(rateLimitResult.minuteResetAt).toISOString(),
            day: new Date(rateLimitResult.dayResetAt).toISOString(),
          },
        },
      };
    }

    // Check cache before making the actual call
    let cachedResult: unknown | null = null;
    let cacheHit = false;

    try {
      const cache = getCache();
      cachedResult = await cache.get('tool', toolEntry.serverId, toolEntry.name, params);
      if (cachedResult !== null) {
        cacheHit = true;
        logger.debug({ toolName, serverId: toolEntry.serverId }, 'Cache hit - returning cached response');
      }
    } catch (error) {
      // Cache not available or error - continue without cache
      logger.debug({ error }, 'Cache not available');
    }

    if (cacheHit && cachedResult !== null) {
      // Return cached result
      const durationMs = Date.now() - startTime;

      // Still record success with circuit breaker
      const breaker = circuitBreakerRegistry.getBreaker(toolEntry.serverId);
      breaker.recordSuccess();

      // Record usage for analytics
      toolRegistry.recordUsage(toolEntry.name);

      return {
        success: true,
        data: cachedResult,
        serverId: toolEntry.serverId,
        toolName: toolEntry.name,
        durationMs,
        rateLimit: {
          remaining: {
            perMinute: rateLimitResult.minuteRemaining,
            perDay: rateLimitResult.dayRemaining,
          },
          resetAt: {
            minute: new Date(rateLimitResult.minuteResetAt).toISOString(),
            day: new Date(rateLimitResult.dayResetAt).toISOString(),
          },
        },
        circuitBreaker: {
          state: breaker.getState().state,
        },
      };
    }

    // Get the connection for this server
    const client = connectionPool.getClient(toolEntry.serverId);
    if (!client) {
      const error = `Server ${toolEntry.serverId} is not connected`;
      logger.warn({ toolName, serverId: toolEntry.serverId }, error);
      return {
        success: false,
        error,
        serverId: toolEntry.serverId,
        toolName,
        durationMs: Date.now() - startTime,
        rateLimit: {
          remaining: {
            perMinute: rateLimitResult.minuteRemaining,
            perDay: rateLimitResult.dayRemaining,
          },
          resetAt: {
            minute: new Date(rateLimitResult.minuteResetAt).toISOString(),
            day: new Date(rateLimitResult.dayResetAt).toISOString(),
          },
        },
      };
    }

    try {
      // Extract the actual tool name (without server prefix)
      const actualToolName = toolEntry.name.includes('/')
        ? toolEntry.name.split('/').slice(1).join('/')
        : toolEntry.name;

      const result = await callTool(client as Client, actualToolName, params);

      // Store successful result in cache
      try {
        const cache = getCache();
        const server = serverDatabase.getServer(toolEntry.serverId);
        const cacheTtl = server?.metadata?.cacheTtl || 300; // Default 5 minutes
        await cache.set('tool', toolEntry.serverId, toolEntry.name, result, params, { ttl: cacheTtl });
        logger.debug({ toolName, serverId: toolEntry.serverId, ttl: cacheTtl }, 'Response cached');
      } catch (cacheError) {
        // Log but don't fail the request if caching fails
        logger.warn({ error: cacheError }, 'Failed to cache response');
      }

      const durationMs = Date.now() - startTime;
      logger.info({ toolName, serverId: toolEntry.serverId, durationMs }, 'Tool invocation successful');

      // Record success with circuit breaker
      breaker.recordSuccess();

      // Record usage for analytics
      toolRegistry.recordUsage(toolEntry.name);

      return {
        success: true,
        data: result,
        serverId: toolEntry.serverId,
        toolName: toolEntry.name,
        durationMs,
        rateLimit: {
          remaining: {
            perMinute: rateLimitResult.minuteRemaining,
            perDay: rateLimitResult.dayRemaining,
          },
          resetAt: {
            minute: new Date(rateLimitResult.minuteResetAt).toISOString(),
            day: new Date(rateLimitResult.dayResetAt).toISOString(),
          },
        },
        circuitBreaker: {
          state: breaker.getState().state,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error({ toolName, serverId: toolEntry.serverId, error: errorMessage, durationMs }, 'Tool invocation failed');

      // Record failure with circuit breaker
      breaker.recordFailure();

      return {
        success: false,
        error: errorMessage,
        serverId: toolEntry.serverId,
        toolName: toolEntry.name,
        durationMs,
        rateLimit: {
          remaining: {
            perMinute: rateLimitResult.minuteRemaining,
            perDay: rateLimitResult.dayRemaining,
          },
          resetAt: {
            minute: new Date(rateLimitResult.minuteResetAt).toISOString(),
            day: new Date(rateLimitResult.dayResetAt).toISOString(),
          },
        },
        circuitBreaker: {
          state: breaker.getState().state,
        },
      };
    }
  }

  async invokeOnServer(serverId: string, toolName: string, params: Record<string, unknown>): Promise<ToolResultWithRateLimit> {
    const startTime = Date.now();

    logger.info({ serverId, toolName, params }, 'Invoking tool on specific server');

    // Check circuit breaker first
    const breaker = circuitBreakerRegistry.getBreaker(serverId);
    if (!breaker.canExecute()) {
      const retryAfterMs = breaker.getTimeUntilRetry();
      const error = new CircuitBreakerOpenError(serverId, retryAfterMs);
      logger.warn({ serverId, toolName, retryAfterMs }, 'Circuit breaker is open');
      return {
        success: false,
        error: error.message,
        serverId,
        toolName,
        durationMs: Date.now() - startTime,
        circuitBreaker: {
          state: 'OPEN',
          retryAfterMs,
        },
      };
    }

    // Check rate limit
    const rateLimitResult = rateLimiter.consume(serverId);
    if (!rateLimitResult.allowed) {
      const error = new RateLimitExceededError(
        serverId,
        rateLimitResult.retryAfterMs!,
        rateLimitResult.remaining
      );
      logger.warn({ serverId, toolName, retryAfterMs: rateLimitResult.retryAfterMs }, 'Rate limit exceeded');
      return {
        success: false,
        error: error.message,
        serverId,
        toolName,
        durationMs: Date.now() - startTime,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
          },
        },
      };
    }

    const client = connectionPool.getClient(serverId);
    if (!client) {
      const error = `Server ${serverId} is not connected`;
      logger.warn({ serverId, toolName }, error);
      return {
        success: false,
        error,
        serverId,
        toolName,
        durationMs: Date.now() - startTime,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
          },
        },
      };
    }

    try {
      const result = await callTool(client as Client, toolName, params);

      const durationMs = Date.now() - startTime;
      logger.info({ serverId, toolName, durationMs }, 'Tool invocation successful');

      // Record success with circuit breaker
      breaker.recordSuccess();

      return {
        success: true,
        data: result,
        serverId,
        toolName,
        durationMs,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
          },
        },
        circuitBreaker: {
          state: breaker.getState().state,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error({ serverId, toolName, error: errorMessage, durationMs }, 'Tool invocation failed');

      // Record failure with circuit breaker
      breaker.recordFailure();

      return {
        success: false,
        error: errorMessage,
        serverId,
        toolName,
        durationMs,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
          },
        },
        circuitBreaker: {
          state: breaker.getState().state,
        },
      };
    }
  }

  async invokeBatch(
    invocations: Array<{ toolName: string; params: Record<string, unknown> }>,
    apiKeyId?: string
  ): Promise<ToolResultWithRateLimit[]> {
    logger.info({ count: invocations.length, apiKeyId }, 'Invoking batch of tools');

    const results = await Promise.all(
      invocations.map(({ toolName, params }) => this.invoke(toolName, params, apiKeyId))
    );

    const successCount = results.filter((r) => r.success).length;
    logger.info({ total: invocations.length, success: successCount }, 'Batch invocation complete');

    return results;
  }
}

// Singleton instance
export const toolRouter = new ToolRouter();
