import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'graceful-shutdown' });

interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
  priority: number;
  timeoutMs: number;
}

/**
 * Graceful shutdown manager for production deployments
 * Ensures all resources are cleaned up properly before exit
 */
class GracefulShutdownManager {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private shutdownTimeoutMs: number;
  private forceExitTimeoutMs: number;

  constructor(options?: { shutdownTimeoutMs?: number; forceExitTimeoutMs?: number }) {
    this.shutdownTimeoutMs = options?.shutdownTimeoutMs || 30000;
    this.forceExitTimeoutMs = options?.forceExitTimeoutMs || 45000;
  }

  /**
   * Register a shutdown handler
   * @param name - Name for logging
   * @param handler - Async cleanup function
   * @param priority - Lower numbers run first (default: 100)
   * @param timeoutMs - Timeout for this handler (default: 5000)
   */
  register(name: string, handler: () => Promise<void>, priority = 100, timeoutMs = 5000): void {
    this.handlers.push({ name, handler, priority, timeoutMs });
    this.handlers.sort((a, b) => a.priority - b.priority);
    logger.debug({ name, priority }, 'Registered shutdown handler');
  }

  /**
   * Unregister a shutdown handler by name
   */
  unregister(name: string): boolean {
    const index = this.handlers.findIndex((h) => h.name === name);
    if (index !== -1) {
      this.handlers.splice(index, 1);
      logger.debug({ name }, 'Unregistered shutdown handler');
      return true;
    }
    return false;
  }

  /**
   * Check if shutdown is in progress
   */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Execute a single handler with timeout
   */
  private async executeHandler(handler: ShutdownHandler): Promise<{ name: string; success: boolean; error?: string }> {
    try {
      await Promise.race([
        handler.handler(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${handler.timeoutMs}ms`)), handler.timeoutMs)
        ),
      ]);
      return { name: handler.name, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { name: handler.name, success: false, error: message };
    }
  }

  /**
   * Execute all shutdown handlers in order
   */
  async shutdown(signal?: string): Promise<void> {
    // Prevent multiple simultaneous shutdowns
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    logger.info({ signal, handlerCount: this.handlers.length }, 'Starting graceful shutdown');

    // Set force exit timeout
    const forceExitTimer = setTimeout(() => {
      logger.error('Force exit timeout reached, terminating process');
      process.exit(1);
    }, this.forceExitTimeoutMs);

    this.shutdownPromise = (async () => {
      const startTime = Date.now();
      const results: Array<{ name: string; success: boolean; error?: string; durationMs: number }> = [];

      // Execute handlers sequentially (respecting priority order)
      for (const handler of this.handlers) {
        const handlerStart = Date.now();
        logger.info({ name: handler.name, priority: handler.priority }, 'Executing shutdown handler');

        const result = await this.executeHandler(handler);
        const durationMs = Date.now() - handlerStart;

        results.push({ ...result, durationMs });

        if (result.success) {
          logger.info({ name: handler.name, durationMs }, 'Shutdown handler completed');
        } else {
          logger.error({ name: handler.name, error: result.error, durationMs }, 'Shutdown handler failed');
        }

        // Check total timeout
        if (Date.now() - startTime > this.shutdownTimeoutMs) {
          logger.warn('Total shutdown timeout reached, skipping remaining handlers');
          break;
        }
      }

      // Log summary
      const totalDuration = Date.now() - startTime;
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      logger.info(
        {
          totalDuration,
          succeeded,
          failed,
          handlers: results,
        },
        'Graceful shutdown complete'
      );

      clearTimeout(forceExitTimer);
    })();

    return this.shutdownPromise;
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info({ signal }, 'Received shutdown signal');
        await this.shutdown(signal);
        process.exit(0);
      });
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
      await this.shutdown('uncaughtException');
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      logger.fatal({ reason }, 'Unhandled promise rejection');
      await this.shutdown('unhandledRejection');
      process.exit(1);
    });

    logger.debug({ signals }, 'Signal handlers registered');
  }
}

// Singleton instance
export const shutdownManager = new GracefulShutdownManager();

/**
 * Helper to create a health check that respects shutdown state
 */
export function createShutdownAwareHealthCheck(): () => { healthy: boolean; shuttingDown: boolean } {
  return () => ({
    healthy: !shutdownManager.shuttingDown,
    shuttingDown: shutdownManager.shuttingDown,
  });
}

/**
 * Middleware to reject requests during shutdown
 */
export function shutdownMiddleware() {
  return async (c: { json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    if (shutdownManager.shuttingDown) {
      return c.json(
        {
          success: false,
          error: 'Service is shutting down',
          code: 'SERVICE_UNAVAILABLE',
          timestamp: new Date().toISOString(),
        },
        503
      );
    }
    await next();
  };
}
