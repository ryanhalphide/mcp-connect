import { readFileSync, existsSync } from 'node:fs';
import { serverDatabase } from '../storage/db.js';
import { createChildLogger } from '../observability/logger.js';
import type { TransportConfig, AuthConfig } from '../core/types.js';

const logger = createChildLogger({ module: 'seed-servers' });

interface ServerConfigFile {
  servers: Array<{
    name: string;
    description?: string;
    transport: TransportConfig;
    auth: AuthConfig;
    healthCheck: {
      enabled: boolean;
      intervalMs: number;
      timeoutMs: number;
    };
    rateLimits: {
      requestsPerMinute: number;
      requestsPerDay: number;
    };
    metadata: {
      tags: string[];
      category: string;
      version: string;
    };
  }>;
}

export function loadServersFromConfig(configPath: string = './config/servers.json'): number {
  if (!existsSync(configPath)) {
    logger.info({ configPath }, 'No server config file found, skipping seed');
    return 0;
  }

  try {
    const configContent = readFileSync(configPath, 'utf-8');
    const config: ServerConfigFile = JSON.parse(configContent);

    if (!config.servers || !Array.isArray(config.servers)) {
      logger.warn({ configPath }, 'Invalid config file format - missing servers array');
      return 0;
    }

    let loaded = 0;
    let updated = 0;
    for (const serverConfig of config.servers) {
      // Check if server already exists
      const existing = serverDatabase.getServerByName(serverConfig.name);
      if (existing) {
        // Update existing server with new config
        try {
          serverDatabase.updateServer(existing.id, {
            description: serverConfig.description || '',
            transport: serverConfig.transport,
            auth: serverConfig.auth,
            healthCheck: serverConfig.healthCheck,
            rateLimits: serverConfig.rateLimits,
            metadata: serverConfig.metadata,
          });
          updated++;
          logger.debug({ serverName: serverConfig.name }, 'Server updated from config');
        } catch (error) {
          logger.error({ serverName: serverConfig.name, error }, 'Failed to update server from config');
        }
        continue;
      }

      try {
        serverDatabase.saveServer({
          name: serverConfig.name,
          description: serverConfig.description || '',
          transport: serverConfig.transport,
          auth: serverConfig.auth,
          healthCheck: serverConfig.healthCheck,
          rateLimits: serverConfig.rateLimits,
          metadata: serverConfig.metadata,
          enabled: true,
        });
        loaded++;
        logger.info({ serverName: serverConfig.name }, 'Server loaded from config');
      } catch (error) {
        logger.error({ serverName: serverConfig.name, error }, 'Failed to load server from config');
      }
    }

    // Remove servers that are no longer in config (only if they were seeded, not manually added)
    const allServers = serverDatabase.getAllServers();
    const configServerNames = new Set(config.servers.map((s) => s.name));
    for (const server of allServers) {
      if (!configServerNames.has(server.name)) {
        // Check if this is a seeded server (has matching category pattern)
        const isSeeded = ['storage', 'network', 'utility'].includes(server.metadata.category);
        if (isSeeded) {
          serverDatabase.deleteServer(server.id);
          logger.info({ serverName: server.name }, 'Removed server not in config');
        }
      }
    }

    logger.info({ loaded, updated, total: config.servers.length }, 'Servers synced from config');
    return loaded + updated;
  } catch (error) {
    logger.error({ configPath, error }, 'Failed to read server config file');
    return 0;
  }
}
