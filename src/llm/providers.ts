/**
 * LLM Provider Abstraction
 * Supports OpenAI and Anthropic providers with unified interface
 */

import { createChildLogger } from '../observability/logger.js';
import { encoding_for_model } from 'tiktoken';

const logger = createChildLogger({ module: 'llm-providers' });

// Provider types
export type ProviderType = 'openai' | 'anthropic';

// Message types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Provider configuration
export interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
}

// LLM request parameters
export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

// Unified response format
export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
  provider: ProviderType;
  raw?: unknown; // Original provider response
}

// Provider errors
export class ProviderError extends Error {
  constructor(
    public provider: ProviderType,
    message: string,
    public statusCode?: number,
    public originalError?: unknown
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    provider: ProviderType,
    public retryAfter?: number
  ) {
    super(provider, 'Rate limit exceeded', 429);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: ProviderType) {
    super(provider, 'Authentication failed - check API key', 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Base provider interface
 */
export interface LLMProvider {
  readonly type: ProviderType;
  complete(request: LLMRequest): Promise<LLMResponse>;
  countTokens(text: string, model: string): number;
  isModelSupported(model: string): boolean;
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements LLMProvider {
  readonly type: ProviderType = 'openai';
  private config: ProviderConfig;

  // Supported models
  private readonly supportedModels = [
    'gpt-4-turbo',
    'gpt-4',
    'gpt-4-turbo-preview',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
  ];

  constructor(config: ProviderConfig) {
    this.config = {
      baseURL: 'https://api.openai.com/v1',
      timeout: 60000,
      ...config,
    };

    if (!this.config.apiKey) {
      throw new AuthenticationError('openai');
    }

    logger.info({ provider: 'openai', baseURL: this.config.baseURL }, 'OpenAI provider initialized');
  }

  /**
   * Complete a chat request
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isModelSupported(request.model)) {
      throw new ProviderError('openai', `Unsupported model: ${request.model}`);
    }

    logger.debug(
      {
        model: request.model,
        messages: request.messages.length,
        maxTokens: request.maxTokens,
      },
      'OpenAI completion request'
    );

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          top_p: request.topP,
          stop: request.stopSequences,
        }),
        signal: AbortSignal.timeout(this.config.timeout!),
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = (await response.json()) as {
        model: string;
        choices: Array<{
          message: { content: string };
          finish_reason: string;
        }>;
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      logger.debug(
        {
          model: data.model,
          usage: data.usage,
          finishReason: data.choices[0]?.finish_reason,
        },
        'OpenAI completion successful'
      );

      return {
        content: data.choices[0]?.message?.content || '',
        model: data.model,
        usage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: this.mapFinishReason(data.choices[0]?.finish_reason),
        provider: 'openai',
        raw: data,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      logger.error({ error, model: request.model }, 'OpenAI completion failed');
      throw new ProviderError('openai', 'Request failed', undefined, error);
    }
  }

  /**
   * Count tokens using tiktoken
   */
  countTokens(text: string, model: string): number {
    try {
      // Map model to tiktoken model
      const encodingModel = this.getEncodingModel(model);
      const encoding = encoding_for_model(encodingModel as any);
      const tokens = encoding.encode(text);
      encoding.free();
      return tokens.length;
    } catch (error) {
      // Fallback: rough estimate (1 token ≈ 4 characters)
      logger.warn({ error, model }, 'Token counting failed, using fallback');
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Check if model is supported
   */
  isModelSupported(model: string): boolean {
    return this.supportedModels.includes(model);
  }

  /**
   * Map OpenAI finish reason to unified format
   */
  private mapFinishReason(reason: string | undefined): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
      case 'max_tokens':
        return 'length';
      default:
        return 'error';
    }
  }

  /**
   * Get tiktoken encoding model name
   */
  private getEncodingModel(model: string): string {
    if (model.startsWith('gpt-4')) return 'gpt-4';
    if (model.startsWith('gpt-3.5')) return 'gpt-3.5-turbo';
    return 'gpt-3.5-turbo';
  }

  /**
   * Handle API errors
   */
  private async handleError(response: Response): Promise<never> {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: { message: string };
    };

    if (response.status === 401) {
      throw new AuthenticationError('openai');
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError('openai', retryAfter ? parseInt(retryAfter) * 1000 : undefined);
    }

    throw new ProviderError(
      'openai',
      errorData.error?.message || `HTTP ${response.status}`,
      response.status,
      errorData
    );
  }
}

/**
 * Anthropic Provider Implementation
 */
export class AnthropicProvider implements LLMProvider {
  readonly type: ProviderType = 'anthropic';
  private config: ProviderConfig;

  // Supported models
  private readonly supportedModels = [
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    'claude-3.5-sonnet-20241022',
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
    'claude-3.5-sonnet',
  ];

  constructor(config: ProviderConfig) {
    this.config = {
      baseURL: 'https://api.anthropic.com/v1',
      timeout: 60000,
      ...config,
    };

    if (!this.config.apiKey) {
      throw new AuthenticationError('anthropic');
    }

    logger.info({ provider: 'anthropic', baseURL: this.config.baseURL }, 'Anthropic provider initialized');
  }

  /**
   * Complete a chat request
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isModelSupported(request.model)) {
      throw new ProviderError('anthropic', `Unsupported model: ${request.model}`);
    }

    logger.debug(
      {
        model: request.model,
        messages: request.messages.length,
        maxTokens: request.maxTokens,
      },
      'Anthropic completion request'
    );

    // Extract system message if present
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const messages = request.messages.filter((m) => m.role !== 'system');

    try {
      const response = await fetch(`${this.config.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          messages: messages,
          system: systemMessage?.content,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature,
          top_p: request.topP,
          stop_sequences: request.stopSequences,
        }),
        signal: AbortSignal.timeout(this.config.timeout!),
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = (await response.json()) as {
        model: string;
        content: Array<{ text: string }>;
        stop_reason: string;
        usage: {
          input_tokens: number;
          output_tokens: number;
        };
      };

      logger.debug(
        {
          model: data.model,
          usage: data.usage,
          stopReason: data.stop_reason,
        },
        'Anthropic completion successful'
      );

      return {
        content: data.content[0]?.text || '',
        model: data.model,
        usage: {
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        finishReason: this.mapStopReason(data.stop_reason),
        provider: 'anthropic',
        raw: data,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      logger.error({ error, model: request.model }, 'Anthropic completion failed');
      throw new ProviderError('anthropic', 'Request failed', undefined, error);
    }
  }

  /**
   * Count tokens (character-based estimation for Anthropic)
   * Anthropic uses ~3.5 characters per token on average
   */
  countTokens(text: string, model: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Check if model is supported
   */
  isModelSupported(model: string): boolean {
    return this.supportedModels.includes(model);
  }

  /**
   * Map Anthropic stop reason to unified format
   */
  private mapStopReason(reason: string | undefined): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      default:
        return 'error';
    }
  }

  /**
   * Handle API errors
   */
  private async handleError(response: Response): Promise<never> {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: { message: string };
    };

    if (response.status === 401) {
      throw new AuthenticationError('anthropic');
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError('anthropic', retryAfter ? parseInt(retryAfter) * 1000 : undefined);
    }

    throw new ProviderError(
      'anthropic',
      errorData.error?.message || `HTTP ${response.status}`,
      response.status,
      errorData
    );
  }
}

/**
 * Provider Registry
 * Manages multiple LLM providers
 */
export class ProviderRegistry {
  private providers: Map<ProviderType, LLMProvider> = new Map();

