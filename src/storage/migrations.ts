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

// Migration 002: Webhook subscriptions and deliveries
export const migration002: Migration = {
  version: 2,
  name: 'webhook_tables',
  up: (db) => {
    // Webhook subscriptions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        events_json TEXT NOT NULL,
        secret TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        server_filter_json TEXT,
        retry_count INTEGER NOT NULL DEFAULT 3,
        retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_enabled
        ON webhook_subscriptions(enabled);
    `);

    // Webhook deliveries table
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        response_status INTEGER,
        response_body TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription
        ON webhook_deliveries(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
        ON webhook_deliveries(status);
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created
        ON webhook_deliveries(created_at);
    `);

    logger.info('Migration 002: Webhook tables created successfully');
  },
};

// Migration 003: Semantic search embeddings
export const migration003: Migration = {
  version: 3,
  name: 'semantic_search',
  up: (db) => {
    // Semantic embeddings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_embeddings (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('tool', 'resource', 'prompt')),
        entity_id TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        text_content TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(entity_type, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_semantic_entity_type
        ON semantic_embeddings(entity_type);
      CREATE INDEX IF NOT EXISTS idx_semantic_entity_id
        ON semantic_embeddings(entity_id);
      CREATE INDEX IF NOT EXISTS idx_semantic_entity_name
        ON semantic_embeddings(entity_name);
    `);

    logger.info('Migration 003: Semantic search tables created successfully');
  },
};

// Migration 004: Workflow orchestration
export const migration004: Migration = {
  version: 4,
  name: 'workflow_orchestration',
  up: (db) => {
    // Workflows table
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        definition_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_name
        ON workflows(name);
      CREATE INDEX IF NOT EXISTS idx_workflows_enabled
        ON workflows(enabled);
    `);

    // Workflow executions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        input_json TEXT,
        output_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        triggered_by TEXT,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow
        ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_status
        ON workflow_executions(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_started
        ON workflow_executions(started_at);
    `);

    // Workflow execution steps table
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_execution_steps (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        step_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
        input_json TEXT,
        output_json TEXT,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_execution
        ON workflow_execution_steps(execution_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_status
        ON workflow_execution_steps(status);
    `);

    logger.info('Migration 004: Workflow orchestration tables created successfully');
  },
};

