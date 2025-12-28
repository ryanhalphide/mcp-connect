import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { MCPServerConfig, ServerGroup } from '../core/types.js';
import { MCPServerConfigSchema, ServerGroupSchema } from '../core/types.js';
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
    // Create server_groups table first (required for foreign key)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS server_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        color TEXT DEFAULT '#6366f1',
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_server_groups_name ON server_groups(name);
      CREATE INDEX IF NOT EXISTS idx_server_groups_sort ON server_groups(sort_order);
    `);

    // Check if servers table exists - if so, we may need to migrate
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='servers'"
    ).get();

    if (tableExists) {
      // Migration: add group_id column if it doesn't exist
      this.migrateAddGroupId();
    } else {
      // Create servers table with group_id column (fresh install)
      this.db.exec(`
        CREATE TABLE servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          transport_json TEXT NOT NULL,
          auth_json TEXT NOT NULL,
          health_check_json TEXT NOT NULL,
          rate_limits_json TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          group_id TEXT,
          enabled INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (group_id) REFERENCES server_groups(id) ON DELETE SET NULL
        );
      `);
    }

    // Create indexes (these are safe to run regardless)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_servers_name ON servers(name);
      CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);
    `);

    // Create group_id index only if column exists
    this.createGroupIdIndexIfNeeded();
  }

  private createGroupIdIndexIfNeeded(): void {
    try {
      const tableInfo = this.db.prepare("PRAGMA table_info(servers)").all() as Array<{ name: string }>;
      const hasGroupId = tableInfo.some(col => col.name === 'group_id');
      if (hasGroupId) {
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_servers_group ON servers(group_id)');
      }
    } catch {
      // Ignore errors
    }
  }

  private migrateAddGroupId(): void {
    try {
      const tableInfo = this.db.prepare("PRAGMA table_info(servers)").all() as Array<{ name: string }>;
      const hasGroupId = tableInfo.some(col => col.name === 'group_id');
      if (!hasGroupId) {
        this.db.exec('ALTER TABLE servers ADD COLUMN group_id TEXT REFERENCES server_groups(id) ON DELETE SET NULL');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_servers_group ON servers(group_id)');
        logger.info('Migration: added group_id column to servers table');
      }
    } catch {
      // Column already exists or other error, ignore
    }
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
        group_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      validated.groupId,
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
        group_id = ?, enabled = ?, updated_at = ?
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
      validated.groupId,
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
      groupId: row.group_id as string | null,
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    });
  }

  // Server Group CRUD methods
  saveGroup(config: Omit<ServerGroup, 'id' | 'createdAt' | 'updatedAt'>): ServerGroup {
    const id = uuidv4();
    const now = new Date();

    const fullConfig: ServerGroup = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = ServerGroupSchema.parse(fullConfig);

    const stmt = this.db.prepare(`
      INSERT INTO server_groups (
        id, name, description, color, icon, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      validated.id,
      validated.name,
      validated.description,
      validated.color,
      validated.icon || null,
      validated.sortOrder,
      validated.createdAt.toISOString(),
      validated.updatedAt.toISOString()
    );

    logger.info({ groupId: validated.id, groupName: validated.name }, 'Server group saved');
    return validated;
  }

  updateGroup(id: string, updates: Partial<Omit<ServerGroup, 'id' | 'createdAt'>>): ServerGroup | null {
    const existing = this.getGroup(id);
    if (!existing) {
      return null;
    }

    const updated: ServerGroup = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    const validated = ServerGroupSchema.parse(updated);

    const stmt = this.db.prepare(`
      UPDATE server_groups SET
        name = ?, description = ?, color = ?, icon = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      validated.name,
      validated.description,
      validated.color,
      validated.icon || null,
      validated.sortOrder,
      validated.updatedAt.toISOString(),
      id
    );

    logger.info({ groupId: id }, 'Server group updated');
    return validated;
  }

  getGroup(id: string): ServerGroup | null {
    const stmt = this.db.prepare('SELECT * FROM server_groups WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToGroup(row);
  }

  getGroupByName(name: string): ServerGroup | null {
    const stmt = this.db.prepare('SELECT * FROM server_groups WHERE name = ?');
    const row = stmt.get(name) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToGroup(row);
  }

  getAllGroups(): ServerGroup[] {
    const stmt = this.db.prepare('SELECT * FROM server_groups ORDER BY sort_order ASC, name ASC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToGroup(row));
  }

  deleteGroup(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM server_groups WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ groupId: id }, 'Server group deleted');
      return true;
    }

    return false;
  }

  getServersByGroup(groupId: string | null): MCPServerConfig[] {
    const query = groupId === null
      ? 'SELECT * FROM servers WHERE group_id IS NULL'
      : 'SELECT * FROM servers WHERE group_id = ?';

    const stmt = this.db.prepare(query);
    const rows = (groupId === null ? stmt.all() : stmt.all(groupId)) as Record<string, unknown>[];

    return rows.map((row) => this.rowToConfig(row));
  }

  getGroupServerCount(groupId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM servers WHERE group_id = ?');
    const row = stmt.get(groupId) as { count: number };
    return row.count;
  }

  private rowToGroup(row: Record<string, unknown>): ServerGroup {
    return ServerGroupSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      icon: row.icon ?? undefined, // Convert null to undefined for optional field
      sortOrder: row.sort_order,
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
