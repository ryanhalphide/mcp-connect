import type { MCPServerConfig } from './types.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'resource-registry' });

export interface ResourceEntry {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
  serverName: string;
  metadata: Record<string, unknown>;
  registeredAt: Date;
}

export interface ResourceSearchOptions {
  query?: string;
  serverId?: string;
  mimeType?: string;
  limit?: number;
  offset?: number;
}

export class ResourceRegistry {
  private resources: Map<string, ResourceEntry> = new Map();

  /**
   * Register resources from an MCP server
   */
  registerResources(server: MCPServerConfig, resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    metadata?: Record<string, unknown>;
  }>): void {
    for (const resource of resources) {
      const entry: ResourceEntry = {
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        serverId: server.id,
        serverName: server.name,
        metadata: resource.metadata || {},
        registeredAt: new Date(),
      };

      this.resources.set(resource.uri, entry);
    }

    logger.info({
      serverId: server.id,
      serverName: server.name,
      count: resources.length
    }, 'Registered resources');
  }

  /**
   * Unregister all resources for a server
   */
  unregisterServer(serverId: string): number {
    let count = 0;
    for (const [uri, resource] of this.resources.entries()) {
      if (resource.serverId === serverId) {
        this.resources.delete(uri);
        count++;
      }
    }

    if (count > 0) {
      logger.info({ serverId, count }, 'Unregistered resources');
    }

    return count;
  }

  /**
   * Find a resource by URI
   */
  findResource(uri: string): ResourceEntry | null {
    return this.resources.get(uri) || null;
  }

  /**
   * Get all resources for a server
   */
  getServerResources(serverId: string): ResourceEntry[] {
    return Array.from(this.resources.values())
      .filter(r => r.serverId === serverId);
  }

  /**
   * Search resources with filters
   */
  searchResources(options: ResourceSearchOptions): {
    resources: ResourceEntry[];
    total: number;
  } {
    let results = Array.from(this.resources.values());

    // Filter by server
    if (options.serverId) {
      results = results.filter(r => r.serverId === options.serverId);
    }

    // Filter by MIME type
    if (options.mimeType) {
      results = results.filter(r => r.mimeType === options.mimeType);
    }

    // Search by query (name, description, URI)
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(r =>
        r.name.toLowerCase().includes(query) ||
        r.description?.toLowerCase().includes(query) ||
        r.uri.toLowerCase().includes(query)
      );
    }

    const total = results.length;

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    results = results.slice(offset, offset + limit);

    return { resources: results, total };
  }

  /**
   * Get all resources
   */
  getAllResources(): ResourceEntry[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get resource count
   */
  getResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Get resource stats by server
   */
  getStatsByServer(): Array<{ serverId: string; serverName: string; count: number }> {
    const stats = new Map<string, { serverId: string; serverName: string; count: number }>();

    for (const resource of this.resources.values()) {
      const existing = stats.get(resource.serverId);
      if (existing) {
        existing.count++;
      } else {
        stats.set(resource.serverId, {
          serverId: resource.serverId,
          serverName: resource.serverName,
          count: 1,
        });
      }
    }

    return Array.from(stats.values());
  }

  /**
   * Get unique MIME types
   */
  getMimeTypes(): Array<{ mimeType: string; count: number }> {
    const mimeTypes = new Map<string, number>();

    for (const resource of this.resources.values()) {
      if (resource.mimeType) {
        const count = mimeTypes.get(resource.mimeType) || 0;
        mimeTypes.set(resource.mimeType, count + 1);
      }
    }

    return Array.from(mimeTypes.entries())
      .map(([mimeType, count]) => ({ mimeType, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear();
    logger.info('All resources cleared');
  }
}

// Singleton instance
export const resourceRegistry = new ResourceRegistry();
