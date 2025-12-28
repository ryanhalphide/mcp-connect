import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { templatesApi } from '../../src/api/templates.js';
import { templateStore } from '../../src/storage/templates.js';

// Mock dependencies
vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/storage/db.js', () => ({
  serverDatabase: {
    saveServer: vi.fn().mockReturnValue({
      id: 'server-123',
      name: 'Test Server',
      description: 'Test',
      transport: { type: 'stdio', command: 'test', args: [] },
      enabled: true,
    }),
  },
}));

vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    connect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    registerServer: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Templates API', () => {
  let app: Hono;

  beforeAll(() => {
    // Clear and add test templates
    templateStore.clear();

    // Add a built-in template
    templateStore.addBuiltInTemplate('builtin-test', {
      name: 'Test Built-in',
      description: 'A built-in test template',
      category: 'testing',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@test/server'],
      envPlaceholders: [
        {
          key: 'API_KEY',
          description: 'Test API key',
          required: true,
        },
      ],
    });
  });

  afterAll(() => {
    templateStore.clear();
  });

  beforeEach(() => {
    app = new Hono();
    app.route('/api/templates', templatesApi);
  });

  describe('GET /api/templates', () => {
    it('should return all templates', async () => {
      const res = await app.request('/api/templates');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.templates).toBeDefined();
      expect(json.data.categories).toBeDefined();
    });

    it('should filter by category', async () => {
      const res = await app.request('/api/templates?category=testing');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.templates.every((t: { category: string }) => t.category === 'testing')).toBe(true);
    });

    it('should search templates', async () => {
      const res = await app.request('/api/templates?search=built-in');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.templates.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/templates/categories', () => {
    it('should return all categories with counts', async () => {
      const res = await app.request('/api/templates/categories');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.categories).toBeDefined();
      expect(Array.isArray(json.data.categories)).toBe(true);
    });
  });

  describe('GET /api/templates/stats', () => {
    it('should return template statistics', async () => {
      const res = await app.request('/api/templates/stats');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.total).toBeDefined();
      expect(json.data.builtIn).toBeDefined();
      expect(json.data.custom).toBeDefined();
      expect(json.data.categoryCount).toBeDefined();
    });
  });

  describe('GET /api/templates/:id', () => {
    it('should return a specific template', async () => {
      const res = await app.request('/api/templates/builtin-test');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('builtin-test');
      expect(json.data.name).toBe('Test Built-in');
    });

    it('should return 404 for non-existent template', async () => {
      const res = await app.request('/api/templates/non-existent');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.success).toBe(false);
    });
  });

  describe('POST /api/templates', () => {
    it('should create a custom template', async () => {
      const newTemplate = {
        name: 'Custom Template',
        description: 'A custom test template',
        category: 'custom',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      };

      const res = await app.request('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTemplate),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Custom Template');
      expect(json.data.isBuiltIn).toBe(false);
    });

    it('should validate required fields', async () => {
      const invalidTemplate = {
        name: '', // Invalid: empty name
        description: 'Test',
        category: 'test',
        transport: 'stdio',
        command: 'test',
        args: [],
      };

      const res = await app.request('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidTemplate),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe('PUT /api/templates/:id', () => {
    let customTemplateId: string;

    beforeEach(async () => {
      // Create a custom template to update
      const template = templateStore.addTemplate({
        name: 'To Update',
        description: 'Will be updated',
        category: 'test',
        transport: 'stdio',
        command: 'test',
        args: [],
        isBuiltIn: false,
      });
      customTemplateId = template.id;
    });

    it('should update a custom template', async () => {
      const res = await app.request(`/api/templates/${customTemplateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Name');
    });

    it('should not update a built-in template', async () => {
      const res = await app.request('/api/templates/builtin-test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Attempted Change' }),
      });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await app.request('/api/templates/non-existent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/templates/:id', () => {
    let customTemplateId: string;

    beforeEach(async () => {
      const template = templateStore.addTemplate({
        name: 'To Delete',
        description: 'Will be deleted',
        category: 'test',
        transport: 'stdio',
        command: 'test',
        args: [],
        isBuiltIn: false,
      });
      customTemplateId = template.id;
    });

    it('should delete a custom template', async () => {
      const res = await app.request(`/api/templates/${customTemplateId}`, {
        method: 'DELETE',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
    });

    it('should not delete a built-in template', async () => {
      const res = await app.request('/api/templates/builtin-test', {
        method: 'DELETE',
      });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await app.request('/api/templates/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/templates/:id/instantiate', () => {
    it('should create a server from template', async () => {
      const res = await app.request('/api/templates/builtin-test/instantiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Test Server',
          env: { API_KEY: 'test-key-123' },
          enabled: true,
          autoConnect: false,
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.data.server).toBeDefined();
      expect(json.data.template).toBeDefined();
    });

    it('should return 404 for non-existent template', async () => {
      const res = await app.request('/api/templates/non-existent/instantiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });

    it('should validate instantiation request', async () => {
      const res = await app.request('/api/templates/builtin-test/instantiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }), // Invalid: empty name
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });
});
