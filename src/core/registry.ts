import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolRegistryEntry, MCPServerConfig, ToolSearchOptions } from './types.js';
import { connectionPool } from './pool.js';
import { listTools } from '../mcp/client.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'tool-registry' });

// Category inference rules based on tool names and descriptions
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /file|directory|read|write|path|folder/i, category: 'filesystem' },
  { pattern: /database|sql|query|table|record/i, category: 'database' },
  { pattern: /http|api|request|fetch|url|endpoint/i, category: 'network' },
  { pattern: /git|commit|branch|repo|clone/i, category: 'version-control' },
  { pattern: /search|find|lookup|query/i, category: 'search' },
  { pattern: /memory|store|cache|save|load/i, category: 'storage' },
  { pattern: /math|add|subtract|multiply|calculate/i, category: 'utility' },
  { pattern: /echo|print|log|debug/i, category: 'utility' },
];

function inferCategory(toolName: string, description: string): string {
  const text = `${toolName} ${description}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) {
      return rule.category;
    }
  }
  return 'general';
}

function extractTags(toolName: string, description: string): string[] {
  const tags = new Set<string>();
  const words = `${toolName} ${description}`.toLowerCase().split(/[^a-z0-9]+/);

  // Common meaningful tags
  const meaningfulTags = [
    'file', 'read', 'write', 'create', 'delete', 'update', 'list', 'search',
    'get', 'set', 'add', 'remove', 'fetch', 'send', 'query', 'execute',
    'async', 'sync', 'memory', 'cache', 'store', 'load', 'save'
  ];

  for (const word of words) {
    if (meaningfulTags.includes(word) && word.length > 2) {
      tags.add(word);
    }
  }

  return Array.from(tags).slice(0, 5); // Max 5 tags
}

export class ToolRegistry {
  private tools: Map<string, ToolRegistryEntry> = new Map();
  private serverTools: Map<string, Set<string>> = new Map(); // serverId -> tool names
  private categories: Set<string> = new Set(['general']);

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
      const description = tool.description || '';
      const category = inferCategory(tool.name, description);
      const tags = extractTags(tool.name, description);

      this.categories.add(category);

      const entry: ToolRegistryEntry = {
        name: qualifiedName,
        serverId: config.id,
        serverName: config.name,
        description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        category,
        tags,
        usageCount: 0,
        registeredAt: new Date(),
      };

      this.tools.set(qualifiedName, entry);
      serverToolNames.add(qualifiedName);
      registeredTools.push(entry);

      logger.debug({ toolName: qualifiedName, serverId: config.id, category }, 'Tool registered');
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

  searchToolsAdvanced(options: ToolSearchOptions): {
    tools: ToolRegistryEntry[];
    total: number;
    categories: string[];
  } {
    let tools = Array.from(this.tools.values());

    // Filter by text query
    if (options.query) {
      const lowerQuery = options.query.toLowerCase();
      tools = tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(lowerQuery) ||
          tool.description.toLowerCase().includes(lowerQuery) ||
          tool.serverName.toLowerCase().includes(lowerQuery) ||
          tool.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Filter by category
    if (options.category) {
      tools = tools.filter((tool) => tool.category === options.category);
    }

    // Filter by tags (match any)
    if (options.tags && options.tags.length > 0) {
      tools = tools.filter((tool) =>
        options.tags!.some((tag) => tool.tags.includes(tag.toLowerCase()))
      );
    }

    // Filter by server
    if (options.server) {
      tools = tools.filter(
        (tool) =>
          tool.serverName === options.server ||
          tool.serverId === options.server
      );
    }

    // Collect categories from filtered results
    const resultCategories = [...new Set(tools.map((t) => t.category))];

    // Sort
    switch (options.sortBy) {
      case 'usage':
        tools.sort((a, b) => b.usageCount - a.usageCount);
        break;
      case 'recent':
        tools.sort((a, b) => {
          const aTime = a.lastUsedAt?.getTime() ?? 0;
          const bTime = b.lastUsedAt?.getTime() ?? 0;
          return bTime - aTime;
        });
        break;
      case 'name':
      default:
        tools.sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = tools.length;

    // Paginate
    tools = tools.slice(options.offset, options.offset + options.limit);

    return { tools, total, categories: resultCategories };
  }

  getCategories(): Array<{ name: string; count: number }> {
    const categoryCounts = new Map<string, number>();

    for (const tool of this.tools.values()) {
      const current = categoryCounts.get(tool.category) ?? 0;
      categoryCounts.set(tool.category, current + 1);
    }

    return Array.from(categoryCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  getAllTags(): Array<{ name: string; count: number }> {
    const tagCounts = new Map<string, number>();

    for (const tool of this.tools.values()) {
      for (const tag of tool.tags) {
        const current = tagCounts.get(tag) ?? 0;
        tagCounts.set(tag, current + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  recordUsage(qualifiedName: string): void {
    const tool = this.tools.get(qualifiedName);
    if (tool) {
      tool.usageCount++;
      tool.lastUsedAt = new Date();
    }
  }

  getStats(): {
    totalTools: number;
    totalCategories: number;
    byCategory: Array<{ name: string; count: number }>;
    topUsed: ToolRegistryEntry[];
    recentlyUsed: ToolRegistryEntry[];
  } {
    const tools = Array.from(this.tools.values());
    const byCategory = this.getCategories();

    const topUsed = [...tools]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    const recentlyUsed = [...tools]
      .filter((t) => t.lastUsedAt)
      .sort((a, b) => {
        const aTime = a.lastUsedAt?.getTime() ?? 0;
        const bTime = b.lastUsedAt?.getTime() ?? 0;
        return bTime - aTime;
      })
      .slice(0, 10);

    return {
      totalTools: tools.length,
      totalCategories: byCategory.length,
      byCategory,
      topUsed,
      recentlyUsed,
    };
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
    this.categories.clear();
    this.categories.add('general');
    logger.info('Registry cleared');
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
