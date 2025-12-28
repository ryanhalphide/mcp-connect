import OpenAI from 'openai';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'embeddings' });

export class EmbeddingsService {
  private client: OpenAI | null = null;
  private model = 'text-embedding-3-small';
  private enabled = false;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      this.enabled = true;
      logger.info({ model: this.model }, 'OpenAI embeddings service initialized');
    } else {
      logger.warn('OPENAI_API_KEY not found - semantic search will be disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client || !this.enabled) {
      throw new Error('Embeddings service is not enabled. Set OPENAI_API_KEY environment variable.');
    }

    try {
      logger.debug({ textLength: text.length }, 'Generating embedding');

      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      const embedding = response.data[0].embedding;
      logger.debug({ dimensions: embedding.length }, 'Embedding generated');

      return embedding;
    } catch (error) {
      logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.client || !this.enabled) {
      throw new Error('Embeddings service is not enabled. Set OPENAI_API_KEY environment variable.');
    }

    try {
      logger.debug({ count: texts.length }, 'Generating batch embeddings');

      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });

      const embeddings = response.data.map(item => item.embedding);
      logger.debug({ count: embeddings.length }, 'Batch embeddings generated');

      return embeddings;
    } catch (error) {
      logger.error({ error }, 'Failed to generate batch embeddings');
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return similarity;
  }

  getModel(): string {
    return this.model;
  }
}

// Singleton instance
export const embeddingsService = new EmbeddingsService();
