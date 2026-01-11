import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { serverDatabase } from '../storage/db.js';
import { WorkflowTemplateStore } from '../workflows/workflowTemplateStore.js';
import { WorkflowEngine } from '../workflows/engine.js';
import { createChildLogger } from '../observability/logger.js';
import { checkPermission } from '../rbac/enforcer.js';
import { getAuditLogger } from '../observability/auditLog.js';
import { appEvents } from '../core/events.js';

const logger = createChildLogger({ module: 'workflow-templates-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Helper to extract API key and tenant ID from context
function getContextInfo(c: any): { apiKeyId: string | null; tenantId: string | null } {
  return {
    apiKeyId: c.get('apiKeyId') || null,
    tenantId: c.get('tenantId') || null,
  };
}

export const workflowTemplatesApi = new Hono();

// Validation schemas
const ParameterDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string(),
  required: z.boolean(),
  default: z.unknown().optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      enum: z.array(z.unknown()).optional(),
    })
    .optional(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  description: z.string().optional().default(''),
  category: z.enum(['automation', 'monitoring', 'data-pipeline', 'notification', 'analysis']),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  estimatedCostCredits: z.number().min(0).default(0),
  estimatedDurationMs: z.number().min(0).default(0),
  definition: z.object({
    name: z.string(),
    description: z.string().optional(),
    steps: z.array(z.any()).min(1),
    errorHandling: z
      .object({
        strategy: z.enum(['rollback', 'continue']),
        onError: z.string().optional(),
      })
      .optional(),
    timeout: z.number().optional(),
  }),
  parameterSchema: z.array(ParameterDefinitionSchema).default([]),
});

const ListQuerySchema = z.object({
  category: z.enum(['automation', 'monitoring', 'data-pipeline', 'notification', 'analysis']).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  tags: z.string().optional().transform((val) => (val ? val.split(',') : undefined)),
  isBuiltIn: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const InstantiateSchema = z.object({
  parameters: z.record(z.unknown()),
  createWorkflow: z.boolean().default(false),
  workflowName: z.string().optional(),
});

/**
 * GET /workflow-templates
 * List all workflow templates with optional filters
 */
workflowTemplatesApi.get('/', checkPermission('workflow_templates:read'), (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);

  try {
    const queryParams = c.req.query();
    const validated = ListQuerySchema.parse(queryParams);

    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);

    const templates = store.searchTemplates(validated.search, {
      category: validated.category,
      difficulty: validated.difficulty,
      tags: validated.tags,
      isBuiltIn: validated.isBuiltIn,
      limit: validated.limit,
      offset: validated.offset,
    });

    // Get total count for pagination
    const allTemplates = store.searchTemplates(validated.search, {
      category: validated.category,
      difficulty: validated.difficulty,
      tags: validated.tags,
      isBuiltIn: validated.isBuiltIn,
    });

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.list',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: null,
      details: {
        tenantId,
        count: templates.length,
        filters: {
          category: validated.category,
          difficulty: validated.difficulty,
          tags: validated.tags,
        },
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(
      apiResponse({
        templates,
        total: allTemplates.length,
        limit: validated.limit,
        offset: validated.offset,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to list workflow templates');

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to list templates'),
      500
    );
  }
});

/**
 * GET /workflow-templates/categories
 * Get all categories with template counts
 */
workflowTemplatesApi.get('/categories', checkPermission('workflow_templates:read'), (c) => {
  try {
    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);
    const categories = store.getCategories();

    return c.json(apiResponse({ categories }));
  } catch (error) {
    logger.error({ error }, 'Failed to get template categories');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get categories'),
      500
    );
  }
});

/**
 * GET /workflow-templates/stats
 * Get template usage statistics
 */
workflowTemplatesApi.get('/stats', checkPermission('workflow_templates:read'), (c) => {
  try {
    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);
    const stats = store.getStats();

    return c.json(apiResponse({ stats }));
  } catch (error) {
    logger.error({ error }, 'Failed to get template stats');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get stats'),
      500
    );
  }
});

/**
 * GET /workflow-templates/:id
 * Get a specific workflow template
 */
workflowTemplatesApi.get('/:id', checkPermission('workflow_templates:read'), (c) => {
  try {
    const id = c.req.param('id');
    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);
    const template = store.getTemplate(id);

    if (!template) {
      return c.json(apiResponse(null, false, 'Template not found'), 404);
    }

    return c.json(apiResponse(template));
  } catch (error) {
    logger.error({ error }, 'Failed to get workflow template');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to get template'),
      500
    );
  }
});

