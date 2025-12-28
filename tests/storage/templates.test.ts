import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateStore } from '../../src/storage/templates.js';

// Mock the logger
vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('TemplateStore', () => {
  let store: TemplateStore;

  beforeEach(() => {
    store = new TemplateStore();
  });

  describe('addTemplate', () => {
    it('should add a custom template', () => {
      const template = store.addTemplate({
        name: 'Test Template',
        description: 'A test template',
        category: 'testing',
        transport: 'stdio',
        command: 'node',
        args: ['test.js'],
        isBuiltIn: false,
      });

      expect(template.id).toBeDefined();
      expect(template.name).toBe('Test Template');
      expect(template.isBuiltIn).toBe(false);
      expect(template.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('addBuiltInTemplate', () => {
    it('should add a built-in template with fixed ID', () => {
      const template = store.addBuiltInTemplate('builtin-test', {
        name: 'Built-in Test',
        description: 'A built-in template',
        category: 'testing',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@test/server'],
      });

      expect(template.id).toBe('builtin-test');
      expect(template.isBuiltIn).toBe(true);
    });
  });

  describe('getTemplate', () => {
    it('should retrieve template by ID', () => {
      const created = store.addTemplate({
        name: 'Test',
        description: 'Test',
        category: 'test',
        transport: 'stdio',
        command: 'test',
        args: [],
        isBuiltIn: false,
      });

      const found = store.getTemplate(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Test');
    });

    it('should return undefined for non-existent template', () => {
      const found = store.getTemplate('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('getAllTemplates', () => {
    it('should return all templates', () => {
      store.addTemplate({
        name: 'Template 1',
        description: 'First',
        category: 'cat1',
        transport: 'stdio',
        command: 'cmd1',
        args: [],
        isBuiltIn: false,
      });
      store.addTemplate({
        name: 'Template 2',
        description: 'Second',
        category: 'cat2',
        transport: 'stdio',
        command: 'cmd2',
        args: [],
        isBuiltIn: false,
      });

      const all = store.getAllTemplates();
      expect(all.length).toBe(2);
    });
  });

  describe('getTemplatesByCategory', () => {
    it('should filter templates by category', () => {
      store.addTemplate({
        name: 'Database Template',
        description: 'DB',
        category: 'database',
        transport: 'stdio',
        command: 'db',
        args: [],
        isBuiltIn: false,
      });
      store.addTemplate({
        name: 'Storage Template',
        description: 'Storage',
        category: 'storage',
        transport: 'stdio',
        command: 'storage',
        args: [],
        isBuiltIn: false,
      });

      const dbTemplates = store.getTemplatesByCategory('database');
      expect(dbTemplates.length).toBe(1);
      expect(dbTemplates[0].name).toBe('Database Template');
    });
  });

  describe('getCategories', () => {
    it('should return unique categories', () => {
      store.addTemplate({
        name: 'T1',
        description: '',
        category: 'cat1',
        transport: 'stdio',
        command: 'c1',
        args: [],
        isBuiltIn: false,
      });
      store.addTemplate({
        name: 'T2',
        description: '',
        category: 'cat2',
        transport: 'stdio',
        command: 'c2',
        args: [],
        isBuiltIn: false,
      });
      store.addTemplate({
        name: 'T3',
        description: '',
        category: 'cat1',
        transport: 'stdio',
        command: 'c3',
        args: [],
        isBuiltIn: false,
      });

      const categories = store.getCategories();
      expect(categories.length).toBe(2);
      expect(categories).toContain('cat1');
      expect(categories).toContain('cat2');
    });
  });

  describe('searchTemplates', () => {
    beforeEach(() => {
      store.addTemplate({
        name: 'PostgreSQL Database',
        description: 'Connect to PostgreSQL',
        category: 'database',
        transport: 'stdio',
        command: 'postgres',
        args: [],
        isBuiltIn: false,
      });
      store.addTemplate({
        name: 'MySQL Database',
        description: 'Connect to MySQL',
        category: 'database',
        transport: 'stdio',
        command: 'mysql',
        args: [],
        isBuiltIn: false,
      });
      store.addTemplate({
        name: 'Filesystem',
        description: 'File access',
        category: 'storage',
        transport: 'stdio',
        command: 'fs',
        args: [],
        isBuiltIn: false,
      });
    });

    it('should search by name', () => {
      const results = store.searchTemplates('postgresql');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('PostgreSQL Database');
    });

    it('should search by description', () => {
      const results = store.searchTemplates('connect');
      expect(results.length).toBe(2);
    });

    it('should search by category', () => {
      const results = store.searchTemplates('storage');
      expect(results.length).toBe(1);
    });

    it('should be case insensitive', () => {
      const results = store.searchTemplates('MYSQL');
      expect(results.length).toBe(1);
    });
  });

  describe('updateTemplate', () => {
    it('should update a custom template', () => {
      const template = store.addTemplate({
        name: 'Original',
        description: 'Original description',
        category: 'test',
        transport: 'stdio',
        command: 'original',
        args: [],
        isBuiltIn: false,
      });

      const updated = store.updateTemplate(template.id, {
        name: 'Updated',
        description: 'Updated description',
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated');
      expect(updated?.description).toBe('Updated description');
    });

    it('should not update a built-in template', () => {
      store.addBuiltInTemplate('builtin-1', {
        name: 'Built-in',
        description: 'Cannot update',
        category: 'test',
        transport: 'stdio',
        command: 'builtin',
        args: [],
      });

      const result = store.updateTemplate('builtin-1', { name: 'Changed' });
      expect(result).toBeNull();
    });

    it('should return null for non-existent template', () => {
      const result = store.updateTemplate('non-existent', { name: 'Changed' });
      expect(result).toBeNull();
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a custom template', () => {
      const template = store.addTemplate({
        name: 'To Delete',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 'delete',
        args: [],
        isBuiltIn: false,
      });

      const deleted = store.deleteTemplate(template.id);
      expect(deleted).toBe(true);
      expect(store.getTemplate(template.id)).toBeUndefined();
    });

    it('should not delete a built-in template', () => {
      store.addBuiltInTemplate('builtin-2', {
        name: 'Cannot Delete',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 'builtin',
        args: [],
      });

      const deleted = store.deleteTemplate('builtin-2');
      expect(deleted).toBe(false);
      expect(store.getTemplate('builtin-2')).toBeDefined();
    });
  });

  describe('instantiate', () => {
    beforeEach(() => {
      store.addBuiltInTemplate('test-template', {
        name: 'Test Server',
        description: 'A test MCP server',
        category: 'testing',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@test/server'],
        env: { DEFAULT_VAR: 'default' },
        envPlaceholders: [
          {
            key: 'API_KEY',
            description: 'API key',
            required: true,
          },
          {
            key: 'OPTIONAL_VAR',
            description: 'Optional variable',
            required: false,
            default: 'optional-default',
          },
        ],
      });
    });

    it('should instantiate a template', () => {
      const config = store.instantiate('test-template', 'My Server', {
        API_KEY: 'my-api-key',
      });

      expect(config).not.toBeNull();
      expect(config?.name).toBe('My Server');
      expect(config?.command).toBe('npx');
      expect(config?.args).toEqual(['-y', '@test/server']);
      expect(config?.env.API_KEY).toBe('my-api-key');
      expect(config?.env.DEFAULT_VAR).toBe('default');
    });

    it('should apply default values for optional placeholders', () => {
      const config = store.instantiate('test-template', 'Server', {
        API_KEY: 'key',
      });

      expect(config?.env.OPTIONAL_VAR).toBe('optional-default');
    });

    it('should return null for non-existent template', () => {
      const config = store.instantiate('non-existent', 'Server', {});
      expect(config).toBeNull();
    });
  });

  describe('getCount', () => {
    it('should return correct counts', () => {
      store.addBuiltInTemplate('b1', {
        name: 'B1',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 'b1',
        args: [],
      });
      store.addBuiltInTemplate('b2', {
        name: 'B2',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 'b2',
        args: [],
      });
      store.addTemplate({
        name: 'C1',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 'c1',
        args: [],
        isBuiltIn: false,
      });

      const counts = store.getCount();
      expect(counts.total).toBe(3);
      expect(counts.builtIn).toBe(2);
      expect(counts.custom).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all templates', () => {
      store.addTemplate({
        name: 'T1',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 't1',
        args: [],
        isBuiltIn: false,
      });
      store.addBuiltInTemplate('b1', {
        name: 'B1',
        description: '',
        category: 'test',
        transport: 'stdio',
        command: 'b1',
        args: [],
      });

      store.clear();

      expect(store.getAllTemplates().length).toBe(0);
    });
  });
});
