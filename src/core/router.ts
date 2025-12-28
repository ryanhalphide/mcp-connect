import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolResult } from './types.js';
import { connectionPool } from './pool.js';
import { toolRegistry } from './registry.js';
import { rateLimiter, RateLimitExceededError } from './rateLimiter.js';
import { callTool } from '../mcp/client.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'tool-router' });

export interface ToolResultWithRateLimit extends ToolResult {
  rateLimit?: {
    remaining: { perMinute: number; perDay: number };
    resetAt: { minute: string; day: string };
  };
}

export class ToolRouter {
  async invoke(toolName: string, params: Record<string, unknown>): Promise<ToolResultWithRateLimit> {
    const startTime = Date.now();

    logger.info({ toolName, params }, 'Invoking tool');

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

    // Check rate limit
    const rateLimitResult = rateLimiter.consume(toolEntry.serverId);
    if (!rateLimitResult.allowed) {
      const error = new RateLimitExceededError(
        toolEntry.serverId,
        rateLimitResult.retryAfterMs!,
        rateLimitResult.remaining
      );
      logger.warn(
        { toolName, serverId: toolEntry.serverId, retryAfterMs: rateLimitResult.retryAfterMs },
        'Rate limit exceeded'
      );
      return {
        success: false,
        error: error.message,
        serverId: toolEntry.serverId,
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
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
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

      const durationMs = Date.now() - startTime;
      logger.info({ toolName, serverId: toolEntry.serverId, durationMs }, 'Tool invocation successful');

      // Record usage for analytics
      toolRegistry.recordUsage(toolEntry.name);

      return {
        success: true,
        data: result,
        serverId: toolEntry.serverId,
        toolName: toolEntry.name,
        durationMs,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
          },
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error({ toolName, serverId: toolEntry.serverId, error: errorMessage, durationMs }, 'Tool invocation failed');

      return {
        success: false,
        error: errorMessage,
        serverId: toolEntry.serverId,
        toolName: toolEntry.name,
        durationMs,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: {
            minute: rateLimitResult.resetAt.minute.toISOString(),
            day: rateLimitResult.resetAt.day.toISOString(),
          },
        },
      };
    }
  }

  async invokeOnServer(serverId: string, toolName: string, params: Record<string, unknown>): Promise<ToolResultWithRateLimit> {
    const startTime = Date.now();

    logger.info({ serverId, toolName, params }, 'Invoking tool on specific server');

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
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error({ serverId, toolName, error: errorMessage, durationMs }, 'Tool invocation failed');

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
      };
    }
  }

  async invokeBatch(
    invocations: Array<{ toolName: string; params: Record<string, unknown> }>
  ): Promise<ToolResultWithRateLimit[]> {
    logger.info({ count: invocations.length }, 'Invoking batch of tools');

    const results = await Promise.all(
      invocations.map(({ toolName, params }) => this.invoke(toolName, params))
    );

    const successCount = results.filter((r) => r.success).length;
    logger.info({ total: invocations.length, success: successCount }, 'Batch invocation complete');

    return results;
  }
}

// Singleton instance
export const toolRouter = new ToolRouter();