  constructor() {
    logger.info('Provider registry initialized');
  }

  /**
   * Register a provider
   */
  register(provider: LLMProvider): void {
    this.providers.set(provider.type, provider);
    logger.info({ provider: provider.type }, 'Provider registered');
  }

  /**
   * Unregister a provider
   */
  unregister(type: ProviderType): void {
    this.providers.delete(type);
    logger.info({ provider: type }, 'Provider unregistered');
  }

  /**
   * Get a provider by type
   */
  getProvider(type: ProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get provider for a specific model
   */
  getProviderForModel(model: string): LLMProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.isModelSupported(model)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * List all registered providers
   */
  listProviders(): { type: ProviderType; models: string[] }[] {
    const result: { type: ProviderType; models: string[] }[] = [];

    for (const provider of this.providers.values()) {
      const models: string[] = [];

      // Get supported models
      if (provider.type === 'openai') {
        models.push('gpt-4-turbo', 'gpt-3.5-turbo');
      } else if (provider.type === 'anthropic') {
        models.push('claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku');
      }

      result.push({ type: provider.type, models });
    }

    return result;
  }

  /**
   * Check if any provider is registered
   */
  hasProviders(): boolean {
    return this.providers.size > 0;
  }

  /**
   * Complete a request using the appropriate provider
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const provider = this.getProviderForModel(request.model);

    if (!provider) {
      throw new Error(`No provider found for model: ${request.model}`);
    }

    return provider.complete(request);
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

/**
 * Initialize providers from environment variables
 */
export function initializeProviders(): void {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openaiKey) {
    try {
      const provider = new OpenAIProvider({ apiKey: openaiKey });
      providerRegistry.register(provider);
      logger.info('OpenAI provider initialized from environment');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize OpenAI provider');
    }
  }

  if (anthropicKey) {
    try {
      const provider = new AnthropicProvider({ apiKey: anthropicKey });
      providerRegistry.register(provider);
      logger.info('Anthropic provider initialized from environment');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Anthropic provider');
    }
  }

  if (!providerRegistry.hasProviders()) {
    logger.warn('No LLM providers configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variables.');
  }
}
