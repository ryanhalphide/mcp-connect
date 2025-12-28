import Database from 'better-sqlite3';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'favorites' });

export interface Favorite {
  id: number;
  apiKeyId: string;
  toolName: string;
  notes?: string;
  createdAt: Date;
}

export class FavoriteStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(api_key_id, tool_name)
      );

      CREATE INDEX IF NOT EXISTS idx_favorites_api_key ON favorites(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_favorites_tool ON favorites(tool_name);
    `);
    logger.info('Favorites table initialized');
  }

  addFavorite(apiKeyId: string, toolName: string, notes?: string): Favorite {
    const now = new Date();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO favorites (api_key_id, tool_name, notes, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(apiKeyId, toolName, notes || null, now.toISOString());

    logger.info({ apiKeyId, toolName }, 'Favorite added');

    return {
      id: result.lastInsertRowid as number,
      apiKeyId,
      toolName,
      notes,
      createdAt: now,
    };
  }

  removeFavorite(apiKeyId: string, toolName: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM favorites WHERE api_key_id = ? AND tool_name = ?
    `);

    const result = stmt.run(apiKeyId, toolName);

    if (result.changes > 0) {
      logger.info({ apiKeyId, toolName }, 'Favorite removed');
      return true;
    }

    return false;
  }

  isFavorite(apiKeyId: string, toolName: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM favorites WHERE api_key_id = ? AND tool_name = ?
    `);

    return stmt.get(apiKeyId, toolName) !== undefined;
  }

  getFavorites(apiKeyId: string): Favorite[] {
    const stmt = this.db.prepare(`
      SELECT id, api_key_id, tool_name, notes, created_at
      FROM favorites
      WHERE api_key_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(apiKeyId) as Array<{
      id: number;
      api_key_id: string;
      tool_name: string;
      notes: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      apiKeyId: row.api_key_id,
      toolName: row.tool_name,
      notes: row.notes || undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  getFavoriteCount(apiKeyId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM favorites WHERE api_key_id = ?
    `);

    const row = stmt.get(apiKeyId) as { count: number };
    return row.count;
  }

  getMostFavorited(limit: number = 10): Array<{ toolName: string; count: number }> {
    const stmt = this.db.prepare(`
      SELECT tool_name, COUNT(*) as count
      FROM favorites
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<{ tool_name: string; count: number }>;

    return rows.map((row) => ({
      toolName: row.tool_name,
      count: row.count,
    }));
  }

  updateNotes(apiKeyId: string, toolName: string, notes: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE favorites SET notes = ? WHERE api_key_id = ? AND tool_name = ?
    `);

    const result = stmt.run(notes, apiKeyId, toolName);

    if (result.changes > 0) {
      logger.info({ apiKeyId, toolName }, 'Favorite notes updated');
      return true;
    }

    return false;
  }

  clearFavorites(apiKeyId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM favorites WHERE api_key_id = ?
    `);

    const result = stmt.run(apiKeyId);
    logger.info({ apiKeyId, count: result.changes }, 'Favorites cleared');

    return result.changes;
  }
}

// Access the underlying database connection
// We need to add a method to get the database or use a shared connection
// For now, create a separate favorites database or extend ServerDatabase

// Create a separate in-memory store for now, can be integrated later
const favoritesDb = new Database(process.env.DB_PATH || './data/mcp-connect.db');
export const favoriteStore = new FavoriteStore(favoritesDb);
