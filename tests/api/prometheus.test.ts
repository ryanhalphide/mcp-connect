import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { prometheusApi } from '../../src/api/prometheus.js';

// Mock metricsCollector
const mockGetMetrics = vi.fn();

vi.mock('../../src/observability/prometheus.js', () => ({
  metricsCollector: {
    getMetrics: () => mockGetMetrics(),
  },
}));

vi.mock('../../src/observability/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Prometheus API', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route('/metrics', prometheusApi);
  });

  describe('GET /metrics', () => {
    it('should return metrics in Prometheus text format', async () => {
      const mockMetrics = `# HELP mcp_http_requests_total Counter metric
# TYPE mcp_http_requests_total counter
mcp_http_requests_total{method="GET",path="/api/health",status="200"} 10
mcp_http_requests_total{method="POST",path="/api/tools",status="200"} 5
# HELP mcp_servers_connected Gauge metric
# TYPE mcp_servers_connected gauge
mcp_servers_connected 4`;

      mockGetMetrics.mockReturnValue(mockMetrics);

      const res = await app.request('/metrics');
      const text = await res.text();

      expect(res.status).toBe(200);
      // Content-Type header may be normalized by test client
      expect(res.headers.get('Content-Type')).toContain('text/plain');
      expect(text).toContain('mcp_http_requests_total');
      expect(text).toContain('mcp_servers_connected');
    });

    it('should return empty metrics when none collected', async () => {
      mockGetMetrics.mockReturnValue('');

      const res = await app.request('/metrics');
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toBe('');
    });

    it('should handle errors gracefully', async () => {
      mockGetMetrics.mockImplementation(() => {
        throw new Error('Metrics collection failed');
      });

      const res = await app.request('/metrics');
      const text = await res.text();

      expect(res.status).toBe(500);
      expect(text).toContain('Error collecting metrics');
    });
  });

  describe('GET /metrics/json', () => {
    it('should return metrics in JSON format', async () => {
      const mockMetrics = `# HELP mcp_http_requests_total Counter metric
# TYPE mcp_http_requests_total counter
mcp_http_requests_total{method="GET",path="/api/health",status="200"} 10
# HELP mcp_servers_connected Gauge metric
# TYPE mcp_servers_connected gauge
mcp_servers_connected 4`;

      mockGetMetrics.mockReturnValue(mockMetrics);

      const res = await app.request('/metrics/json');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.metrics).toBeInstanceOf(Array);
      expect(json.data.raw).toBe(mockMetrics);
    });

    it('should parse metric lines correctly', async () => {
      const mockMetrics = `# HELP test_counter Counter
# TYPE test_counter counter
test_counter{label="value"} 42`;

      mockGetMetrics.mockReturnValue(mockMetrics);

      const res = await app.request('/metrics/json');
      const json = await res.json();

      expect(json.data.metrics).toHaveLength(1);
      expect(json.data.metrics[0]).toEqual({
        name: 'test_counter',
        labels: '{label="value"}',
        value: 42,
      });
    });

    it('should parse metrics without labels', async () => {
      const mockMetrics = `# HELP test_gauge Gauge
# TYPE test_gauge gauge
test_gauge 123.45`;

      mockGetMetrics.mockReturnValue(mockMetrics);

      const res = await app.request('/metrics/json');
      const json = await res.json();

      expect(json.data.metrics).toHaveLength(1);
      expect(json.data.metrics[0]).toEqual({
        name: 'test_gauge',
        labels: '{}',
        value: 123.45,
      });
    });

    it('should handle errors gracefully', async () => {
      mockGetMetrics.mockImplementation(() => {
        throw new Error('Metrics collection failed');
      });

      const res = await app.request('/metrics/json');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error).toBe('Failed to collect metrics');
    });
  });
});

describe('Prometheus Metrics Collector', () => {
  // Test the actual MetricsCollector class
  let metricsCollector: typeof import('../../src/observability/prometheus.js').metricsCollector;

  beforeEach(async () => {
    // Reset modules to get fresh instance
    vi.resetModules();
    vi.doUnmock('../../src/observability/prometheus.js');

    // Mock dependencies that prometheus.ts imports
    vi.doMock('../../src/core/pool.js', () => ({
      connectionPool: {
        getConnectionStatus: vi.fn(() => 'disconnected'),
      },
    }));
    vi.doMock('../../src/core/registry.js', () => ({
      toolRegistry: {
        getToolCount: vi.fn(() => 0),
      },
    }));
    vi.doMock('../../src/storage/db.js', () => ({
      serverDatabase: {
        getAllServers: vi.fn(() => []),
      },
    }));
    vi.doMock('../../src/api/sse.js', () => ({
      getSSEClientCount: vi.fn(() => 0),
    }));
    vi.doMock('../../src/observability/logger.js', () => ({
      createChildLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }));

    const module = await import('../../src/observability/prometheus.js');
    metricsCollector = module.metricsCollector;
    metricsCollector.reset();
  });

  afterEach(() => {
    vi.doMock('../../src/observability/prometheus.js', () => ({
      metricsCollector: {
        getMetrics: () => mockGetMetrics(),
      },
    }));
  });

  it('should increment counters', () => {
    metricsCollector.incCounter('test_counter', { label: 'value' });
    metricsCollector.incCounter('test_counter', { label: 'value' }, 5);

    const metrics = metricsCollector.getMetrics();
    expect(metrics).toContain('test_counter{label="value"} 6');
  });

  it('should set gauges', () => {
    metricsCollector.setGauge('test_gauge', 42, { env: 'test' });

    const metrics = metricsCollector.getMetrics();
    expect(metrics).toContain('test_gauge{env="test"} 42');
  });

  it('should observe histograms', () => {
    metricsCollector.observeHistogram('test_histogram', 0.05, { method: 'GET' });
    metricsCollector.observeHistogram('test_histogram', 0.15, { method: 'GET' });

    const metrics = metricsCollector.getMetrics();
    expect(metrics).toContain('test_histogram_count{method="GET"} 2');
    expect(metrics).toContain('test_histogram_sum{method="GET"}');
    expect(metrics).toContain('test_histogram_bucket');
  });

  it('should reset all metrics', () => {
    metricsCollector.incCounter('counter1');
    metricsCollector.setGauge('gauge1', 10);

    metricsCollector.reset();

    // After reset, getMetrics will still collect system metrics
    // but custom metrics should be gone
    const metrics = metricsCollector.getMetrics();
    expect(metrics).not.toContain('counter1');
    expect(metrics).not.toContain('gauge1');
  });
});
