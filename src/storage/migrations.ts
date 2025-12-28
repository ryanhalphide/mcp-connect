import Database from 'better-sqlite3';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'migrations' });

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export class MigrationManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureMigrationsTable();
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  async runMigrations(migrations: Migration[]): Promise<void> {
    const applied = this.getAppliedMigrations();
    const pending = migrations
      .filter((m) => !applied.has(m.version))
      .sort((a, b) => a.version - b.version);

    if (pending.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info({ count: pending.length }, 'Running pending migrations');

    for (const migration of pending) {
      logger.info({ version: migration.version, name: migration.name }, 'Applying migration');

      const transaction = this.db.transaction(() => {
        migration.up(this.db);
        this.recordMigration(migration.version, migration.name);
      });

      transaction();

      logger.info({ version: migration.version, name: migration.name }, 'Migration applied successfully');
    }
  }

  private getAppliedMigrations(): Set<number> {
    const stmt = this.db.prepare('SELECT version FROM schema_migrations');
    const rows = stmt.all() as Array<{ version: number }>;
    return new Set(rows.map((r) => r.version));
  }

  private recordMigration(version: number, name: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO schema_migrations (version, name)
      VALUES (?, ?)
    `);
    stmt.run(version, name);
  }

  getStatus(migrations: Migration[]) {
    const applied = this.getAppliedMigrations();
    const appliedList = migrations.filter((m) => applied.has(m.version));
    const pendingList = migrations.filter((m) => !applied.has(m.version));

    return {
      current: appliedList.length > 0 ? Math.max(...appliedList.map((m) => m.version)) : 0,
      latest: migrations.length > 0 ? Math.max(...migrations.map((m) => m.version)) : 0,
      pending: pendingList.length,
      applied: appliedList.map((m) => ({ version: m.version, name: m.name })),
      pendingList: pendingList.map((m) => ({ version: m.version, name: m.name })),
    };
  }
}

// Migration 001: Foundation tables for reliability improvements
export const migration001: Migration = {
  version: 1,
  name: 'foundation_tables',
  up: (db) => {
    // Rate limit state table - persistent per-API-key + per-server rate limiting
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        id TEXT PRIMARY KEY,
        api_key_id TEXT NOT NULL,
        server_id TEXT,
        minute_count INTEGER NOT NULL DEFAULT 0,
        minute_reset_at INTEGER NOT NULL,
        day_count INTEGER NOT NULL DEFAULT 0,
        day_reset_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_api_key
        ON rate_limit_state(api_key_id, server_id);
      CREATE INDEX IF NOT EXISTS idx_rate_limit_reset
        ON rate_limit_state(minute_reset_at, day_reset_at);
    `);

    // Response cache table - two-tier caching (memory + SQLite)
    db.exec(`
      CREATE TABLE IF NOT EXISTS response_cache (
        id TEXT PRIMARY KEY,
        cache_key TEXT UNIQUE NOT NULL,
        cache_type TEXT NOT NULL CHECK(cache_type IN ('tool', 'resource', 'prompt')),
        server_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        ttl_seconds INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_hit_at TEXT,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cache_key ON response_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_cache_expiry ON response_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_cache_server ON response_cache(server_id);
      CREATE INDEX IF NOT EXISTS idx_cache_type ON response_cache(cache_type);
    `);

    // Circuit breaker state table - per-server failure tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS circuit_breaker_state (
        server_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('CLOSED', 'OPEN', 'HALF_OPEN')) DEFAULT 'CLOSED',
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER,
        opened_at INTEGER,
        last_state_change INTEGER NOT NULL,
        consecutive_successes INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_circuit_breaker_state
        ON circuit_breaker_state(state);
    `);

    logger.info('Migration 001: Foundation tables created successfully');
  },
};

// Export all migrations in order
export const allMigrations: Migration[] = [migration001];