// Migration 005: Enterprise features (RBAC, multi-tenancy, audit, usage tracking)
export const migration005: Migration = {
  version: 5,
  name: 'enterprise_features',
  up: (db) => {
    // Tenants table
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        metadata_json TEXT DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tenants_name
        ON tenants(name);
      CREATE INDEX IF NOT EXISTS idx_tenants_enabled
        ON tenants(enabled);
    `);

    // Add tenant_id to api_keys table (if not exists)
    try {
      db.exec(`ALTER TABLE api_keys ADD COLUMN tenant_id TEXT REFERENCES tenants(id)`);
    } catch (error) {
      // Column might already exist from a previous migration attempt
      if (!(error instanceof Error) || !error.message.includes('duplicate column')) {
        throw error;
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)`);

    // RBAC: Roles table
    db.exec(`
      CREATE TABLE IF NOT EXISTS rbac_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        tenant_id TEXT REFERENCES tenants(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, tenant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rbac_roles_name
        ON rbac_roles(name);
      CREATE INDEX IF NOT EXISTS idx_rbac_roles_tenant
        ON rbac_roles(tenant_id);
    `);

    // RBAC: Permissions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS rbac_permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        description TEXT DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource
        ON rbac_permissions(resource);
    `);

    // RBAC: Role-Permission mapping
    db.exec(`
      CREATE TABLE IF NOT EXISTS rbac_role_permissions (
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_role
        ON rbac_role_permissions(role_id);
    `);

    // RBAC: API Key-Role mapping
    db.exec(`
      CREATE TABLE IF NOT EXISTS rbac_api_key_roles (
        api_key_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (api_key_id, role_id),
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rbac_api_key_roles_key
        ON rbac_api_key_roles(api_key_id);
    `);

    // Audit log table - migrate from old schema if exists
    // Check if audit_log table exists with old schema
    const auditTableInfo = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>;
    const hasOldSchema = auditTableInfo.length > 0 && auditTableInfo.some((col) => col.name === 'details_json');

    if (hasOldSchema) {
      // Migrate from old schema to new schema
      logger.info('Migrating audit_log from old schema to new schema');

      // Create new table with new schema
      db.exec(`
        CREATE TABLE audit_log_new (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          api_key_id TEXT,
          tenant_id TEXT,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          server_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
          duration_ms INTEGER,
          metadata_json TEXT DEFAULT '{}',
          error TEXT,
          FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
        );
      `);

      // Migrate existing data (map old columns to new ones)
      db.exec(`
        INSERT INTO audit_log_new (id, timestamp, api_key_id, action, resource_type, resource_id, status, duration_ms, metadata_json)
        SELECT
          id,
          timestamp,
          api_key_id,
          action,
          resource_type,
          resource_id,
          CASE WHEN success = 1 THEN 'success' ELSE 'failure' END as status,
          duration_ms,
          details_json as metadata_json
        FROM audit_log;
      `);

      // Drop old table and rename new one
      db.exec(`
        DROP TABLE audit_log;
        ALTER TABLE audit_log_new RENAME TO audit_log;
      `);

      logger.info('Audit log migration completed');
    } else {
      // Create table with new schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          api_key_id TEXT,
          tenant_id TEXT,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          server_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
          duration_ms INTEGER,
          metadata_json TEXT DEFAULT '{}',
          error TEXT,
          FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
        );
      `);
    }

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_tenant
        ON audit_log(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action
        ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_resource_type
        ON audit_log(resource_type);
    `);

    // Usage metrics table
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_metrics (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        api_key_id TEXT,
        tenant_id TEXT,
        server_id TEXT,
        action_type TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER,
        tokens_used INTEGER DEFAULT 0,
        cost_credits REAL DEFAULT 0,
        metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_timestamp
        ON usage_metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_tenant
        ON usage_metrics(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_usage_api_key
        ON usage_metrics(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_usage_server
        ON usage_metrics(server_id);
      CREATE INDEX IF NOT EXISTS idx_usage_action_type
        ON usage_metrics(action_type);
    `);

    logger.info('Migration 005: Enterprise features tables created successfully');
  },
};

