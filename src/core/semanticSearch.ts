import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { embeddingsService } from './embeddings.js';
import { toolRegistry } from './registry.js';
import { resourceRegistry } from './resourceRegistry.js';
import { promptRegistry } from './promptRegistry.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'semantic-search' });

export type EntityType = 'tool' | 'resource' | 'prompt';

export interface EmbeddingEntry {
  id: string;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  textContent: string;
  embedding: number[];
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  textContent: string;
  similarity: number;
  entity: unknown; // The actual tool/resource/prompt object
}

export interface SearchOptions {
  types?: EntityType[];
  limit?: number;
  threshold?: number; // Minimum similarity threshold (0-1)
}

export class SemanticSearchService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Generate and store embedding for an entity
   */
  async indexEntity(
    entityType: EntityType,
    entityId: string,
    entityName: string,
    textContent: string
  ): Promise<void> {
    if (!embeddingsService.isEnabled()) {
      logger.debug('Embeddings service not enabled, skipping indexing');
      return;
    }

    try {
      const embedding = await embeddingsService.generateEmbedding(textContent);

      const id = randomBytes(16).toString('hex');
      const embeddingJson = JSON.stringify(embedding);
      const model = embeddingsService.getModel();

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO semantic_embeddings
        (id, entity_type, entity_id, entity_name, text_content, embedding_json, embedding_model, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      stmt.run(id, entityType, entityId, entityName, textContent, embeddingJson, model);

      logger.debug({ entityType, entityId, entityName }, 'Entity indexed');
    } catch (error) {
      logger.error({ entityType, entityId, error }, 'Failed to index entity');
      throw error;
    }
  }

  /**
   * Search for similar entities using semantic similarity
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!embeddingsService.isEnabled()) {
      throw new Error('Semantic search is not enabled. Set OPENAI_API_KEY environment variable.');
    }

    const {
      types = ['tool', 'resource', 'prompt'],
      limit = 10,
      threshold = 0.7
    } = options;

    try {
      // Generate embedding for the query
      const queryEmbedding = await embeddingsService.generateEmbedding(query);

      // Get all embeddings from database
      let sql = 'SELECT * FROM semantic_embeddings';
      const params: string[] = [];

      if (types.length < 3) {
        sql += ' WHERE entity_type IN (' + types.map(() => '?').join(',') + ')';
        params.push(...types);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as Array<{
        id: string;
        entity_type: string;
        entity_id: string;
        entity_name: string;
        text_content: string;
        embedding_json: string;
        embedding_model: string;
        created_at: string;
        updated_at: string;
      }>;

      // Calculate similarities
      const results: SearchResult[] = [];

      for (const row of rows) {
        const embedding = JSON.parse(row.embedding_json) as number[];
        const similarity = embeddingsService.cosineSimilarity(queryEmbedding, embedding);

        if (similarity >= threshold) {
          // Get the actual entity object
          let entity: unknown = null;
          const entityType = row.entity_type as EntityType;

          if (entityType === 'tool') {
            entity = toolRegistry.findTool(row.entity_name);
          } else if (entityType === 'resource') {
            entity = resourceRegistry.findResource(row.entity_id);
          } else if (entityType === 'prompt') {
            entity = promptRegistry.findPrompt(row.entity_name);
          }

          if (entity) {
            results.push({
              entityType,
              entityId: row.entity_id,
              entityName: row.entity_name,
              textContent: row.text_content,
              similarity,
              entity,
            });
          }
        }
      }

      // Sort by similarity (highest first) and limit
      results.sort((a, b) => b.similarity - a.similarity);
      const limitedResults = results.slice(0, limit);

      logger.info(
        { query, resultsCount: limitedResults.length, threshold },
        'Semantic search completed'
      );

      return limitedResults;
    } catch (error) {
      logger.error({ query, error }, 'Semantic search failed');
      throw error;
    }
  }

  /**
   * Reindex all tools, resources, and prompts
   */
  async reindexAll(): Promise<{ tools: number; resources: number; prompts: number }> {
    if (!embeddingsService.isEnabled()) {
      throw new Error('Semantic search is not enabled. Set OPENAI_API_KEY environment variable.');
    }

    logger.info('Starting full reindexing');

    let toolsIndexed = 0;
    let resourcesIndexed = 0;
    let promptsIndexed = 0;

    // Clear existing embeddings
    this.db.prepare('DELETE FROM semantic_embeddings').run();

    // Index all tools
    const tools = toolRegistry.getAllTools();
    for (const tool of tools) {
      const textContent = `${tool.name}: ${tool.description || ''}. Tags: ${tool.tags.join(', ')}. Category: ${tool.category}`;
      await this.indexEntity('tool', tool.name, tool.name, textContent);
      toolsIndexed++;
    }

    // Index all resources
    const resources = resourceRegistry.getAllResources();
    for (const resource of resources) {
      const textContent = `${resource.name}: ${resource.description || ''}. URI: ${resource.uri}. MIME type: ${resource.mimeType || 'unknown'}`;
      await this.indexEntity('resource', resource.uri, resource.name, textContent);
      resourcesIndexed++;
    }

    // Index all prompts
    const prompts = promptRegistry.getAllPrompts();
    for (const prompt of prompts) {
      const argsList = prompt.arguments?.map(a => `${a.name} (${a.description || 'no description'})`).join(', ') || 'no arguments';
      const textContent = `${prompt.name}: ${prompt.description || ''}. Arguments: ${argsList}`;
      await this.indexEntity('prompt', prompt.name, prompt.name, textContent);
      promptsIndexed++;
    }

    logger.info(
      { toolsIndexed, resourcesIndexed, promptsIndexed },
      'Full reindexing completed'
    );

    return { tools: toolsIndexed, resources: resourcesIndexed, prompts: promptsIndexed };
  }

  /**
   * Get embedding statistics
   */
  getStats(): {
    total: number;
    byType: Array<{ type: string; count: number }>;
  } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM semantic_embeddings');
    const total = (totalStmt.get() as { count: number }).count;

    const byTypeStmt = this.db.prepare(`
      SELECT entity_type as type, COUNT(*) as count
      FROM semantic_embeddings
      GROUP BY entity_type
    `);
    const byType = byTypeStmt.all() as Array<{ type: string; count: number }>;

    return { total, byType };
  }

  /**
   * Clear all embeddings
   */
  clearAll(): void {
    this.db.prepare('DELETE FROM semantic_embeddings').run();
    logger.info('All embeddings cleared');
  }
}
