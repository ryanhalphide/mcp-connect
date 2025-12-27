import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolRegistryEntry, MCPServerConfig } from './types.js';
import { connectionPool } from './pool.js';
import { listTools } from '../mcp/client.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'tool-registry' });

export class ToolRegistry {
  private tools: Map<string, ToolRegistryEntry> = new Map();
  private serverTools: Map<string, Set<string>> = new Map(); // serverId -> tool names

  async registerServer(config: MCPServerConfig): Promise<ToolRegistryEntry[]> {
    logger.info({ serverId: config.id, serverName: config.name }, 'Registering server tools');

    const client = connectionPool.getClient(config.id);
    if (!client) {
      throw new Error(`Server ${config.id} is not connected`);
    }

    const mcpTools = await listTools(client as Client);
    const registeredTools: ToolRegistryEntry[] = [];

    // Clear previous tools for this server
    this.unregisterServer(config.id);

    const serverToolNames = new Set<string>();

    for (const tool of mcpTools) {
      const qualifiedName = `${config.name}/${tool.name}`;

      const entry: ToolRegistryEntry = {
        name: qualifiedName,
        serverId: config.id,
        serverName: config.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
        registeredAt: new Date(),
      };

      this.tools.set(qualifiedName, entry);
      serverToolNames.add(qualifiedName);
      registeredTools.push(entry);

      logger.debug({ toolName: qualifiedName, serverId: config.id }, 'Tool registered');
    }

    this.serverTools.set(config.id, serverToolNames);

    logger.info(
      { serverId: config.id, serverName: config.name, toolCount: registeredTools.length },
      'Server tools registered'
    );

    return registeredTools;
  }

  unregisterServer(serverId: string): void {
    const toolNames = this.serverTools.get(serverId);
    if (!toolNames) {
      return;
    }

    for (const toolName of toolNames) {
      this.tools.delete(toolName);
    }

    this.serverTools.delete(serverId);
    logger.info({ serverId, toolCount: toolNames.size }, 'Server tools unregistered');
  }

  getTool(qualifiedName: string): ToolRegistryEntry | undefined {
    return this.tools.get(qualifiedName);
  }

  findTool(toolName: string): ToolRegistryEntry | undefined {
    // First try exact match
    const exact = this.tools.get(toolName);
    if (exact) return exact;

    // Then try to find by unqualified name (returns first match)
    for (const [name, entry] of this.tools) {
      if (name.endsWith(`/${toolName}`)) {
        return entry;
      }
    }

    return undefined;
  }

  findToolsByServer(serverId: string): ToolRegistryEntry[] {
    const toolNames = this.serverTools.get(serverId);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map((name) => this.tools.get(name))
      .filter((t): t is ToolRegistryEntry => t !== undefined);
  }

  getAllTools(): ToolRegistryEntry[] {
    return Array.from(this.tools.values());
  }

  searchTools(query: string): ToolRegistryEntry[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.tools.values()).filter(
      (tool) =>
        tool.name.toLowerCase().includes(lowerQuery) ||
        tool.description.toLowerCase().includes(lowerQuery) ||
        tool.serverName.toLowerCase().includes(lowerQuery)
    );
  }

  getToolCount(): number {
    return this.tools.size;
  }

  getServerToolCount(serverId: string): number {
    return this.serverTools.get(serverId)?.size ?? 0;
  }

  clear(): void {
    this.tools.clear();
    this.serverTools.clear();
    logger.info('Registry cleared');
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
