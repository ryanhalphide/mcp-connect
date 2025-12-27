import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { MCPServerConfig } from '../core/types.js';
import { MCPServerConfigSchema } from '../core/types.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'database' });

export class ServerDatabase {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.initialize();
    logger.info({ dbPath }, 'Database initialized');
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        transport_json TEXT NOT NULL,
        auth_json TEXT NOT NULL,
        health_check_json TEXT NOT NULL,
        rate_limits_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_servers_name ON servers(name);
      CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);
    `);
  }

  saveServer(config: Omit<MCPServerConfig, 'id' | 'createdAt' | 'updatedAt'>): MCPServerConfig {
    const id = uuidv4();
    const now = new Date();

    const fullConfig: MCPServerConfig = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = MCPServerConfigSchema.parse(fullConfig);

    const stmt = this.db.prepare(`
      INSERT INTO servers (
        id, name, description, transport_json, auth_json,
        health_check_json, rate_limits_json, metadata_json,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      validated.id,
      validated.name,
      validated.description,
      JSON.stringify(validated.transport),
      JSON.stringify(validated.auth),
      JSON.stringify(validated.healthCheck),
      JSON.stringify(validated.rateLimits),
      JSON.stringify(validated.metadata),
      validated.enabled ? 1 : 0,
      validated.createdAt.toISOString(),
      validated.updatedAt.toISOString()
    );

    logger.info({ serverId: validated.id, serverName: validated.name }, 'Server saved');
    return validated;
  }

  updateServer(id: string, updates: Partial<Omit<MCPServerConfig, 'id' | 'createdAt'>>): MCPServerConfig | null {
    const existing = this.getServer(id);
    if (!existing) {
      return null;
    }

    const updated: MCPServerConfig = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    const validated = MCPServerConfigSchema.parse(updated);

    const stmt = this.db.prepare(`
      UPDATE servers SET
        name = ?, description = ?, transport_json = ?, auth_json = ?,
        health_check_json = ?, rate_limits_json = ?, metadata_json = ?,
        enabled = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      validated.name,
      validated.description,
      JSON.stringify(validated.transport),
      JSON.stringify(validated.auth),
      JSON.stringify(validated.healthCheck),
      JSON.stringify(validated.rateLimits),
      JSON.stringify(validated.metadata),
      validated.enabled ? 1 : 0,
      validated.updatedAt.toISOString(),
      id
    );

    logger.info({ serverId: id }, 'Server updated');
    return validated;
  }

  getServer(id: string): MCPServerConfig | null {
    const stmt = this.db.prepare('SELECT * FROM servers WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToConfig(row);
  }

  getServerByName(name: string): MCPServerConfig | null {
    const stmt = this.db.prepare('SELECT * FROM servers WHERE name = ?');
    const row = stmt.get(name) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToConfig(row);
  }

  getAllServers(enabledOnly: boolean = false): MCPServerConfig[] {
    const query = enabledOnly
      ? 'SELECT * FROM servers WHERE enabled = 1'
      : 'SELECT * FROM servers';

    const stmt = this.db.prepare(query);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToConfig(row));
  }

  deleteServer(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM servers WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ serverId: id }, 'Server deleted');
      return true;
    }

    return false;
  }

  private rowToConfig(row: Record<string, unknown>): MCPServerConfig {
    return MCPServerConfigSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      transport: JSON.parse(row.transport_json as string),
      auth: JSON.parse(row.auth_json as string),
      healthCheck: JSON.parse(row.health_check_json as string),
      rateLimits: JSON.parse(row.rate_limits_json as string),
      metadata: JSON.parse(row.metadata_json as string),
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    });
  }

  close(): void {
    this.db.close();
    logger.info('Database closed');
  }
}

// Singleton instance with file-based storage
export const serverDatabase = new ServerDatabase(
  process.env.DB_PATH || './data/mcp-connect.db'
);
