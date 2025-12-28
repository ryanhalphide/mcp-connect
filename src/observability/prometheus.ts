import { createChildLogger } from './logger.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { serverDatabase } from '../storage/db.js';
import { getSSEClientCount } from '../api/sse.js';

const logger = createChildLogger({ module: 'prometheus' });

// Metrics storage interfaces kept for potential future use
// interface MetricValue {
//   labels: Record<string, string>;
//   value: number;
// }
//
// interface Metric {
//   name: string;
//   help: string;
//   type: 'counter' | 'gauge' | 'histogram';
//   values: MetricValue[];
// }

// Histogram bucket configuration
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// In-memory metrics storage
class MetricsCollector {
  private counters: Map<string, Map<string, number>> = new Map();
  private gauges: Map<string, Map<string, number>> = new Map();
  private histograms: Map<string, Map<string, { count: number; sum: number; buckets: Map<number, number> }>> = new Map();

  // Counter operations
  incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    const counter = this.counters.get(name)!;
    counter.set(key, (counter.get(key) || 0) + value);
  }

  // Gauge operations
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.labelsToKey(labels);
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    this.gauges.get(name)!.set(key, value);
  }

  incGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    const gauge = this.gauges.get(name)!;
    gauge.set(key, (gauge.get(key) || 0) + value);
  }

  decGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    this.incGauge(name, labels, -value);
  }

  // Histogram operations
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.labelsToKey(labels);
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Map());
    }

    const histogram = this.histograms.get(name)!;
    if (!histogram.has(key)) {
      histogram.set(key, {
        count: 0,
        sum: 0,
        buckets: new Map(DURATION_BUCKETS.map((b) => [b, 0])),
      });
    }

    const data = histogram.get(key)!;
    data.count++;
    data.sum += value;

    // Increment buckets where value <= bucket
    for (const bucket of DURATION_BUCKETS) {
      if (value <= bucket) {
        data.buckets.set(bucket, (data.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  // Get all metrics in Prometheus format
  getMetrics(): string {
    const lines: string[] = [];

    // Add system metrics
    this.collectSystemMetrics();

    // Format counters
    for (const [name, values] of this.counters) {
      lines.push(`# HELP ${name} Counter metric`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, value] of values) {
        lines.push(`${name}${labels} ${value}`);
      }
    }

    // Format gauges
    for (const [name, values] of this.gauges) {
      lines.push(`# HELP ${name} Gauge metric`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [labels, value] of values) {
        lines.push(`${name}${labels} ${value}`);
      }
    }

    // Format histograms
    for (const [name, values] of this.histograms) {
      lines.push(`# HELP ${name} Histogram metric`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labels, data] of values) {
        // Bucket values (cumulative)
        let cumulative = 0;
        for (const [le, count] of Array.from(data.buckets.entries()).sort((a, b) => a[0] - b[0])) {
          cumulative += count;
          const bucketLabels = this.addLabel(labels, 'le', le.toString());
          lines.push(`${name}_bucket${bucketLabels} ${cumulative}`);
        }
        // Add +Inf bucket
        const infLabels = this.addLabel(labels, 'le', '+Inf');
        lines.push(`${name}_bucket${infLabels} ${data.count}`);
        // Sum and count
        lines.push(`${name}_sum${labels} ${data.sum}`);
        lines.push(`${name}_count${labels} ${data.count}`);
      }
    }

    return lines.join('\n');
  }

  // Collect current system state as metrics
  private collectSystemMetrics(): void {
    // Active server connections
    const servers = serverDatabase.getAllServers();
    const connectedCount = servers.filter(
      (s) => connectionPool.getConnectionStatus(s.id) === 'connected'
    ).length;

    this.setGauge('mcp_servers_total', servers.length);
    this.setGauge('mcp_servers_connected', connectedCount);
    this.setGauge('mcp_servers_enabled', servers.filter((s) => s.enabled).length);

    // Tool metrics
    this.setGauge('mcp_tools_registered', toolRegistry.getToolCount());

    // SSE clients
    this.setGauge('mcp_sse_clients_connected', getSSEClientCount());

    // Process metrics
    const memUsage = process.memoryUsage();
    this.setGauge('nodejs_memory_heap_used_bytes', memUsage.heapUsed);
    this.setGauge('nodejs_memory_heap_total_bytes', memUsage.heapTotal);
    this.setGauge('nodejs_memory_rss_bytes', memUsage.rss);
    this.setGauge('nodejs_memory_external_bytes', memUsage.external);

    // Process uptime
    this.setGauge('nodejs_process_uptime_seconds', process.uptime());
  }

  private labelsToKey(labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) return '';
    const pairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`);
    return `{${pairs.join(',')}}`;
  }

  private addLabel(existingLabels: string, key: string, value: string): string {
    if (existingLabels === '') {
      return `{${key}="${value}"}`;
    }
    // Insert new label before closing brace
    return existingLabels.slice(0, -1) + `,${key}="${value}"}`;
  }

  // Reset all metrics (useful for testing)
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();

// Convenience functions for common metrics
export function recordHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationSeconds: number
): void {
  metricsCollector.incCounter('mcp_http_requests_total', {
    method,
    path,
    status: statusCode.toString(),
  });

  metricsCollector.observeHistogram('mcp_http_request_duration_seconds', durationSeconds, {
    method,
    path,
  });
}

export function recordToolInvocation(
  toolName: string,
  serverId: string,
  success: boolean,
  durationSeconds: number
): void {
  metricsCollector.incCounter('mcp_tool_invocations_total', {
    tool: toolName,
    server_id: serverId,
    success: success.toString(),
  });

  metricsCollector.observeHistogram('mcp_tool_invocation_duration_seconds', durationSeconds, {
    tool: toolName,
    server_id: serverId,
  });
}

export function recordCircuitBreakerState(
  serverId: string,
  state: 'closed' | 'open' | 'half_open'
): void {
  // Set all states to 0, then set current state to 1
  metricsCollector.setGauge('mcp_circuit_breaker_state', 0, {
    server_id: serverId,
    state: 'closed',
  });
  metricsCollector.setGauge('mcp_circuit_breaker_state', 0, {
    server_id: serverId,
    state: 'open',
  });
  metricsCollector.setGauge('mcp_circuit_breaker_state', 0, {
    server_id: serverId,
    state: 'half_open',
  });
  metricsCollector.setGauge('mcp_circuit_breaker_state', 1, {
    server_id: serverId,
    state,
  });
}

export function recordCacheHit(cacheType: string, hit: boolean): void {
  metricsCollector.incCounter('mcp_cache_operations_total', {
    type: cacheType,
    result: hit ? 'hit' : 'miss',
  });
}

export function recordWebhookDelivery(
  subscriptionId: string,
  event: string,
  success: boolean
): void {
  metricsCollector.incCounter('mcp_webhook_deliveries_total', {
    subscription_id: subscriptionId,
    event,
    success: success.toString(),
  });
}

logger.info('Prometheus metrics collector initialized');
