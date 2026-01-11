/**
 * Security layer for LLM sampling
 * Implements prompt injection detection, rate limiting, and content filtering
 */

import { createChildLogger } from '../observability/logger.js';
import type { LLMMessage, LLMRequest } from './providers.js';

const logger = createChildLogger({ module: 'sampling-security' });

/**
 * Security error types
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class PromptInjectionError extends SecurityError {
  constructor(pattern: string) {
    super('Potential prompt injection detected', 'PROMPT_INJECTION', { pattern });
  }
}

export class TokenLimitError extends SecurityError {
  constructor(limit: number, actual: number) {
    super(`Token limit exceeded: ${actual} > ${limit}`, 'TOKEN_LIMIT', { limit, actual });
  }
}

export class ContentFilterError extends SecurityError {
  constructor(reason: string) {
    super('Content filtered', 'CONTENT_FILTER', { reason });
  }
}

/**
 * Usage tracking per user
 */
interface UsageState {
  dailyTokens: number;
  dailyResetAt: number;
  requestCount: number;
}

/**
 * Sampling security configuration
 */
export interface SecurityConfig {
  maxTokensPerRequest: number;
  maxTokensPerDay: number;
  enablePromptInjectionDetection: boolean;
  enableContentFiltering: boolean;
  enablePIIDetection: boolean;
}

const DEFAULT_CONFIG: SecurityConfig = {
  maxTokensPerRequest: 4000,
  maxTokensPerDay: 100000,
  enablePromptInjectionDetection: true,
  enableContentFiltering: true,
  enablePIIDetection: true,
};

/**
 * Sampling Security Manager
 */
export class SamplingSecurity {
  private config: SecurityConfig;
  private usageState: Map<string, UsageState> = new Map();

  // Prompt injection patterns
  private readonly injectionPatterns = [
    // Direct instruction overrides
    /ignore\s+(previous|above|all)\s+(instructions|prompts|context)/i,
    /disregard\s+(previous|above|all)\s+(instructions|prompts)/i,
    /forget\s+(previous|everything|all)\s+(instructions|context)/i,

    // System prompt manipulation
    /new\s+(instructions|system\s+prompt|role)/i,
    /you\s+are\s+now\s+(a|an)\s+\w+/i,
    /act\s+as\s+(a|an)\s+\w+/i,
    /pretend\s+(you\s+are|to\s+be)/i,

    // Delimiter attacks
    /\[SYSTEM\]/i,
    /\[INST\]/i,
    /<\|system\|>/i,
    /<\|im_start\|>/i,

    // Role confusion
    /from\s+now\s+on/i,
    /starting\s+now/i,
    /i\s+am\s+your\s+(admin|administrator|developer|creator)/i,

    // Jailbreak attempts
    /DAN\s+mode/i,
    /developer\s+mode/i,
    /bypass\s+(safety|restrictions|guardrails)/i,
    /ignore\s+(safety|ethics|restrictions)/i,
  ];

  // PII patterns (basic detection)
  private readonly piiPatterns = [
    // Social Security Numbers
    /\b\d{3}-\d{2}-\d{4}\b/,

    // Credit card numbers
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,

    // Email addresses (more specific pattern)
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,

    // Phone numbers (US format)
    /\b(\+1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,

    // API keys (common formats)
    /\b(sk|pk)_live_[a-zA-Z0-9]{24,}\b/,
    /\b[A-Za-z0-9_-]{32,}\b/,
  ];

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info({ config: this.config }, 'Sampling security initialized');
  }

  /**
   * Validate and sanitize a sampling request
   */
  async validateRequest(
    userId: string,
    request: LLMRequest
  ): Promise<{ valid: boolean; error?: SecurityError }> {
    try {
      // Check token limits
      await this.checkTokenLimits(userId, request);

      // Check for prompt injection
      if (this.config.enablePromptInjectionDetection) {
        this.detectPromptInjection(request);
      }

      // Check for PII
      if (this.config.enablePIIDetection) {
        this.detectPII(request);
      }

      // Content filtering
      if (this.config.enableContentFiltering) {
        this.filterContent(request);
      }

      return { valid: true };
    } catch (error) {
      if (error instanceof SecurityError) {
        logger.warn(
          {
            userId,
            error: error.message,
            code: error.code,
            details: error.details,
          },
          'Security validation failed'
        );
        return { valid: false, error };
      }
      throw error;
    }
  }

