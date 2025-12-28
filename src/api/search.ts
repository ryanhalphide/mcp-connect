import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiResponse } from '../core/types.js';
import { SemanticSearchService, type EntityType } from '../core/semanticSearch.js';
import { serverDatabase } from '../storage/db.js';
import { embeddingsService } from '../core/embeddings.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'search-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

export const searchApi = new Hono();

// Schema for search query
const SearchQuerySchema = z.object({
  q: z.string().min(1, 'Query is required'),
  types: z.string().optional().transform((val): EntityType[] => {
    if (!val) return ['tool', 'resource', 'prompt'];
    return val.split(',').filter(t => ['tool', 'resource', 'prompt'].includes(t)) as EntityType[];
  }),
  limit: z.coerce.number().min(1).max(50).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.7),
});

/**
 * GET /search
 * Semantic search across tools, resources, and prompts
 */
searchApi.get('/', async (c) => {
  if (!embeddingsService.isEnabled()) {
    return c.json(
      apiResponse(
        null,
        false,
        'Semantic search is not enabled. Set OPENAI_API_KEY environment variable.'
      ),
      503
    );
  }

  try {
    const queryParams = c.req.query();
    const validated = SearchQuerySchema.parse(queryParams);

    const searchService = new SemanticSearchService(serverDatabase.getDatabase());
    const results = await searchService.search(validated.q, {
      types: validated.types,
      limit: validated.limit,
      threshold: validated.threshold,
    });

    logger.info(
      {
        query: validated.q,
        types: validated.types,
        resultsCount: results.length,
        threshold: validated.threshold,
      },
      'Search completed'
    );

    return c.json(
      apiResponse({
        query: validated.q,
        results,
        count: results.length,
        threshold: validated.threshold,
      })
    );
  } catch (error) {
    logger.error({ error }, 'Search failed');
    if (error instanceof z.ZodError) {
      return c.json(apiResponse(null, false, `Validation error: ${error.message}`), 400);
    }
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Search failed'),
      500
    );
  }
});

/**
 * GET /search/stats
 * Get search/embedding statistics
 */
searchApi.get('/stats', (c) => {
  try {
    const searchService = new SemanticSearchService(serverDatabase.getDatabase());
    const stats = searchService.getStats();

    return c.json(
      apiResponse({
        ...stats,
        enabled: embeddingsService.isEnabled(),
        model: embeddingsService.getModel(),
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to get stats');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Unknown error'),
      500
    );
  }
});

/**
 * POST /search/reindex
 * Reindex all entities (admin only)
 */
searchApi.post('/reindex', async (c) => {
  if (!embeddingsService.isEnabled()) {
    return c.json(
      apiResponse(
        null,
        false,
        'Semantic search is not enabled. Set OPENAI_API_KEY environment variable.'
      ),
      503
    );
  }

  try {
    logger.info('Starting reindexing via API');

    const searchService = new SemanticSearchService(serverDatabase.getDatabase());
    const result = await searchService.reindexAll();

    logger.info({ result }, 'Reindexing completed via API');

    return c.json(
      apiResponse({
        ...result,
        total: result.tools + result.resources + result.prompts,
        message: 'Reindexing completed successfully',
      })
    );
  } catch (error) {
    logger.error({ error }, 'Reindexing failed');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Reindexing failed'),
      500
    );
  }
});

/**
 * DELETE /search/index
 * Clear all embeddings (admin only)
 */
searchApi.delete('/index', (c) => {
  try {
    logger.info('Clearing search index via API');

    const searchService = new SemanticSearchService(serverDatabase.getDatabase());
    searchService.clearAll();

    logger.info('Search index cleared via API');

    return c.json(
      apiResponse({
        message: 'Search index cleared successfully',
      })
    );
  } catch (error) {
    logger.error({ error }, 'Failed to clear index');
    return c.json(
      apiResponse(null, false, error instanceof Error ? error.message : 'Failed to clear index'),
      500
    );
  }
});