// Migration 006: Parallel feature implementation (Sampling, Templates, Budgets, KeyGuardian)
export const migration006: Migration = {
  version: 6,
  name: 'feature_development_all_tracks',
  up: (db) => {
    // TRACK 1: Cost tracking columns for workflow_execution_steps
    // These columns enable LLM cost tracking in workflows
    // SQLite requires separate ALTER TABLE statements
    try {
      db.exec(`ALTER TABLE workflow_execution_steps ADD COLUMN tokens_used INTEGER DEFAULT 0;`);
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) throw e;
    }

    try {
      db.exec(`ALTER TABLE workflow_execution_steps ADD COLUMN cost_credits REAL DEFAULT 0;`);
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) throw e;
    }

    try {
      db.exec(`ALTER TABLE workflow_execution_steps ADD COLUMN model_name TEXT;`);
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) throw e;
    }

    try {
      db.exec(`ALTER TABLE workflow_execution_steps ADD COLUMN duration_ms INTEGER;`);
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) throw e;
    }

    // TRACK 3: Workflow templates library
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        category TEXT NOT NULL,
        tags_json TEXT DEFAULT '[]',
        difficulty TEXT CHECK(difficulty IN ('beginner', 'intermediate', 'advanced')) DEFAULT 'beginner',
        estimated_cost_credits REAL DEFAULT 0,
        estimated_duration_ms INTEGER DEFAULT 0,
        definition_json TEXT NOT NULL,
        parameter_schema_json TEXT DEFAULT '{}',
        is_built_in INTEGER NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_templates_category
        ON workflow_templates(category);
      CREATE INDEX IF NOT EXISTS idx_workflow_templates_difficulty
        ON workflow_templates(difficulty);
      CREATE INDEX IF NOT EXISTS idx_workflow_templates_is_built_in
        ON workflow_templates(is_built_in);
      CREATE INDEX IF NOT EXISTS idx_workflow_templates_usage
        ON workflow_templates(usage_count DESC);
    `);

    // TRACK 4A: Cost budget system
    db.exec(`
      CREATE TABLE IF NOT EXISTS cost_budgets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('workflow', 'tenant', 'api_key', 'global')),
        scope_id TEXT,
        budget_credits REAL NOT NULL,
        period TEXT NOT NULL CHECK(period IN ('daily', 'weekly', 'monthly', 'total')),
        period_start TEXT NOT NULL,
        period_end TEXT,
        current_spend REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        enforce_limit INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(scope, scope_id, period)
      );

      CREATE INDEX IF NOT EXISTS idx_budgets_scope
        ON cost_budgets(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_budgets_enabled
        ON cost_budgets(enabled);
      CREATE INDEX IF NOT EXISTS idx_budgets_period_end
        ON cost_budgets(period_end);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS budget_alerts (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        threshold_percent INTEGER NOT NULL CHECK(threshold_percent IN (50, 75, 90, 100)),
        triggered_at TEXT,
        notification_sent INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (budget_id) REFERENCES cost_budgets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_budget_alerts_budget
        ON budget_alerts(budget_id);
      CREATE INDEX IF NOT EXISTS idx_budget_alerts_threshold
        ON budget_alerts(threshold_percent);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS budget_violations (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        workflow_execution_id TEXT,
        exceeded_by_credits REAL NOT NULL,
        action_taken TEXT NOT NULL CHECK(action_taken IN ('alert_only', 'workflow_paused', 'execution_blocked')),
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (budget_id) REFERENCES cost_budgets(id) ON DELETE CASCADE,
        FOREIGN KEY (workflow_execution_id) REFERENCES workflow_executions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_budget_violations_budget
        ON budget_violations(budget_id);
      CREATE INDEX IF NOT EXISTS idx_budget_violations_occurred
        ON budget_violations(occurred_at);
    `);

    // TRACK 4B: KeyGuardian API protection
    db.exec(`
      CREATE TABLE IF NOT EXISTS key_exposure_detections (
        id TEXT PRIMARY KEY,
        detection_type TEXT NOT NULL CHECK(detection_type IN ('workflow_definition', 'tool_parameter', 'prompt_argument', 'resource_uri')),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        key_pattern TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        location TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('high', 'medium', 'low')) DEFAULT 'high',
        action_taken TEXT NOT NULL CHECK(action_taken IN ('blocked', 'masked', 'logged')) DEFAULT 'blocked',
        api_key_id TEXT,
        tenant_id TEXT,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        resolution_notes TEXT,
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_key_exposure_entity
        ON key_exposure_detections(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_key_exposure_detected
        ON key_exposure_detections(detected_at);
      CREATE INDEX IF NOT EXISTS idx_key_exposure_resolved
        ON key_exposure_detections(resolved_at);
      CREATE INDEX IF NOT EXISTS idx_key_exposure_severity
        ON key_exposure_detections(severity);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS key_patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        pattern TEXT NOT NULL,
        description TEXT NOT NULL,
        provider TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('high', 'medium', 'low')) DEFAULT 'high',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_key_patterns_provider
        ON key_patterns(provider);
      CREATE INDEX IF NOT EXISTS idx_key_patterns_enabled
        ON key_patterns(enabled);
    `);

    logger.info('Migration 006: All track tables created successfully (Sampling cost tracking, Templates, Budgets, KeyGuardian)');
  },
};

// Export all migrations in order
export const allMigrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
];
