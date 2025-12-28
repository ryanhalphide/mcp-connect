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
    for (const serverConfig of config.servers) {
      // Check if server already exists
      const existing = serverDatabase.getServerByName(serverConfig.name);
      if (existing) {
        logger.debug({ serverName: serverConfig.name }, 'Server already exists, skipping');
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

    logger.info({ loaded, total: config.servers.length }, 'Servers loaded from config');
    return loaded;
  } catch (error) {
    logger.error({ configPath, error }, 'Failed to read server config file');
    return 0;
  }
}
