import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '../../src/core/registry.js';
import type { ToolRegistryEntry } from '../../src/core/types.js';

// Mock the dependencies
vi.mock('../../src/core/pool.js', () => ({
  connectionPool: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/mcp/client.js', () => ({
  listTools: vi.fn(),
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('Tool Management', () => {
    it('should start with empty registry', () => {
      expect(registry.getToolCount()).toBe(0);
      expect(registry.getAllTools()).toEqual([]);
    });

    it('should clear all tools', () => {
      // Manually add a tool via internal state for testing
      const entry: ToolRegistryEntry = {
        name: 'test-server/test-tool',
        serverId: '123e4567-e89b-12d3-a456-426614174000',
        serverName: 'test-server',
        description: 'A test tool',
        inputSchema: {},
        registeredAt: new Date(),
      };

      // Access private map for testing
      (registry as any).tools.set(entry.name, entry);
      (registry as any).serverTools.set(entry.serverId, new Set([entry.name]));

      expect(registry.getToolCount()).toBe(1);

      registry.clear();

      expect(registry.getToolCount()).toBe(0);
      expect(registry.getAllTools()).toEqual([]);
    });
  });

  describe('Tool Lookup', () => {
    const testEntry: ToolRegistryEntry = {
      name: 'filesystem/read_file',
      serverId: '123e4567-e89b-12d3-a456-426614174000',
      serverName: 'filesystem',
      description: 'Read a file from disk',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      registeredAt: new Date(),
    };

    const anotherEntry: ToolRegistryEntry = {
      name: 'memory/store_value',
      serverId: '223e4567-e89b-12d3-a456-426614174001',
      serverName: 'memory',
      description: 'Store a value in memory',
      inputSchema: {},
      registeredAt: new Date(),
    };

    beforeEach(() => {
      (registry as any).tools.set(testEntry.name, testEntry);
      (registry as any).tools.set(anotherEntry.name, anotherEntry);
      (registry as any).serverTools.set(testEntry.serverId, new Set([testEntry.name]));
      (registry as any).serverTools.set(anotherEntry.serverId, new Set([anotherEntry.name]));
    });

    it('should find tool by exact qualified name', () => {
      const found = registry.getTool('filesystem/read_file');
      expect(found).toBeDefined();
      expect(found?.name).toBe('filesystem/read_file');
      expect(found?.serverId).toBe(testEntry.serverId);
    });

    it('should return undefined for non-existent tool', () => {
      const found = registry.getTool('nonexistent/tool');
      expect(found).toBeUndefined();
    });

    it('should find tool by unqualified name', () => {
      const found = registry.findTool('read_file');
      expect(found).toBeDefined();
      expect(found?.name).toBe('filesystem/read_file');
    });

    it('should find tool by qualified name using findTool', () => {
      const found = registry.findTool('filesystem/read_file');
      expect(found).toBeDefined();
      expect(found?.name).toBe('filesystem/read_file');
    });

    it('should return undefined for non-existent unqualified tool', () => {
      const found = registry.findTool('nonexistent');
      expect(found).toBeUndefined();
    });

    it('should find tools by server ID', () => {
      const serverTools = registry.findToolsByServer(testEntry.serverId);
      expect(serverTools).toHaveLength(1);
      expect(serverTools[0].name).toBe('filesystem/read_file');
    });

    it('should return empty array for unknown server ID', () => {
      const serverTools = registry.findToolsByServer('unknown-server-id');
      expect(serverTools).toEqual([]);
    });

    it('should get server tool count', () => {
      expect(registry.getServerToolCount(testEntry.serverId)).toBe(1);
      expect(registry.getServerToolCount('unknown')).toBe(0);
    });
  });

  describe('Tool Search', () => {
    beforeEach(() => {
      const tools: ToolRegistryEntry[] = [
        {
          name: 'filesystem/read_file',
          serverId: '123e4567-e89b-12d3-a456-426614174000',
          serverName: 'filesystem',
          description: 'Read a file from disk',
          registeredAt: new Date(),
        },
        {
          name: 'filesystem/write_file',
          serverId: '123e4567-e89b-12d3-a456-426614174000',
          serverName: 'filesystem',
          description: 'Write content to a file',
          registeredAt: new Date(),
        },
        {
          name: 'memory/store',
          serverId: '223e4567-e89b-12d3-a456-426614174001',
          serverName: 'memory',
          description: 'Store data in memory',
          registeredAt: new Date(),
        },
      ];

      for (const tool of tools) {
        (registry as any).tools.set(tool.name, tool);
      }
    });

    it('should search tools by name', () => {
      const results = registry.searchTools('file');
      expect(results).toHaveLength(2);
      expect(results.map((t) => t.name)).toContain('filesystem/read_file');
      expect(results.map((t) => t.name)).toContain('filesystem/write_file');
    });

    it('should search tools by description', () => {
      const results = registry.searchTools('disk');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('filesystem/read_file');
    });

    it('should search tools by server name', () => {
      const results = registry.searchTools('memory');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('memory/store');
    });

    it('should be case-insensitive', () => {
      const results = registry.searchTools('FILE');
      expect(results).toHaveLength(2);
    });

    it('should return empty array for no matches', () => {
      const results = registry.searchTools('xyz123');
      expect(results).toEqual([]);
    });
  });

  describe('Server Unregistration', () => {
    it('should unregister all tools for a server', () => {
      const serverId = '123e4567-e89b-12d3-a456-426614174000';
      const tools = ['filesystem/read', 'filesystem/write'];

      for (const toolName of tools) {
        (registry as any).tools.set(toolName, {
          name: toolName,
          serverId,
          serverName: 'filesystem',
          registeredAt: new Date(),
        });
      }
      (registry as any).serverTools.set(serverId, new Set(tools));

      expect(registry.getToolCount()).toBe(2);

      registry.unregisterServer(serverId);

      expect(registry.getToolCount()).toBe(0);
      expect(registry.findToolsByServer(serverId)).toEqual([]);
    });

    it('should handle unregistering non-existent server', () => {
      expect(() => registry.unregisterServer('non-existent')).not.toThrow();
    });
  });
});
