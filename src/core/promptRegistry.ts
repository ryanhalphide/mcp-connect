import type { MCPServerConfig } from './types.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'prompt-registry' });

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptEntry {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
  serverId: string;
  serverName: string;
  registeredAt: Date;
}

export interface PromptSearchOptions {
  query?: string;
  serverId?: string;
  limit?: number;
  offset?: number;
}

export class PromptRegistry {
  private prompts: Map<string, PromptEntry> = new Map();

  /**
   * Register prompts from an MCP server
   */
  registerPrompts(server: MCPServerConfig, prompts: Array<{
    name: string;
    description?: string;
    arguments?: PromptArgument[];
  }>): void {
    for (const prompt of prompts) {
      const qualifiedName = `${server.name}/${prompt.name}`;
      const entry: PromptEntry = {
        name: qualifiedName,
        description: prompt.description,
        arguments: prompt.arguments,
        serverId: server.id,
        serverName: server.name,
        registeredAt: new Date(),
      };

      this.prompts.set(qualifiedName, entry);
    }

    logger.info(
      {
        serverId: server.id,
        serverName: server.name,
        count: prompts.length
      },
      'Registered prompts'
    );
  }

  /**
   * Unregister all prompts for a server
   */
  unregisterServer(serverId: string): number {
    let count = 0;
    for (const [name, prompt] of this.prompts.entries()) {
      if (prompt.serverId === serverId) {
        this.prompts.delete(name);
        count++;
      }
    }

    if (count > 0) {
      logger.info({ serverId, count }, 'Unregistered prompts');
    }

    return count;
  }

  /**
   * Find a prompt by name
   */
  findPrompt(name: string): PromptEntry | null {
    return this.prompts.get(name) || null;
  }

  /**
   * Get all prompts for a server
   */
  getServerPrompts(serverId: string): PromptEntry[] {
    return Array.from(this.prompts.values())
      .filter(p => p.serverId === serverId);
  }

  /**
   * Search prompts with filters
   */
  searchPrompts(options: PromptSearchOptions): {
    prompts: PromptEntry[];
    total: number;
  } {
    let results = Array.from(this.prompts.values());

    // Filter by server
    if (options.serverId) {
      results = results.filter(p => p.serverId === options.serverId);
    }

    // Search by query (name, description)
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
      );
    }

    const total = results.length;

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    results = results.slice(offset, offset + limit);

    return { prompts: results, total };
  }

  /**
   * Get all prompts
   */
  getAllPrompts(): PromptEntry[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Get prompt count
   */
  getPromptCount(): number {
    return this.prompts.size;
  }

  /**
   * Get prompt stats by server
   */
  getStatsByServer(): Array<{ serverId: string; serverName: string; count: number }> {
    const stats = new Map<string, { serverId: string; serverName: string; count: number }>();

    for (const prompt of this.prompts.values()) {
      const existing = stats.get(prompt.serverId);
      if (existing) {
        existing.count++;
      } else {
        stats.set(prompt.serverId, {
          serverId: prompt.serverId,
          serverName: prompt.serverName,
          count: 1,
        });
      }
    }

    return Array.from(stats.values());
  }

  /**
   * Clear all prompts
   */
  clear(): void {
    this.prompts.clear();
    logger.info('All prompts cleared');
  }
}

// Singleton instance
export const promptRegistry = new PromptRegistry();
