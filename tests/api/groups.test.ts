import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { groupsApi } from '../../src/api/groups.js';

// Mock dependencies
vi.mock('../../src/storage/db.js', () => ({
  serverDatabase: {
    getAllGroups: vi.fn(),
    getGroup: vi.fn(),
    getGroupByName: vi.fn(),
    saveGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    getServersByGroup: vi.fn(),
    getGroupServerCount: vi.fn(),
    getServer: vi.fn(),
    updateServer: vi.fn(),
  },
}));

vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    getConnectionStatus: vi.fn(),
  },
}));

vi.mock('../../src/core/registry.js', () => ({
  toolRegistry: {
    getServerToolCount: vi.fn(),
  },
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { serverDatabase } from '../../src/storage/db.js';
import { connectionPool } from '../../src/core/pool.js';
import { toolRegistry } from '../../src/core/registry.js';

const app = new Hono();
app.route('/groups', groupsApi);

describe('Groups API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /groups', () => {
    it('should return all groups with server counts', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Production',
          description: 'Production servers',
          color: '#22c55e',
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'group-2',
          name: 'Development',
          description: 'Dev servers',
          color: '#3b82f6',
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(serverDatabase.getAllGroups).mockReturnValue(mockGroups);
      vi.mocked(serverDatabase.getGroupServerCount).mockImplementation((id) =>
        id === 'group-1' ? 3 : 2
      );

      const res = await app.request('/groups');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].name).toBe('Production');
      expect(json.data[0].serverCount).toBe(3);
      expect(json.data[1].name).toBe('Development');
      expect(json.data[1].serverCount).toBe(2);
    });

    it('should return empty array when no groups exist', async () => {
      vi.mocked(serverDatabase.getAllGroups).mockReturnValue([]);

      const res = await app.request('/groups');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(0);
    });
  });

  describe('GET /groups/:id', () => {
    it('should return group with servers', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Production',
        description: 'Production servers',
        color: '#22c55e',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockServers = [
        { id: 'srv-1', name: 'Server 1', description: 'First server' },
        { id: 'srv-2', name: 'Server 2', description: 'Second server' },
      ];

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getServersByGroup).mockReturnValue(mockServers as any);
      vi.mocked(connectionPool.getConnectionStatus).mockReturnValue('connected');
      vi.mocked(toolRegistry.getServerToolCount).mockReturnValue(5);

      const res = await app.request('/groups/group-1');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Production');
      expect(json.data.serverCount).toBe(2);
      expect(json.data.servers).toHaveLength(2);
      expect(json.data.servers[0].connectionStatus).toBe('connected');
      expect(json.data.servers[0].toolCount).toBe(5);
    });

    it('should return 404 for non-existent group', async () => {
      vi.mocked(serverDatabase.getGroup).mockReturnValue(null);

      const res = await app.request('/groups/non-existent');
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('not found');
    });
  });

  describe('POST /groups', () => {
    it('should create a new group', async () => {
      const newGroup = {
        name: 'New Group',
        description: 'A new server group',
        color: '#6366f1',
      };

      const savedGroup = {
        id: 'new-group-id',
        ...newGroup,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(serverDatabase.getGroupByName).mockReturnValue(null);
      vi.mocked(serverDatabase.saveGroup).mockReturnValue(savedGroup);

      const res = await app.request('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGroup),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('New Group');
    });

    it('should reject duplicate group name', async () => {
      const existingGroup = {
        id: 'existing-id',
        name: 'Existing',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(serverDatabase.getGroupByName).mockReturnValue(existingGroup);

      const res = await app.request('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Existing', description: 'Duplicate' }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('already exists');
    });

    it('should reject invalid color format', async () => {
      const res = await app.request('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', color: 'red' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Validation error');
    });

    it('should reject empty name', async () => {
      const res = await app.request('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', description: 'Empty name' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  describe('PUT /groups/:id', () => {
    it('should update a group', async () => {
      const existingGroup = {
        id: 'group-1',
        name: 'Original',
        description: 'Original desc',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedGroup = {
        ...existingGroup,
        name: 'Updated',
        description: 'Updated desc',
      };

      vi.mocked(serverDatabase.getGroupByName).mockReturnValue(null);
      vi.mocked(serverDatabase.updateGroup).mockReturnValue(updatedGroup);

      const res = await app.request('/groups/group-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated', description: 'Updated desc' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated');
    });

    it('should return 404 for non-existent group', async () => {
      vi.mocked(serverDatabase.updateGroup).mockReturnValue(null);

      const res = await app.request('/groups/non-existent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should reject duplicate name when updating', async () => {
      const otherGroup = {
        id: 'other-id',
        name: 'Taken',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(serverDatabase.getGroupByName).mockReturnValue(otherGroup);

      const res = await app.request('/groups/group-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Taken' }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /groups/:id', () => {
    it('should delete a group', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'To Delete',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.deleteGroup).mockReturnValue(true);

      const res = await app.request('/groups/group-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
    });

    it('should return 404 for non-existent group', async () => {
      vi.mocked(serverDatabase.getGroup).mockReturnValue(null);

      const res = await app.request('/groups/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /groups/:id/servers', () => {
    it('should add server to group', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serverId = '11111111-1111-1111-1111-111111111111';
      const mockServer = {
        id: serverId,
        name: 'Server 1',
        groupId: null,
      };

      const updatedServer = { ...mockServer, groupId: 'group-1' };

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getServer).mockReturnValue(mockServer as any);
      vi.mocked(serverDatabase.updateServer).mockReturnValue(updatedServer as any);

      const res = await app.request('/groups/group-1/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.added).toBe(true);
    });

    it('should return 404 for non-existent group', async () => {
      vi.mocked(serverDatabase.getGroup).mockReturnValue(null);

      const res = await app.request('/groups/non-existent/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: '00000000-0000-0000-0000-000000000001' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent server', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getServer).mockReturnValue(null);

      // Use a valid UUID format for serverId
      const res = await app.request('/groups/group-1/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: '00000000-0000-0000-0000-000000000000' }),
      });

      expect(res.status).toBe(404);
    });

    it('should reject invalid serverId format', async () => {
      const res = await app.request('/groups/group-1/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: 'not-a-uuid' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /groups/:id/servers/:serverId', () => {
    it('should remove server from group', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockServer = {
        id: 'srv-1',
        name: 'Server 1',
        groupId: 'group-1',
      };

      const updatedServer = { ...mockServer, groupId: null };

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getServer).mockReturnValue(mockServer as any);
      vi.mocked(serverDatabase.updateServer).mockReturnValue(updatedServer as any);

      const res = await app.request('/groups/group-1/servers/srv-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.removed).toBe(true);
    });

    it('should reject if server not in group', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockServer = {
        id: 'srv-1',
        name: 'Server 1',
        groupId: 'other-group',
      };

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getServer).mockReturnValue(mockServer as any);

      const res = await app.request('/groups/group-1/servers/srv-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('not in group');
    });
  });

  describe('GET /groups/:id/servers', () => {
    it('should return servers in group', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        description: '',
        color: '#6366f1',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockServers = [
        { id: 'srv-1', name: 'Server 1', groupId: 'group-1' },
        { id: 'srv-2', name: 'Server 2', groupId: 'group-1' },
      ];

      vi.mocked(serverDatabase.getGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getServersByGroup).mockReturnValue(mockServers as any);
      vi.mocked(connectionPool.getConnectionStatus).mockReturnValue('connected');
      vi.mocked(toolRegistry.getServerToolCount).mockReturnValue(10);

      const res = await app.request('/groups/group-1/servers');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].connectionStatus).toBe('connected');
      expect(json.data[0].toolCount).toBe(10);
    });

    it('should return 404 for non-existent group', async () => {
      vi.mocked(serverDatabase.getGroup).mockReturnValue(null);

      const res = await app.request('/groups/non-existent/servers');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /groups/ungrouped/servers', () => {
    it('should return servers not in any group', async () => {
      const mockServers = [
        { id: 'srv-1', name: 'Ungrouped 1', groupId: null },
        { id: 'srv-2', name: 'Ungrouped 2', groupId: null },
      ];

      vi.mocked(serverDatabase.getServersByGroup).mockReturnValue(mockServers as any);
      vi.mocked(connectionPool.getConnectionStatus).mockReturnValue('disconnected');
      vi.mocked(toolRegistry.getServerToolCount).mockReturnValue(0);

      const res = await app.request('/groups/ungrouped/servers');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].connectionStatus).toBe('disconnected');
    });
  });
});

describe('Database Group Methods', () => {
  describe('ServerDatabase integration', () => {
    it('should correctly integrate with group CRUD operations', async () => {
      const mockGroup = {
        id: 'test-group',
        name: 'Integration Test',
        description: 'Test group',
        color: '#f59e0b',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(serverDatabase.saveGroup).mockReturnValue(mockGroup);
      vi.mocked(serverDatabase.getGroupByName).mockReturnValue(null);

      const res = await app.request('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Integration Test',
          description: 'Test group',
          color: '#f59e0b',
        }),
      });

      expect(res.status).toBe(201);
      expect(serverDatabase.saveGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Integration Test',
          description: 'Test group',
          color: '#f59e0b',
        })
      );
    });
  });
});
