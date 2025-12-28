import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-keys' });

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  enabled: boolean;
  metadata: {
    description?: string;
    scopes?: string[];
    [key: string]: unknown;
  };
}

export class ApiKeyStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize() {
    // Create API keys table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    // Create index on key for fast lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key)
    `);

    logger.info('API keys table initialized');
  }

  /**
   * Generate a new API key
   */
  generateApiKey(): string {
    // Generate a secure random key: mcp_live_<32 random bytes as hex>
    const randomKey = randomBytes(32).toString('hex');
    return `mcp_live_${randomKey}`;
  }

  /**
   * Create a new API key
   */
  createApiKey(name: string, metadata: ApiKey['metadata'] = {}): ApiKey {
    const id = randomBytes(16).toString('hex');
    const key = this.generateApiKey();
    const createdAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, key, name, created_at, enabled, metadata)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    stmt.run(id, key, name, createdAt, JSON.stringify(metadata));

    logger.info({ keyId: id, name }, 'API key created');

    return {
      id,
      key,
      name,
      createdAt,
      lastUsedAt: null,
      enabled: true,
      metadata,
    };
  }

  /**
   * Validate an API key and return the key info if valid
   */
  validateApiKey(key: string): ApiKey | null {
    const stmt = this.db.prepare(`
      SELECT id, key, name, created_at, last_used_at, enabled, metadata
      FROM api_keys
      WHERE key = ? AND enabled = 1
    `);

    const row = stmt.get(key) as {
      id: string;
      key: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
      enabled: number;
      metadata: string;
    } | undefined;

    if (!row) {
      return null;
    }

    // Update last used timestamp
    this.updateLastUsed(row.id);

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      enabled: row.enabled === 1,
      metadata: JSON.parse(row.metadata),
    };
  }

  /**
   * Update the last used timestamp
   */
  private updateLastUsed(id: string) {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET last_used_at = ?
      WHERE id = ?
    `);

    stmt.run(new Date().toISOString(), id);
  }

  /**
   * Get all API keys (without exposing the actual key value)
   */
  getAllApiKeys(): Omit<ApiKey, 'key'>[] {
    const stmt = this.db.prepare(`
      SELECT id, name, created_at, last_used_at, enabled, metadata
      FROM api_keys
      ORDER BY created_at DESC
    `);

    const rows = stmt.all() as {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
      enabled: number;
      metadata: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      enabled: row.enabled === 1,
      metadata: JSON.parse(row.metadata),
    }));
  }

  /**
   * Get a specific API key by ID (without exposing the actual key value)
   */
  getApiKeyById(id: string): Omit<ApiKey, 'key'> | null {
    const stmt = this.db.prepare(`
      SELECT id, name, created_at, last_used_at, enabled, metadata
      FROM api_keys
      WHERE id = ?
    `);

    const row = stmt.get(id) as {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
      enabled: number;
      metadata: string;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      enabled: row.enabled === 1,
      metadata: JSON.parse(row.metadata),
    };
  }

  /**
   * Revoke (disable) an API key
   */
  revokeApiKey(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET enabled = 0
      WHERE id = ?
    `);

    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ keyId: id }, 'API key revoked');
      return true;
    }

    return false;
  }

  /**
   * Enable a revoked API key
   */
  enableApiKey(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET enabled = 1
      WHERE id = ?
    `);

    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ keyId: id }, 'API key enabled');
      return true;
    }

    return false;
  }

  /**
   * Delete an API key permanently
   */
  deleteApiKey(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM api_keys
      WHERE id = ?
    `);

    const result = stmt.run(id);

    if (result.changes > 0) {
      logger.info({ keyId: id }, 'API key deleted');
      return true;
    }

    return false;
  }

  /**
   * Close the database connection
   */
  close() {
    this.db.close();
  }
}

// Singleton instance
export const apiKeyStore = new ApiKeyStore('./data/mcp-connect.db');
