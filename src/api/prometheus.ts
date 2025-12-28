import { Hono } from 'hono';
import { metricsCollector } from '../observability/prometheus.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'api-prometheus' });

export const prometheusApi = new Hono();

/**
 * GET /metrics - Prometheus metrics endpoint
 * Returns metrics in Prometheus text format
 */
prometheusApi.get('/', (c) => {
  try {
    const metrics = metricsCollector.getMetrics();

    // Set content type for Prometheus
    c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');

    return c.text(metrics);
  } catch (error) {
    logger.error({ error }, 'Failed to collect metrics');
    c.status(500);
    return c.text('# Error collecting metrics');
  }
});

/**
 * GET /metrics/json - Metrics in JSON format (for debugging)
 */
prometheusApi.get('/json', (c) => {
  try {
    const metrics = metricsCollector.getMetrics();

    // Parse metrics into structured JSON
    const lines = metrics.split('\n').filter((l) => l && !l.startsWith('#'));
    const parsed = lines.map((line) => {
      const match = line.match(/^([^{]+)(\{[^}]+\})?\s+(.+)$/);
      if (match) {
        return {
          name: match[1],
          labels: match[2] || '{}',
          value: parseFloat(match[3]),
        };
      }
      return null;
    }).filter(Boolean);

    return c.json({
      success: true,
      data: {
        metrics: parsed,
        raw: metrics,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to collect metrics');
    c.status(500);
    return c.json({
      success: false,
      error: 'Failed to collect metrics',
      timestamp: new Date().toISOString(),
    });
  }
});