  /**
   * Check token limits (per request and daily)
   */
  private async checkTokenLimits(userId: string, request: LLMRequest): Promise<void> {
    // Check per-request limit
    const requestTokens = request.maxTokens || 1000;
    if (requestTokens > this.config.maxTokensPerRequest) {
      throw new TokenLimitError(this.config.maxTokensPerRequest, requestTokens);
    }

    // Check daily limit
    const usage = this.getOrCreateUsage(userId);
    const totalTokens = usage.dailyTokens + requestTokens;

    if (totalTokens > this.config.maxTokensPerDay) {
      throw new TokenLimitError(this.config.maxTokensPerDay, totalTokens);
    }
  }

  /**
   * Track token usage for a user
   */
  trackUsage(userId: string, inputTokens: number, outputTokens: number): void {
    const usage = this.getOrCreateUsage(userId);
    usage.dailyTokens += inputTokens + outputTokens;
    usage.requestCount++;

    logger.debug(
      {
        userId,
        inputTokens,
        outputTokens,
        dailyTotal: usage.dailyTokens,
        requestCount: usage.requestCount,
      },
      'Token usage tracked'
    );
  }

  /**
   * Get usage stats for a user
   */
  getUsageStats(userId: string): {
    dailyTokens: number;
    requestCount: number;
    remainingTokens: number;
    resetAt: Date;
  } {
    const usage = this.getOrCreateUsage(userId);
    return {
      dailyTokens: usage.dailyTokens,
      requestCount: usage.requestCount,
      remainingTokens: Math.max(0, this.config.maxTokensPerDay - usage.dailyTokens),
      resetAt: new Date(usage.dailyResetAt),
    };
  }

  /**
   * Detect prompt injection attempts
   */
  private detectPromptInjection(request: LLMRequest): void {
    for (const message of request.messages) {
      for (const pattern of this.injectionPatterns) {
        if (pattern.test(message.content)) {
          throw new PromptInjectionError(pattern.source);
        }
      }
    }
  }

  /**
   * Detect PII in messages
   */
  private detectPII(request: LLMRequest): void {
    for (const message of request.messages) {
      for (const pattern of this.piiPatterns) {
        if (pattern.test(message.content)) {
          logger.warn(
            { userId: 'redacted', pattern: pattern.source },
            'PII detected in sampling request'
          );
          // Note: We log but don't block - adjust based on your security requirements
          // throw new ContentFilterError('PII detected in request');
        }
      }
    }
  }

  /**
   * Content filtering
   */
  private filterContent(request: LLMRequest): void {
    // Basic profanity/harmful content detection
    const harmfulPatterns = [
      /\b(kill|murder|suicide|bomb|weapon)\s+(instructions|guide|how\s+to)/i,
      /\b(hack|crack|steal|pirate)\s+(password|account|credit\s+card)/i,
    ];

    for (const message of request.messages) {
      for (const pattern of harmfulPatterns) {
        if (pattern.test(message.content)) {
          throw new ContentFilterError('Potentially harmful content detected');
        }
      }
    }
  }

  /**
   * Sanitize request for logging (remove sensitive data)
   */
  sanitizeForLogging(request: LLMRequest): LLMRequest {
    return {
      ...request,
      messages: request.messages.map((msg) => ({
        ...msg,
        content: this.redactSensitiveData(msg.content),
      })),
    };
  }

  /**
   * Redact sensitive data from text
   */
  private redactSensitiveData(text: string): string {
    let sanitized = text;

    // Redact potential API keys
    sanitized = sanitized.replace(/\b(sk|pk)_[a-zA-Z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]');

    // Redact potential tokens
    sanitized = sanitized.replace(/\b[a-zA-Z0-9_-]{40,}\b/g, '[REDACTED_TOKEN]');

    // Redact email addresses
    sanitized = sanitized.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[REDACTED_EMAIL]'
    );

    // Redact credit card numbers
    sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_CC]');

    // Redact SSN
    sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');

    return sanitized;
  }

  /**
   * Reset usage for a user (for testing/admin)
   */
  resetUsage(userId: string): void {
    this.usageState.delete(userId);
    logger.info({ userId }, 'Usage reset');
  }

  /**
   * Get or create usage state for a user
   */
  private getOrCreateUsage(userId: string): UsageState {
    let usage = this.usageState.get(userId);

    const now = Date.now();

    if (!usage) {
      usage = {
        dailyTokens: 0,
        dailyResetAt: this.getEndOfDay(now),
        requestCount: 0,
      };
      this.usageState.set(userId, usage);
    } else if (now >= usage.dailyResetAt) {
      // Reset daily counters
      usage.dailyTokens = 0;
      usage.dailyResetAt = this.getEndOfDay(now);
      usage.requestCount = 0;
    }

    return usage;
  }

  /**
   * Get end of day timestamp
   */
  private getEndOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime() + 1;
  }

  /**
   * Update security configuration
   */
  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'Security config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }
}

// Singleton instance
export const samplingSecurity = new SamplingSecurity();
