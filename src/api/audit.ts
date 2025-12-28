import { Hono } from 'hono';
import { z } from 'zod';
import { getAuditLogger, type AuditAction } from '../observability/auditLog.js';
import { createChildLogger } from '../observability/logger.js';
import type { ApiResponse } from '../core/types.js';

const logger = createChildLogger({ module: 'api-audit' });

export const auditApi = new Hono();

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

// Valid audit actions
const VALID_ACTIONS: AuditAction[] = [
  'server.create',
  'server.update',
  'server.delete',
  'server.connect',
  'server.disconnect',
  'tool.invoke',
  'tool.invoke.success',
  'tool.invoke.failure',
  'apikey.create',
  'apikey.update',
  'apikey.delete',
  'apikey.regenerate',
  'group.create',
  'group.update',
  'group.delete',
  'cache.invalidate',
  'cache.clear',
  'circuit.open',
  'circuit.close',
  'circuit.reset',
  'auth.success',
  'auth.failure',
];

// Query schema
const AuditQuerySchema = z.object({
  action: z.string().optional(),
  actions: z.string().optional(), // Comma-separated list
  apiKeyId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  success: z.enum(['true', 'false']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

// GET /audit - Query audit entries
auditApi.get('/', (c) => {
  try {
    const query = c.req.query();
    const parsed = AuditQuerySchema.parse(query);

    let actions: AuditAction[] | undefined;
    if (parsed.actions) {
      actions = parsed.actions.split(',').map((a) => a.trim()) as AuditAction[];
    } else if (parsed.action) {
      actions = [parsed.action as AuditAction];
    }

    const auditLogger = getAuditLogger();
    const entries = auditLogger.query({
      action: actions && actions.length === 1 ? actions[0] : actions,
      apiKeyId: parsed.apiKeyId,
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      success: parsed.success === 'true' ? true : parsed.success === 'false' ? false : undefined,
      startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
      endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
      limit: parsed.limit ?? 100,
      offset: parsed.offset ?? 0,
    });

    return c.json(
      apiResponse({
        entries,
        count: entries.length,
        filters: {
          actions,
          apiKeyId: parsed.apiKeyId,
          resourceType: parsed.resourceType,
          resourceId: parsed.resourceId,
          success: parsed.success,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
        },
      })
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to query audit log');
    c.status(500);
    return c.json(errorResponse('Failed to query audit log'));
  }
});

// GET /audit/:id - Get specific audit entry
auditApi.get('/:id', (c) => {
  try {
    const id = c.req.param('id');
    const auditLogger = getAuditLogger();
    const entry = auditLogger.getById(id);

    if (!entry) {
      c.status(404);
      return c.json(errorResponse(`Audit entry not found: ${id}`));
    }

    return c.json(apiResponse(entry));
  } catch (error) {
    logger.error({ error }, 'Failed to get audit entry');
    c.status(500);
    return c.json(errorResponse('Failed to get audit entry'));
  }
});

// GET /audit/stats - Get audit statistics
auditApi.get('/stats', (c) => {
  try {
    const since = c.req.query('since');
    const sinceDate = since ? new Date(since) : undefined;

    const auditLogger = getAuditLogger();
    const stats = auditLogger.getStats(sinceDate);

    return c.json(apiResponse(stats));
  } catch (error) {
    logger.error({ error }, 'Failed to get audit stats');
    c.status(500);
    return c.json(errorResponse('Failed to get audit statistics'));
  }
});

// GET /audit/export - Export audit entries as JSON
auditApi.get('/export', (c) => {
  try {
    const query = c.req.query();
    const parsed = AuditQuerySchema.parse(query);

    let actions: AuditAction[] | undefined;
    if (parsed.actions) {
      actions = parsed.actions.split(',').map((a) => a.trim()) as AuditAction[];
    } else if (parsed.action) {
      actions = [parsed.action as AuditAction];
    }

    const auditLogger = getAuditLogger();
    const json = auditLogger.export({
      action: actions && actions.length === 1 ? actions[0] : actions,
      apiKeyId: parsed.apiKeyId,
      resourceType: parsed.resourceType,
      startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
      endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
    });

    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', 'attachment; filename="audit-log.json"');
    return c.body(json);
  } catch (error) {
    logger.error({ error }, 'Failed to export audit log');
    c.status(500);
    return c.json(errorResponse('Failed to export audit log'));
  }
});

// GET /audit/export/csv - Export audit entries as CSV
auditApi.get('/export/csv', (c) => {
  try {
    const query = c.req.query();
    const parsed = AuditQuerySchema.parse(query);

    let actions: AuditAction[] | undefined;
    if (parsed.actions) {
      actions = parsed.actions.split(',').map((a) => a.trim()) as AuditAction[];
    } else if (parsed.action) {
      actions = [parsed.action as AuditAction];
    }

    const auditLogger = getAuditLogger();
    const csv = auditLogger.exportCsv({
      action: actions && actions.length === 1 ? actions[0] : actions,
      apiKeyId: parsed.apiKeyId,
      resourceType: parsed.resourceType,
      startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
      endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
    });

    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return c.body(csv);
  } catch (error) {
    logger.error({ error }, 'Failed to export audit log as CSV');
    c.status(500);
    return c.json(errorResponse('Failed to export audit log'));
  }
});

// POST /audit/cleanup - Cleanup old audit entries
auditApi.post('/cleanup', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const olderThanDays = body.olderThanDays ?? 90;

    if (typeof olderThanDays !== 'number' || olderThanDays < 1) {
      c.status(400);
      return c.json(errorResponse('olderThanDays must be a positive number'));
    }

    const auditLogger = getAuditLogger();
    const deletedCount = auditLogger.cleanup(olderThanDays);

    return c.json(
      apiResponse({
        deletedCount,
        message: `Deleted ${deletedCount} entries older than ${olderThanDays} days`,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup audit log');
    c.status(500);
    return c.json(errorResponse('Failed to cleanup audit log'));
  }
});

// GET /audit/actions - List available audit actions
auditApi.get('/actions', (c) => {
  return c.json(
    apiResponse({
      actions: VALID_ACTIONS,
      categories: {
        server: VALID_ACTIONS.filter((a) => a.startsWith('server.')),
        tool: VALID_ACTIONS.filter((a) => a.startsWith('tool.')),
        apikey: VALID_ACTIONS.filter((a) => a.startsWith('apikey.')),
        group: VALID_ACTIONS.filter((a) => a.startsWith('group.')),
        cache: VALID_ACTIONS.filter((a) => a.startsWith('cache.')),
        circuit: VALID_ACTIONS.filter((a) => a.startsWith('circuit.')),
        auth: VALID_ACTIONS.filter((a) => a.startsWith('auth.')),
      },
    })
  );
});
