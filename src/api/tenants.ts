/**
 * Tenant Management API
 * REST endpoints for managing tenants in multi-tenant deployments
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { serverDatabase } from '../storage/db.js';
import { TenantManager } from '../tenancy/tenantManager.js';
import { checkPermission } from '../rbac/enforcer.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'tenants-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string) {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

export const tenantsApi = new Hono();

// Initialize tenant manager
const db = serverDatabase.getDatabase();
const tenantManager = new TenantManager(db);

/**
 * List all tenants
 * GET /api/tenants
 */
tenantsApi.get('/', checkPermission('tenants:read'), (c) => {
  const enabled = c.req.query('enabled');
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const options: { enabled?: boolean; limit: number; offset: number } = {
    limit,
    offset,
  };

  if (enabled !== undefined) {
    options.enabled = enabled === 'true';
  }

  const result = tenantManager.listTenants(options);

  logger.info({ count: result.tenants.length, total: result.total }, 'Listed tenants');

  return c.json(
    apiResponse({
      tenants: result.tenants,
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    })
  );
});

/**
 * Create a new tenant
 * POST /api/tenants
 */
tenantsApi.post('/', checkPermission('tenants:write'), async (c) => {
  const bodySchema = z.object({
    name: z.string().min(1).max(100),
    metadata: z.record(z.unknown()).optional().default({}),
  });

  let validated;
  try {
    const body = await c.req.json();
    validated = bodySchema.parse(body);
  } catch (error) {
    return c.json(
      apiResponse({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error instanceof z.ZodError ? error.errors : undefined,
      }),
      400
    );
  }

  try {
    const tenant = tenantManager.createTenant(validated.name, validated.metadata);
    logger.info({ tenantId: tenant.id, name: tenant.name }, 'Tenant created via API');
    return c.json(apiResponse(tenant), 201);
  } catch (error) {
    logger.error({ name: validated.name, error }, 'Failed to create tenant');
    return c.json(
      apiResponse({
        error: 'Failed to create tenant',
        code: 'CREATION_FAILED',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      500
    );
  }
});

/**
 * Get tenant by ID
 * GET /api/tenants/:id
 */
tenantsApi.get('/:id', checkPermission('tenants:read'), (c) => {
  const { id } = c.req.param();

  const tenant = tenantManager.getTenant(id);

  if (!tenant) {
    return c.json(
      apiResponse({
        error: 'Tenant not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  return c.json(apiResponse(tenant));
});

/**
 * Update tenant
 * PUT /api/tenants/:id
 */
tenantsApi.put('/:id', checkPermission('tenants:write'), async (c) => {
  const { id } = c.req.param();

  const bodySchema = z.object({
    name: z.string().min(1).max(100).optional(),
    metadata: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  });

  let validated;
  try {
    const body = await c.req.json();
    validated = bodySchema.parse(body);
  } catch (error) {
    return c.json(
      apiResponse({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error instanceof z.ZodError ? error.errors : undefined,
      }),
      400
    );
  }

  const success = tenantManager.updateTenant(id, validated);

  if (!success) {
    return c.json(
      apiResponse({
        error: 'Tenant not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  const updated = tenantManager.getTenant(id);
  logger.info({ tenantId: id, updates: validated }, 'Tenant updated via API');

  return c.json(apiResponse(updated));
});

/**
 * Delete tenant
 * DELETE /api/tenants/:id
 */
tenantsApi.delete('/:id', checkPermission('tenants:write'), (c) => {
  const { id } = c.req.param();

  const success = tenantManager.deleteTenant(id);

  if (!success) {
    return c.json(
      apiResponse({
        error: 'Tenant not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  logger.info({ tenantId: id }, 'Tenant deleted via API');

  return c.json(apiResponse({ message: 'Tenant deleted successfully' }));
});

/**
 * Get tenant usage statistics
 * GET /api/tenants/:id/usage
 */
tenantsApi.get('/:id/usage', checkPermission('tenants:read'), (c) => {
  const { id } = c.req.param();
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const usage = tenantManager.getTenantUsage(id, { startDate, endDate });

  if (!usage) {
    return c.json(
      apiResponse({
        error: 'Tenant not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  logger.info({ tenantId: id, period: usage.period }, 'Retrieved tenant usage');

  return c.json(apiResponse(usage));
});

/**
 * Get API keys for a tenant
 * GET /api/tenants/:id/keys
 */
tenantsApi.get('/:id/keys', checkPermission('tenants:read'), (c) => {
  const { id } = c.req.param();

  // Verify tenant exists
  const tenant = tenantManager.getTenant(id);
  if (!tenant) {
    return c.json(
      apiResponse({
        error: 'Tenant not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  const keys = tenantManager.getTenantApiKeys(id);

  return c.json(
    apiResponse({
      tenantId: id,
      tenantName: tenant.name,
      apiKeys: keys,
      count: keys.length,
    })
  );
});

/**
 * Assign API key to tenant
 * POST /api/tenants/:id/keys
 */
tenantsApi.post('/:id/keys', checkPermission('tenants:write'), async (c) => {
  const { id } = c.req.param();

  const bodySchema = z.object({
    apiKeyId: z.string(),
  });

  let validated;
  try {
    const body = await c.req.json();
    validated = bodySchema.parse(body);
  } catch (error) {
    return c.json(
      apiResponse({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error instanceof z.ZodError ? error.errors : undefined,
      }),
      400
    );
  }

  const success = tenantManager.assignApiKeyToTenant(validated.apiKeyId, id);

  if (!success) {
    return c.json(
      apiResponse({
        error: 'Failed to assign API key to tenant',
        code: 'ASSIGNMENT_FAILED',
      }),
      400
    );
  }

  logger.info({ tenantId: id, apiKeyId: validated.apiKeyId }, 'API key assigned to tenant');

  return c.json(apiResponse({ message: 'API key assigned successfully' }));
});

/**
 * Remove API key from tenant
 * DELETE /api/tenants/:id/keys/:keyId
 */
tenantsApi.delete('/:id/keys/:keyId', checkPermission('tenants:write'), (c) => {
  const { keyId } = c.req.param();

  const success = tenantManager.removeApiKeyFromTenant(keyId);

  if (!success) {
    return c.json(
      apiResponse({
        error: 'API key not found',
        code: 'NOT_FOUND',
      }),
      404
    );
  }

  logger.info({ apiKeyId: keyId }, 'API key removed from tenant');

  return c.json(apiResponse({ message: 'API key removed from tenant successfully' }));
});
