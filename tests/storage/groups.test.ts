import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerDatabase } from '../../src/storage/db.js';

describe('ServerDatabase Group Methods', () => {
  let db: ServerDatabase;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = new ServerDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('saveGroup', () => {
    it('should save a new group', () => {
      const group = db.saveGroup({
        name: 'Production',
        description: 'Production servers',
        color: '#22c55e',
        sortOrder: 0,
      });

      expect(group.id).toBeDefined();
      expect(group.name).toBe('Production');
      expect(group.description).toBe('Production servers');
      expect(group.color).toBe('#22c55e');
      expect(group.sortOrder).toBe(0);
      expect(group.createdAt).toBeInstanceOf(Date);
      expect(group.updatedAt).toBeInstanceOf(Date);
    });

    it('should generate unique IDs for each group', () => {
      const group1 = db.saveGroup({ name: 'Group 1' });
      const group2 = db.saveGroup({ name: 'Group 2' });

      expect(group1.id).not.toBe(group2.id);
    });

    it('should set default values', () => {
      const group = db.saveGroup({ name: 'Minimal' });

      expect(group.description).toBe('');
      expect(group.color).toBe('#6366f1');
      expect(group.sortOrder).toBe(0);
    });
  });

  describe('getGroup', () => {
    it('should return group by ID', () => {
      const saved = db.saveGroup({ name: 'Test Group' });
      const retrieved = db.getGroup(saved.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(saved.id);
      expect(retrieved!.name).toBe('Test Group');
    });

    it('should return null for non-existent group', () => {
      const result = db.getGroup('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getGroupByName', () => {
    it('should return group by name', () => {
      db.saveGroup({ name: 'Production' });
      const retrieved = db.getGroupByName('Production');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Production');
    });

    it('should return null for non-existent name', () => {
      const result = db.getGroupByName('NonExistent');
      expect(result).toBeNull();
    });
  });

  describe('getAllGroups', () => {
    it('should return all groups sorted by sortOrder and name', () => {
      db.saveGroup({ name: 'Zebra', sortOrder: 1 });
      db.saveGroup({ name: 'Alpha', sortOrder: 0 });
      db.saveGroup({ name: 'Beta', sortOrder: 0 });

      const groups = db.getAllGroups();

      expect(groups).toHaveLength(3);
      expect(groups[0].name).toBe('Alpha');
      expect(groups[1].name).toBe('Beta');
      expect(groups[2].name).toBe('Zebra');
    });

    it('should return empty array when no groups exist', () => {
      const groups = db.getAllGroups();
      expect(groups).toHaveLength(0);
    });
  });

  describe('updateGroup', () => {
    it('should update group properties', async () => {
      const saved = db.saveGroup({ name: 'Original', description: 'Original desc' });

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = db.updateGroup(saved.id, {
        name: 'Updated',
        description: 'Updated desc',
        color: '#ef4444',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
      expect(updated!.description).toBe('Updated desc');
      expect(updated!.color).toBe('#ef4444');
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(saved.updatedAt.getTime());
    });

    it('should return null for non-existent group', () => {
      const result = db.updateGroup('non-existent', { name: 'New' });
      expect(result).toBeNull();
    });

    it('should preserve unchanged properties', () => {
      const saved = db.saveGroup({
        name: 'Original',
        description: 'Original desc',
        color: '#22c55e',
        sortOrder: 5,
      });

      const updated = db.updateGroup(saved.id, { name: 'Updated' });

      expect(updated!.description).toBe('Original desc');
      expect(updated!.color).toBe('#22c55e');
      expect(updated!.sortOrder).toBe(5);
    });
  });

  describe('deleteGroup', () => {
    it('should delete group and return true', () => {
      const saved = db.saveGroup({ name: 'To Delete' });

      const result = db.deleteGroup(saved.id);

      expect(result).toBe(true);
      expect(db.getGroup(saved.id)).toBeNull();
    });

    it('should return false for non-existent group', () => {
      const result = db.deleteGroup('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Server-Group Relationship', () => {
    it('should save server with groupId', () => {
      const group = db.saveGroup({ name: 'My Group' });

      const server = db.saveServer({
        name: 'Server 1',
        description: 'Test server',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group.id,
        enabled: true,
      });

      expect(server.groupId).toBe(group.id);
    });

    it('should update server groupId', () => {
      const group1 = db.saveGroup({ name: 'Group 1' });
      const group2 = db.saveGroup({ name: 'Group 2' });

      const server = db.saveServer({
        name: 'Server 1',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group1.id,
        enabled: true,
      });

      const updated = db.updateServer(server.id, { groupId: group2.id });

      expect(updated!.groupId).toBe(group2.id);
    });

    it('should get servers by group', () => {
      const group = db.saveGroup({ name: 'My Group' });

      db.saveServer({
        name: 'Server 1',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group.id,
        enabled: true,
      });

      db.saveServer({
        name: 'Server 2',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group.id,
        enabled: true,
      });

      db.saveServer({
        name: 'Ungrouped Server',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: null,
        enabled: true,
      });

      const groupServers = db.getServersByGroup(group.id);
      const ungroupedServers = db.getServersByGroup(null);

      expect(groupServers).toHaveLength(2);
      expect(ungroupedServers).toHaveLength(1);
      expect(ungroupedServers[0].name).toBe('Ungrouped Server');
    });

    it('should get server count for group', () => {
      const group = db.saveGroup({ name: 'My Group' });

      db.saveServer({
        name: 'Server 1',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group.id,
        enabled: true,
      });

      db.saveServer({
        name: 'Server 2',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group.id,
        enabled: true,
      });

      expect(db.getGroupServerCount(group.id)).toBe(2);
    });

    it('should set server groupId to null when group is deleted', () => {
      const group = db.saveGroup({ name: 'To Delete' });

      const server = db.saveServer({
        name: 'Server 1',
        transport: { type: 'stdio', command: 'node', args: [] },
        auth: { type: 'none' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        metadata: { tags: [], category: 'test', version: '1.0.0' },
        groupId: group.id,
        enabled: true,
      });

      db.deleteGroup(group.id);

      const updatedServer = db.getServer(server.id);
      expect(updatedServer!.groupId).toBeNull();
    });
  });
});
