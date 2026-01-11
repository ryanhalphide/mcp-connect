import { Hono } from 'hono';
import type { ApiResponse } from '../core/types.js';
import { createChildLogger } from '../observability/logger.js';
import { providerRegistry, type LLMRequest, ProviderError } from '../llm/providers.js';
import { samplingSecurity, SecurityError } from '../llm/security.js';
import { circuitBreakerRegistry } from '../core/circuitBreaker.js';
import { z } from 'zod';

const logger = createChildLogger({ module: 'sampling-api' });

// Helper to create API response
function apiResponse<T>(data: T | null = null, success = true, error?: string): ApiResponse<T> {
  return {
    success,
    data: data as T,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Request validation schemas
const SamplingRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).optional(),
});

const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseURL: z.string().url().optional(),
});

export const samplingApi = new Hono();

/**
 * POST /sampling/request
 * Execute an LLM completion request
 */
samplingApi.post('/request', async (c) => {
  try {
    // Parse and validate request body
    const body = await c.req.json();
    const validationResult = SamplingRequestSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn({ errors: validationResult.error.errors }, 'Invalid sampling request');
      return c.json(apiResponse(null, false, 'Invalid request format'), 400 as any);
    }

    const request: LLMRequest = validationResult.data;

    // Get user ID from context (TODO: integrate with auth middleware)
    const userId = c.req.header('x-user-id') || 'anonymous';

    // Security validation
    const securityCheck = await samplingSecurity.validateRequest(userId, request);
    if (!securityCheck.valid) {
      logger.warn({ userId, error: securityCheck.error }, 'Security validation failed');
      return c.json(
        apiResponse(null, false, securityCheck.error?.message || 'Security check failed'),
        403 as any
      );
    }

    // Get provider for model
    const provider = providerRegistry.getProviderForModel(request.model);
    if (!provider) {
      logger.warn({ model: request.model }, 'No provider found for model');
      return c.json(apiResponse(null, false, `No provider available for model: ${request.model}`), 400 as any);
    }

    // Execute with circuit breaker
    const breaker = circuitBreakerRegistry.getBreaker(`llm-${provider.type}`);
    const response = await breaker.execute(async () => {
      return providerRegistry.complete(request);
    });

    // Track usage
    samplingSecurity.trackUsage(userId, response.usage.inputTokens, response.usage.outputTokens);

    logger.info(
      {
        userId,
        model: response.model,
        provider: response.provider,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
      'Sampling request completed'
    );

    return c.json(apiResponse(response));
  } catch (error) {
    if (error instanceof SecurityError) {
      logger.warn({ error: error.message, code: error.code }, 'Security error');
      return c.json(apiResponse(null, false, error.message), 403 as any);
    }

    if (error instanceof ProviderError) {
      logger.error({ error: error.message, provider: error.provider }, 'Provider error');
      return c.json(apiResponse(null, false, error.message), (error.statusCode || 500) as any);
    }

    logger.error({ error }, 'Sampling request failed');
    return c.json(apiResponse(null, false, 'Internal server error'), 500 as any);
  }
});

/**
 * GET /sampling/providers
 * List available LLM providers and their models
 */
samplingApi.get('/providers', (c) => {
  const providers = providerRegistry.listProviders();

  return c.json(
    apiResponse({
      providers: providers.map((p) => ({
        type: p.type,
        models: p.models,
        available: true,
      })),
      count: providers.length,
    })
  );
});

/**
 * POST /sampling/providers/:provider/configure
 * Configure an LLM provider (admin only)
 */
samplingApi.post('/providers/:provider/configure', async (c) => {
  const providerType = c.req.param('provider') as 'openai' | 'anthropic';

  // TODO: Add admin authentication middleware

  try {
    const body = await c.req.json();
    const validationResult = ProviderConfigSchema.safeParse(body);

    if (!validationResult.success) {
      return c.json(apiResponse(null, false, 'Invalid provider configuration'), 400 as any);
    }

    const config = validationResult.data;

    // Dynamically import and register provider
    if (providerType === 'openai') {
      const { OpenAIProvider } = await import('../llm/providers.js');
      const provider = new OpenAIProvider(config);
      providerRegistry.register(provider);
    } else if (providerType === 'anthropic') {
      const { AnthropicProvider } = await import('../llm/providers.js');
      const provider = new AnthropicProvider(config);
      providerRegistry.register(provider);
    } else {
      return c.json(apiResponse(null, false, `Unsupported provider: ${providerType}`), 400 as any);
    }

    logger.info({ provider: providerType }, 'Provider configured');

    return c.json(
      apiResponse({
        provider: providerType,
        configured: true,
      })
    );
  } catch (error) {
    logger.error({ error, provider: providerType }, 'Provider configuration failed');
    return c.json(apiResponse(null, false, 'Failed to configure provider'), 500 as any);
  }
});

/**
 * GET /sampling/usage
 * Get sampling usage statistics
 */
samplingApi.get('/usage', (c) => {
  // Get user ID from context
  const userId = c.req.header('x-user-id') || 'anonymous';

  const stats = samplingSecurity.getUsageStats(userId);

  return c.json(
    apiResponse({
      userId,
      dailyTokens: stats.dailyTokens,
      requestCount: stats.requestCount,
      remainingTokens: stats.remainingTokens,
      resetAt: stats.resetAt.toISOString(),
      limits: {
        maxTokensPerDay: samplingSecurity.getConfig().maxTokensPerDay,
        maxTokensPerRequest: samplingSecurity.getConfig().maxTokensPerRequest,
      },
    })
  );
});

/**
 * GET /sampling/info
 * Get information about sampling support
 */
samplingApi.get('/info', (c) => {
  const providers = providerRegistry.listProviders();
  const config = samplingSecurity.getConfig();

  return c.json(
    apiResponse({
      status: 'operational',
      description: 'LLM sampling API for workflow integration',
      providers: {
        available: providers.length,
        types: providers.map((p) => p.type),
      },
      security: {
        promptInjectionDetection: config.enablePromptInjectionDetection,
        contentFiltering: config.enableContentFiltering,
        piiDetection: config.enablePIIDetection,
      },
      limits: {
        maxTokensPerRequest: config.maxTokensPerRequest,
        maxTokensPerDay: config.maxTokensPerDay,
      },
      endpoints: {
        'POST /sampling/request': 'Execute LLM completion',
        'GET /sampling/providers': 'List available providers',
        'GET /sampling/usage': 'Get usage statistics',
        'POST /sampling/providers/:provider/configure': 'Configure provider (admin)',
      },
    })
  );
});
