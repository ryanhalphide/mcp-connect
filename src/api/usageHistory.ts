import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { usageHistoryStore } from '../storage/usageHistory.js';
import { toolRegistry } from '../core/registry.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-usage-history' });

export const usageHistoryApi = new Hono();

// Helper to create API response
function apiResponse<T>(data: T, success = true): ApiResponse<T> {
  return {
    success,
    data,
    timestamp: new Date().toISOString(),
  };
}

function errorResponse(error: string): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Extract API key ID from context (set by auth middleware)
function getApiKeyId(c: any): string | null {
  return c.get('apiKeyId') || null;
}

// GET /usage/recent - Get recent tool usage for the current API key
usageHistoryApi.get('/recent', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const limit = parseInt(c.req.query('limit') || '50', 10);
  const usage = usageHistoryStore.getRecentUsage(apiKeyId, Math.min(limit, 100));

  // Enhance with tool details
  const enhanced = usage.map((record) => {
    const tool = toolRegistry.findTool(record.toolName);
    return {
      ...record,
      tool: tool
        ? {
            name: tool.name,
            serverName: tool.serverName,
            description: tool.description,
            category: tool.category,
          }
        : null,
    };
  });

  return c.json(apiResponse({
    usage: enhanced,
    count: enhanced.length,
  }));
});

// GET /usage/tools/recent - Get recently used tools
usageHistoryApi.get('/tools/recent', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const limit = parseInt(c.req.query('limit') || '10', 10);
  const recentTools = usageHistoryStore.getRecentlyUsedTools(apiKeyId, Math.min(limit, 50));

  // Enhance with tool details
  const enhanced = recentTools.map((item) => {
    const tool = toolRegistry.findTool(item.toolName);
    return {
      ...item,
      tool: tool
        ? {
            name: tool.name,
            serverName: tool.serverName,
            description: tool.description,
            category: tool.category,
          }
        : null,
    };
  });

  return c.json(apiResponse({
    tools: enhanced,
    count: enhanced.length,
  }));
});

// GET /usage/tools/most-used - Get most frequently used tools
usageHistoryApi.get('/tools/most-used', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const limit = parseInt(c.req.query('limit') || '10', 10);
  const mostUsed = usageHistoryStore.getMostUsedTools(apiKeyId, Math.min(limit, 50));

  // Enhance with tool details
  const enhanced = mostUsed.map((item) => {
    const tool = toolRegistry.findTool(item.toolName);
    return {
      ...item,
      tool: tool
        ? {
            name: tool.name,
            serverName: tool.serverName,
            description: tool.description,
            category: tool.category,
          }
        : null,
    };
  });

  return c.json(apiResponse({
    tools: enhanced,
    count: enhanced.length,
  }));
});

// GET /usage/stats - Get usage statistics for the current API key
usageHistoryApi.get('/stats', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : undefined;

  if (sinceParam && isNaN(since!.getTime())) {
    c.status(400);
    return c.json(errorResponse('Invalid date format for "since" parameter'));
  }

  const stats = usageHistoryStore.getUsageStats(apiKeyId, since);

  return c.json(apiResponse(stats));
});

// GET /usage/global - Get global usage statistics (admin view)
usageHistoryApi.get('/global', (c) => {
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : undefined;

  if (sinceParam && isNaN(since!.getTime())) {
    c.status(400);
    return c.json(errorResponse('Invalid date format for "since" parameter'));
  }

  const stats = usageHistoryStore.getGlobalStats(since);

  return c.json(apiResponse(stats));
});

// GET /usage/tool/:toolName - Get usage history for a specific tool
usageHistoryApi.get('/tool/:toolName{.+}', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const toolName = c.req.param('toolName');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const allUsers = c.req.query('all') === 'true';

  const history = usageHistoryStore.getToolHistory(
    toolName,
    allUsers ? undefined : apiKeyId,
    Math.min(limit, 100)
  );

  // Get tool details
  const tool = toolRegistry.findTool(toolName);

  return c.json(apiResponse({
    toolName,
    tool: tool
      ? {
          name: tool.name,
          serverName: tool.serverName,
          description: tool.description,
          category: tool.category,
        }
      : null,
    history,
    count: history.length,
  }));
});

// DELETE /usage - Clear usage history for the current API key
usageHistoryApi.delete('/', (c) => {
  const apiKeyId = getApiKeyId(c);
  if (!apiKeyId) {
    c.status(401);
    return c.json(errorResponse('API key required'));
  }

  const olderThanParam = c.req.query('olderThan');
  const olderThan = olderThanParam ? new Date(olderThanParam) : undefined;

  if (olderThanParam && isNaN(olderThan!.getTime())) {
    c.status(400);
    return c.json(errorResponse('Invalid date format for "olderThan" parameter'));
  }

  const count = usageHistoryStore.clearHistory(apiKeyId, olderThan);

  logger.info({ apiKeyId, count, olderThan }, 'Usage history cleared');

  return c.json(apiResponse({ cleared: true, count }));
});