/**
 * POST /workflow-templates
 * Create a new custom workflow template
 */
workflowTemplatesApi.post('/', checkPermission('workflow_templates:write'), async (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);

  try {
    const body = await c.req.json();
    const validated = CreateTemplateSchema.parse(body);

    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);

    const template = store.addTemplate({
      ...validated,
      isBuiltIn: false,
    });

    logger.info({ templateId: template.id, name: template.name }, 'Workflow template created');

    // Emit event
    appEvents.emit('workflow_template.created', {
      templateId: template.id,
      templateName: template.name,
    });

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.create',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: template.id,
      details: {
        tenantId,
        name: template.name,
        category: template.category,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(apiResponse(template), 201);
  } catch (error) {
    logger.error({ error }, 'Failed to create workflow template');

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.create',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: null,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to create template'),
      500
    );
  }
});

/**
 * PUT /workflow-templates/:id
 * Update a custom workflow template (not built-in)
 */
workflowTemplatesApi.put('/:id', checkPermission('workflow_templates:write'), async (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);
  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const validated = CreateTemplateSchema.partial().parse(body);

    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);
    const updated = store.updateTemplate(id, validated);

    if (!updated) {
      return c.json(apiResponse(null, false, 'Template not found or is built-in'), 404);
    }

    logger.info({ templateId: id, name: updated.name }, 'Workflow template updated');

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.update',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: id,
      details: {
        tenantId,
        name: updated.name,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(apiResponse(updated));
  } catch (error) {
    logger.error({ error }, 'Failed to update workflow template');

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.update',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: id,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to update template'),
      500
    );
  }
});

/**
 * DELETE /workflow-templates/:id
 * Delete a custom workflow template (not built-in)
 */
workflowTemplatesApi.delete('/:id', checkPermission('workflow_templates:delete'), (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);
  const id = c.req.param('id');

  try {
    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);
    const deleted = store.deleteTemplate(id);

    if (!deleted) {
      return c.json(apiResponse(null, false, 'Template not found or is built-in'), 404);
    }

    logger.info({ templateId: id }, 'Workflow template deleted');

    // Emit event
    appEvents.emit('workflow_template.deleted', {
      templateId: id,
    });

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.delete',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: id,
      details: {
        tenantId,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(apiResponse({ message: 'Template deleted successfully' }));
  } catch (error) {
    logger.error({ error }, 'Failed to delete workflow template');

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.delete',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: id,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to delete template'),
      500
    );
  }
});

/**
 * POST /workflow-templates/:id/instantiate
 * Instantiate a template with parameters to create a workflow definition
 */
workflowTemplatesApi.post('/:id/instantiate', checkPermission('workflow_templates:execute'), async (c) => {
  const startTime = Date.now();
  const { apiKeyId, tenantId } = getContextInfo(c);
  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const validated = InstantiateSchema.parse(body);

    const db = serverDatabase.getDatabase();
    const store = new WorkflowTemplateStore(db);

    // Instantiate the template
    const definition = store.instantiate(id, validated.parameters);

    if (!definition) {
      return c.json(apiResponse(null, false, 'Template not found'), 404);
    }

    // Increment usage count
    store.incrementUsageCount(id);

    let workflow = null;

    // Optionally create a workflow from the definition
    if (validated.createWorkflow) {
      const engine = new WorkflowEngine(db);
      const workflowName = validated.workflowName || definition.name;

      workflow = engine.createWorkflow({
        ...definition,
        name: workflowName,
      });

      logger.info(
        { templateId: id, workflowId: workflow.id, name: workflowName },
        'Workflow created from template'
      );
    }

    // Emit event
    appEvents.emit('workflow_template.instantiated', {
      templateId: id,
      workflowId: workflow?.id,
    });

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.instantiate',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: id,
      details: {
        tenantId,
        createWorkflow: validated.createWorkflow,
        workflowId: workflow?.id,
        parametersProvided: Object.keys(validated.parameters).length,
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return c.json(
      apiResponse({
        definition,
        workflow,
      }),
      201
    );
  } catch (error) {
    logger.error({ error }, 'Failed to instantiate template');

    // Audit log
    getAuditLogger().log({
      action: 'workflow_template.instantiate',
      apiKeyId,
      resourceType: 'workflow_template',
      resourceId: id,
      details: {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      ipAddress: null,
      userAgent: null,
      durationMs: Date.now() - startTime,
      success: false,
    });

    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to instantiate template'),
      500
    );
  }
});
