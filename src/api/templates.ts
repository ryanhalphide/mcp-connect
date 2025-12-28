import { Hono } from 'hono';
import { z } from 'zod';
import { templateStore } from '../storage/templates.js';
import { serverDatabase } from '../storage/db.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { createChildLogger } from '../observability/logger.js';
import type { ApiResponse } from '../core/types.js';

const logger = createChildLogger({ module: 'api-templates' });

export const templatesApi = new Hono();

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

// Create template schema
const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  icon: z.string().optional(),
  category: z.string().min(1).max(50),
  transport: z.enum(['stdio', 'sse']),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  envPlaceholders: z.array(z.object({
    key: z.string(),
    description: z.string(),
    required: z.boolean(),
    default: z.string().optional(),
  })).optional(),
  documentation: z.string().url().optional(),
  npmPackage: z.string().optional(),
});

// Update template schema
const UpdateTemplateSchema = CreateTemplateSchema.partial();

// Instantiate template schema
const InstantiateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional().default(true),
  autoConnect: z.boolean().optional().default(false),
  groupId: z.string().uuid().optional(),
});

// GET /templates - List all templates
templatesApi.get('/', (c) => {
  const category = c.req.query('category');
  const search = c.req.query('search');

  let templates = templateStore.getAllTemplates();

  if (category) {
    templates = templates.filter((t) => t.category === category);
  }

  if (search) {
    templates = templateStore.searchTemplates(search);
  }

  return c.json(
    apiResponse({
      templates,
      count: templates.length,
      categories: templateStore.getCategories(),
    })
  );
});

// GET /templates/categories - List all categories
templatesApi.get('/categories', (c) => {
  const categories = templateStore.getCategories();
  const categoryDetails = categories.map((cat) => ({
    name: cat,
    count: templateStore.getTemplatesByCategory(cat).length,
  }));

  return c.json(apiResponse({ categories: categoryDetails }));
});

// GET /templates/stats - Get template statistics
templatesApi.get('/stats', (c) => {
  const counts = templateStore.getCount();
  const categories = templateStore.getCategories();

  return c.json(
    apiResponse({
      ...counts,
      categoryCount: categories.length,
    })
  );
});

// GET /templates/:id - Get specific template
templatesApi.get('/:id', (c) => {
  const id = c.req.param('id');
  const template = templateStore.getTemplate(id);

  if (!template) {
    c.status(404);
    return c.json(errorResponse(`Template not found: ${id}`));
  }

  return c.json(apiResponse(template));
});

// POST /templates - Create a custom template
templatesApi.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateTemplateSchema.parse(body);

    const template = templateStore.addTemplate({
      ...validated,
      isBuiltIn: false,
    });

    logger.info({ templateId: template.id, name: template.name }, 'Custom template created');

    c.status(201);
    return c.json(apiResponse(template));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to create template');
    c.status(500);
    return c.json(errorResponse('Failed to create template'));
  }
});

// PUT /templates/:id - Update a custom template
templatesApi.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const template = templateStore.getTemplate(id);

    if (!template) {
      c.status(404);
      return c.json(errorResponse(`Template not found: ${id}`));
    }

    if (template.isBuiltIn) {
      c.status(403);
      return c.json(errorResponse('Cannot modify built-in templates'));
    }

    const body = await c.req.json();
    const validated = UpdateTemplateSchema.parse(body);

    const updated = templateStore.updateTemplate(id, validated);

    if (!updated) {
      c.status(500);
      return c.json(errorResponse('Failed to update template'));
    }

    logger.info({ templateId: id }, 'Template updated');
    return c.json(apiResponse(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to update template');
    c.status(500);
    return c.json(errorResponse('Failed to update template'));
  }
});

// DELETE /templates/:id - Delete a custom template
templatesApi.delete('/:id', (c) => {
  const id = c.req.param('id');
  const template = templateStore.getTemplate(id);

  if (!template) {
    c.status(404);
    return c.json(errorResponse(`Template not found: ${id}`));
  }

  if (template.isBuiltIn) {
    c.status(403);
    return c.json(errorResponse('Cannot delete built-in templates'));
  }

  const deleted = templateStore.deleteTemplate(id);

  if (!deleted) {
    c.status(500);
    return c.json(errorResponse('Failed to delete template'));
  }

  logger.info({ templateId: id }, 'Template deleted');
  return c.json(apiResponse({ deleted: true }));
});

// POST /templates/:id/instantiate - Create a server from template
templatesApi.post('/:id/instantiate', async (c) => {
  try {
    const templateId = c.req.param('id');
    const template = templateStore.getTemplate(templateId);

    if (!template) {
      c.status(404);
      return c.json(errorResponse(`Template not found: ${templateId}`));
    }

    const body = await c.req.json();
    const validated = InstantiateTemplateSchema.parse(body);

    // Generate server config from template
    const serverConfig = templateStore.instantiate(templateId, validated.name, validated.env);

    if (!serverConfig) {
      c.status(500);
      return c.json(errorResponse('Failed to instantiate template'));
    }

    // Build transport config based on template transport type
    const transportConfig = serverConfig.transport === 'stdio'
      ? {
          type: 'stdio' as const,
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        }
      : {
          type: 'sse' as const,
          url: serverConfig.command, // For SSE, command is the URL
        };

    // Create the server in the database
    const server = serverDatabase.saveServer({
      name: serverConfig.name,
      description: template.description,
      transport: transportConfig,
      auth: { type: 'none' },
      healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
      rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
      metadata: {
        tags: [template.category, 'template'],
        category: template.category,
        version: '1.0.0',
      },
      enabled: validated.enabled ?? true,
      groupId: validated.groupId ?? null,
    });

    logger.info(
      { serverId: server.id, templateId, name: server.name },
      'Server created from template'
    );

    // Auto-connect if requested
    if (validated.autoConnect && validated.enabled) {
      try {
        await connectionPool.connect(server);
        await toolRegistry.registerServer(server);
        logger.info({ serverId: server.id }, 'Server auto-connected');
      } catch (connectError) {
        logger.error({ serverId: server.id, error: connectError }, 'Failed to auto-connect server');
        // Don't fail the request, server is still created
      }
    }

    c.status(201);
    return c.json(
      apiResponse({
        server,
        template: {
          id: template.id,
          name: template.name,
        },
        autoConnected: validated.autoConnect && validated.enabled,
      })
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }

    logger.error({ error }, 'Failed to instantiate template');
    c.status(500);
    return c.json(errorResponse('Failed to instantiate template'));
  }
});
