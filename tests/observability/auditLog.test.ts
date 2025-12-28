import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AuditLogger, type AuditAction } from '../../src/observability/auditLog.js';

// Mock the logger
vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('AuditLogger', () => {
  let db: Database.Database;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    db = new Database(':memory:');
    auditLogger = new AuditLogger(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('log', () => {
    it('should create an audit entry', () => {
      const entry = auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'server-123',
        details: { name: 'Test Server' },
        apiKeyId: 'key-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        durationMs: 100,
        success: true,
      });

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.action).toBe('server.create');
      expect(entry.resourceType).toBe('server');
      expect(entry.resourceId).toBe('server-123');
      expect(entry.details).toEqual({ name: 'Test Server' });
      expect(entry.apiKeyId).toBe('key-123');
      expect(entry.ipAddress).toBe('192.168.1.1');
      expect(entry.success).toBe(true);
    });

    it('should handle null optional fields', () => {
      const entry = auditLogger.log({
        action: 'tool.invoke',
        resourceType: 'tool',
        resourceId: 'my-tool',
        details: {},
        apiKeyId: null,
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });

      expect(entry.apiKeyId).toBeNull();
      expect(entry.ipAddress).toBeNull();
      expect(entry.userAgent).toBeNull();
      expect(entry.durationMs).toBeNull();
    });
  });

  describe('logServerAction', () => {
    it('should log server create action', () => {
      const entry = auditLogger.logServerAction(
        'server.create',
        'server-456',
        { name: 'New Server', url: 'http://example.com' },
        { apiKeyId: 'key-1', ipAddress: '10.0.0.1' }
      );

      expect(entry.action).toBe('server.create');
      expect(entry.resourceType).toBe('server');
      expect(entry.resourceId).toBe('server-456');
      expect(entry.details.name).toBe('New Server');
      expect(entry.apiKeyId).toBe('key-1');
    });

    it('should log server connect action', () => {
      const entry = auditLogger.logServerAction('server.connect', 'server-789', { status: 'connected' });

      expect(entry.action).toBe('server.connect');
      expect(entry.success).toBe(true);
    });
  });

  describe('logToolInvocation', () => {
    it('should log successful tool invocation', () => {
      const entry = auditLogger.logToolInvocation(
        'my-tool',
        'server-1',
        true,
        150,
        { params: { arg1: 'value1' } },
        { apiKeyId: 'key-abc' }
      );

      expect(entry.action).toBe('tool.invoke.success');
      expect(entry.resourceType).toBe('tool');
      expect(entry.resourceId).toBe('my-tool');
      expect(entry.durationMs).toBe(150);
      expect(entry.success).toBe(true);
      expect(entry.details.serverId).toBe('server-1');
    });

    it('should log failed tool invocation', () => {
      const entry = auditLogger.logToolInvocation(
        'failing-tool',
        'server-2',
        false,
        50,
        { error: 'Connection timeout' }
      );

      expect(entry.action).toBe('tool.invoke.failure');
      expect(entry.success).toBe(false);
      expect(entry.details.error).toBe('Connection timeout');
    });
  });

  describe('logAuthAttempt', () => {
    it('should log successful auth', () => {
      const entry = auditLogger.logAuthAttempt(
        true,
        'key-auth',
        { endpoint: '/api/tools' },
        { ipAddress: '192.168.1.100' }
      );

      expect(entry.action).toBe('auth.success');
      expect(entry.resourceType).toBe('auth');
      expect(entry.apiKeyId).toBe('key-auth');
      expect(entry.success).toBe(true);
    });

    it('should log failed auth', () => {
      const entry = auditLogger.logAuthAttempt(
        false,
        null,
        { reason: 'Invalid API key' }
      );

      expect(entry.action).toBe('auth.failure');
      expect(entry.apiKeyId).toBeNull();
      expect(entry.success).toBe(false);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Add some test entries
      auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: {},
        apiKeyId: 'key-1',
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });
      auditLogger.log({
        action: 'server.update',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: {},
        apiKeyId: 'key-1',
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });
      auditLogger.log({
        action: 'tool.invoke.success',
        resourceType: 'tool',
        resourceId: 'tool-1',
        details: {},
        apiKeyId: 'key-2',
        ipAddress: null,
        userAgent: null,
        durationMs: 100,
        success: true,
      });
      auditLogger.log({
        action: 'tool.invoke.failure',
        resourceType: 'tool',
        resourceId: 'tool-2',
        details: {},
        apiKeyId: 'key-2',
        ipAddress: null,
        userAgent: null,
        durationMs: 50,
        success: false,
      });
    });

    it('should return all entries by default', () => {
      const entries = auditLogger.query();
      expect(entries.length).toBe(4);
    });

    it('should filter by action', () => {
      const entries = auditLogger.query({ action: 'server.create' });
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('server.create');
    });

    it('should filter by multiple actions', () => {
      const entries = auditLogger.query({
        action: ['server.create', 'server.update'] as AuditAction[],
      });
      expect(entries.length).toBe(2);
    });

    it('should filter by apiKeyId', () => {
      const entries = auditLogger.query({ apiKeyId: 'key-2' });
      expect(entries.length).toBe(2);
      expect(entries.every((e) => e.apiKeyId === 'key-2')).toBe(true);
    });

    it('should filter by resourceType', () => {
      const entries = auditLogger.query({ resourceType: 'tool' });
      expect(entries.length).toBe(2);
    });

    it('should filter by success', () => {
      const failures = auditLogger.query({ success: false });
      expect(failures.length).toBe(1);
      expect(failures[0].action).toBe('tool.invoke.failure');
    });

    it('should respect limit and offset', () => {
      const page1 = auditLogger.query({ limit: 2, offset: 0 });
      const page2 = auditLogger.query({ limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('getById', () => {
    it('should return entry by ID', () => {
      const created = auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: { test: true },
        apiKeyId: null,
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });

      const found = auditLogger.getById(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.details.test).toBe(true);
    });

    it('should return null for non-existent ID', () => {
      const found = auditLogger.getById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      // Add some test entries
      for (let i = 0; i < 5; i++) {
        auditLogger.log({
          action: 'server.create',
          resourceType: 'server',
          resourceId: `srv-${i}`,
          details: {},
          apiKeyId: null,
          ipAddress: null,
          userAgent: null,
          durationMs: null,
          success: true,
        });
      }
      for (let i = 0; i < 3; i++) {
        auditLogger.log({
          action: 'tool.invoke.failure',
          resourceType: 'tool',
          resourceId: `tool-${i}`,
          details: {},
          apiKeyId: null,
          ipAddress: null,
          userAgent: null,
          durationMs: null,
          success: false,
        });
      }
    });

    it('should return correct statistics', () => {
      const stats = auditLogger.getStats();

      expect(stats.totalEntries).toBe(8);
      expect(stats.byAction['server.create']).toBe(5);
      expect(stats.byAction['tool.invoke.failure']).toBe(3);
      expect(stats.byResourceType['server']).toBe(5);
      expect(stats.byResourceType['tool']).toBe(3);
      expect(stats.successRate).toBe(0.63); // 5/8 rounded
    });
  });

  describe('export', () => {
    it('should export as JSON', () => {
      auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: { name: 'Test' },
        apiKeyId: null,
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });

      const json = auditLogger.export();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].resourceId).toBe('srv-1');
    });

    it('should export as CSV', () => {
      auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: {},
        apiKeyId: null,
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });

      const csv = auditLogger.exportCsv();
      const lines = csv.split('\n');

      expect(lines.length).toBe(2); // Header + 1 data row
      expect(lines[0]).toContain('id,timestamp,action');
      expect(lines[1]).toContain('server.create');
    });
  });

  describe('cleanup', () => {
    it('should keep recent entries and delete old ones', () => {
      // Add an entry
      auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: {},
        apiKeyId: null,
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });

      // Cleanup entries older than 90 days (should keep today's entry)
      const deleted = auditLogger.cleanup(90);

      expect(deleted).toBe(0); // Entry is from today, should not be deleted
      expect(auditLogger.query().length).toBe(1);
    });

    it('should return count of deleted entries', () => {
      // Add entries
      auditLogger.log({
        action: 'server.create',
        resourceType: 'server',
        resourceId: 'srv-1',
        details: {},
        apiKeyId: null,
        ipAddress: null,
        userAgent: null,
        durationMs: null,
        success: true,
      });

      // Cleanup with future date offset won't delete recent entries
      const deleted = auditLogger.cleanup(365);
      expect(deleted).toBe(0);
    });
  });
});
