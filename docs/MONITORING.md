# MCP Connect Monitoring Guide

Complete guide to monitoring, observability, and alerting for MCP Connect deployments.

---

## Table of Contents

1. [Monitoring Overview](#monitoring-overview)
2. [Built-in Dashboard](#built-in-dashboard)
3. [Prometheus Metrics](#prometheus-metrics)
4. [Grafana Dashboards](#grafana-dashboards)
5. [Alerting](#alerting)
6. [Health Checks](#health-checks)
7. [Logging](#logging)
8. [Distributed Tracing](#distributed-tracing)
9. [Performance Optimization](#performance-optimization)
10. [Runbooks](#runbooks)

---

## Monitoring Overview

MCP Connect provides comprehensive observability through multiple channels:

| Channel | Use Case | Format |
|---------|----------|--------|
| Built-in Dashboard | Real-time visualization | Web UI |
| Prometheus Metrics | Time-series monitoring | OpenMetrics |
| SSE Events | Real-time streaming | Server-Sent Events |
| Audit Logs | Security & compliance | Structured JSON |
| Health Endpoints | Container orchestration | JSON |

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| Connected Servers | Number of active connections | < expected count |
| Tool Invocation Rate | Requests per minute | Unusual patterns |
| Error Rate | Failed invocations % | > 5% |
| Latency P99 | 99th percentile response time | > 1000ms |
| Circuit Breaker State | Open breakers | Any open |
| Cache Hit Rate | Percentage of cached responses | < 50% |

---

## Built-in Dashboard

### Accessing the Dashboard

```
https://your-deployment.railway.app/
```

The dashboard provides real-time visibility into:

- **Server Status** - Connected/disconnected state for all MCP servers
- **Tool Inventory** - All available tools across servers
- **Activity Feed** - Live stream of events
- **Performance Metrics** - Request rates and latencies
- **Circuit Breakers** - Health of each server connection

### Dashboard Features

**1. Server Overview**
- Connection status indicators (green/red)
- Tool count per server
- Last activity timestamp
- Quick connect/disconnect actions

**2. Request Activity Chart**
- Time-series visualization of requests
- Filterable by time range (1H, 24H, 7D)
- Success/failure breakdown

**3. Live Activity Feed**
- Real-time event stream via SSE
- Color-coded by event type
- Filterable by server or event type

**4. Circuit Breaker Panel**
- Visual state indicators
- Failure counts
- Auto-recovery countdown

### Customizing the Dashboard

The dashboard supports URL parameters:

```
/?refresh=30000        # Custom refresh interval (ms)
/?servers=id1,id2      # Filter to specific servers
/?theme=dark           # Force dark theme
```

---

## Prometheus Metrics

### Enabling Prometheus

```bash
# Environment variable
ENABLE_PROMETHEUS=true

# Or via configuration
{
  "monitoring": {
    "prometheus": {
      "enabled": true,
      "path": "/metrics"
    }
  }
}
```

### Metrics Endpoint

```bash
curl https://your-deployment/metrics
```

### Available Metrics

#### Request Metrics

```prometheus
# Total requests by method, path, and status
mcp_connect_requests_total{method="GET",path="/api/tools",status="200"} 15000
mcp_connect_requests_total{method="POST",path="/api/tools/*/invoke",status="200"} 8500
mcp_connect_requests_total{method="POST",path="/api/tools/*/invoke",status="500"} 150

# Request duration histogram
mcp_connect_request_duration_seconds_bucket{le="0.01"} 5000
mcp_connect_request_duration_seconds_bucket{le="0.05"} 12000
mcp_connect_request_duration_seconds_bucket{le="0.1"} 14000
mcp_connect_request_duration_seconds_bucket{le="0.5"} 14900
mcp_connect_request_duration_seconds_bucket{le="1"} 14980
mcp_connect_request_duration_seconds_bucket{le="+Inf"} 15000
mcp_connect_request_duration_seconds_sum 450.5
mcp_connect_request_duration_seconds_count 15000
```

#### Tool Metrics

```prometheus
# Tool invocations by tool, server, and status
mcp_connect_tool_invocations_total{tool="read_file",server="filesystem",status="success"} 5000
mcp_connect_tool_invocations_total{tool="read_file",server="filesystem",status="error"} 50

# Tool invocation duration
mcp_connect_tool_duration_seconds_bucket{tool="read_file",le="0.1"} 4500
mcp_connect_tool_duration_seconds_bucket{tool="read_file",le="0.5"} 4900
mcp_connect_tool_duration_seconds_bucket{tool="read_file",le="1"} 4980
mcp_connect_tool_duration_seconds_bucket{tool="read_file",le="+Inf"} 5000
```

#### Connection Metrics

```prometheus
# Active server connections
mcp_connect_active_connections 4

# Connection state by server
mcp_connect_server_state{server="filesystem",state="connected"} 1
mcp_connect_server_state{server="github",state="connected"} 1
mcp_connect_server_state{server="slack",state="disconnected"} 1

# Connection attempts
mcp_connect_connection_attempts_total{server="filesystem",result="success"} 15
mcp_connect_connection_attempts_total{server="filesystem",result="failure"} 2

# Time since last successful connection
mcp_connect_last_connection_timestamp{server="filesystem"} 1705315860
```

#### Circuit Breaker Metrics

```prometheus
# Circuit breaker state (0=closed, 1=half-open, 2=open)
mcp_connect_circuit_breaker_state{server="external-api"} 0
mcp_connect_circuit_breaker_state{server="slow-service"} 2

# Circuit breaker transitions
mcp_connect_circuit_breaker_transitions_total{server="external-api",from="closed",to="open"} 3
mcp_connect_circuit_breaker_transitions_total{server="external-api",from="open",to="half-open"} 3
mcp_connect_circuit_breaker_transitions_total{server="external-api",from="half-open",to="closed"} 2
```

#### Cache Metrics

```prometheus
# Cache operations
mcp_connect_cache_hits_total 4500
mcp_connect_cache_misses_total 1200
mcp_connect_cache_size 156

# Cache hit ratio (computed)
# mcp_connect_cache_hits_total / (mcp_connect_cache_hits_total + mcp_connect_cache_misses_total)
```

#### Rate Limit Metrics

```prometheus
# Rate limit hits
mcp_connect_rate_limit_hits_total{key="prod-api-key",limit_type="minute"} 25
mcp_connect_rate_limit_hits_total{key="prod-api-key",limit_type="day"} 5
```

---

## Grafana Dashboards

### Importing the Dashboard

```bash
# Download the dashboard JSON
curl -o mcp-connect-dashboard.json \
  https://github.com/your-org/mcp-connect/blob/main/dashboards/grafana.json

# Import via Grafana API
curl -X POST \
  -H "Content-Type: application/json" \
  -d @mcp-connect-dashboard.json \
  http://grafana:3000/api/dashboards/db
```

### Dashboard Panels

#### 1. Overview Panel

```json
{
  "title": "MCP Connect Overview",
  "panels": [
    {
      "title": "Connected Servers",
      "type": "stat",
      "targets": [
        { "expr": "mcp_connect_active_connections" }
      ]
    },
    {
      "title": "Request Rate",
      "type": "graph",
      "targets": [
        { "expr": "rate(mcp_connect_requests_total[5m])" }
      ]
    },
    {
      "title": "Error Rate",
      "type": "graph",
      "targets": [
        {
          "expr": "rate(mcp_connect_requests_total{status=~\"5..\"}[5m]) / rate(mcp_connect_requests_total[5m]) * 100"
        }
      ]
    }
  ]
}
```

#### 2. Latency Panel

```json
{
  "title": "Request Latency",
  "panels": [
    {
      "title": "P50 Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.50, rate(mcp_connect_request_duration_seconds_bucket[5m]))"
        }
      ]
    },
    {
      "title": "P99 Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.99, rate(mcp_connect_request_duration_seconds_bucket[5m]))"
        }
      ]
    }
  ]
}
```

#### 3. Circuit Breaker Panel

```json
{
  "title": "Circuit Breakers",
  "panels": [
    {
      "title": "Circuit Breaker States",
      "type": "table",
      "targets": [
        { "expr": "mcp_connect_circuit_breaker_state" }
      ],
      "transformations": [
        {
          "id": "labelsToFields"
        }
      ]
    }
  ]
}
```

### PromQL Examples

**Request Rate by Endpoint:**
```promql
sum(rate(mcp_connect_requests_total[5m])) by (path)
```

**Tool Invocation Success Rate:**
```promql
sum(rate(mcp_connect_tool_invocations_total{status="success"}[5m])) /
sum(rate(mcp_connect_tool_invocations_total[5m])) * 100
```

**Average Latency by Tool:**
```promql
sum(rate(mcp_connect_tool_duration_seconds_sum[5m])) by (tool) /
sum(rate(mcp_connect_tool_duration_seconds_count[5m])) by (tool)
```

**Servers with Open Circuit Breakers:**
```promql
mcp_connect_circuit_breaker_state == 2
```

---

## Alerting

### Prometheus Alerting Rules

```yaml
groups:
  - name: mcp-connect
    rules:
      # High error rate
      - alert: MCPConnectHighErrorRate
        expr: |
          sum(rate(mcp_connect_requests_total{status=~"5.."}[5m])) /
          sum(rate(mcp_connect_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "MCP Connect error rate > 5%"
          description: "Error rate is {{ $value | humanizePercentage }}"

      # Server disconnected
      - alert: MCPServerDisconnected
        expr: mcp_connect_server_state{state="connected"} == 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "MCP Server {{ $labels.server }} disconnected"

      # Circuit breaker open
      - alert: MCPCircuitBreakerOpen
        expr: mcp_connect_circuit_breaker_state == 2
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Circuit breaker open for {{ $labels.server }}"

      # High latency
      - alert: MCPConnectHighLatency
        expr: |
          histogram_quantile(0.99, rate(mcp_connect_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P99 latency > 1s"
          description: "P99 latency is {{ $value | humanizeDuration }}"

      # No active connections
      - alert: MCPConnectNoConnections
        expr: mcp_connect_active_connections == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "No MCP servers connected"

      # Low cache hit rate
      - alert: MCPConnectLowCacheHitRate
        expr: |
          mcp_connect_cache_hits_total /
          (mcp_connect_cache_hits_total + mcp_connect_cache_misses_total) < 0.5
        for: 15m
        labels:
          severity: info
        annotations:
          summary: "Cache hit rate below 50%"

      # Rate limiting triggered
      - alert: MCPConnectRateLimiting
        expr: increase(mcp_connect_rate_limit_hits_total[5m]) > 10
        labels:
          severity: warning
        annotations:
          summary: "Rate limiting triggered for {{ $labels.key }}"
```

### PagerDuty Integration

```yaml
alertmanager:
  config:
    receivers:
      - name: pagerduty
        pagerduty_configs:
          - service_key: your-pagerduty-key
            severity: '{{ .Labels.severity }}'

    route:
      receiver: pagerduty
      group_by: ['alertname', 'server']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 4h
```

### Slack Integration

```yaml
alertmanager:
  config:
    receivers:
      - name: slack
        slack_configs:
          - api_url: https://hooks.slack.com/services/xxx
            channel: '#mcp-alerts'
            title: 'MCP Connect Alert'
            text: '{{ .Annotations.summary }}'
```

---

## Health Checks

### Endpoints

**Liveness Probe:**
```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Readiness Probe:**
```bash
GET /health
```

With detailed information when servers are connected:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 86400,
  "connections": {
    "active": 4,
    "total": 5
  }
}
```

### Kubernetes Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-connect
spec:
  template:
    spec:
      containers:
        - name: mcp-connect
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3

          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### Docker Compose Health Check

```yaml
services:
  mcp-connect:
    image: your-org/mcp-connect
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

---

## Logging

### Log Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `error` | Errors requiring attention | Production |
| `warn` | Warning conditions | Production |
| `info` | Normal operations | Production |
| `debug` | Detailed debugging | Development |
| `trace` | Very detailed tracing | Troubleshooting |

### Log Format

```json
{
  "level": "info",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "module": "mcp-client",
  "requestId": "req-abc123",
  "message": "Tool invoked successfully",
  "data": {
    "tool": "read_file",
    "server": "filesystem",
    "duration": 45
  }
}
```

### Structured Logging

```javascript
logger.info({
  requestId: req.id,
  tool: toolName,
  server: serverId,
  duration: Date.now() - startTime
}, 'Tool invocation completed');
```

### Log Aggregation

**Elasticsearch/Kibana:**
```yaml
# Filebeat configuration
filebeat.inputs:
  - type: container
    paths:
      - '/var/lib/docker/containers/*/*.log'
    json.keys_under_root: true
    json.add_error_key: true

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "mcp-connect-%{+yyyy.MM.dd}"
```

**Loki/Grafana:**
```yaml
# Promtail configuration
scrape_configs:
  - job_name: mcp-connect
    static_configs:
      - targets:
          - localhost
        labels:
          job: mcp-connect
          __path__: /var/log/mcp-connect/*.log
```

### Log Queries

**Find errors for specific server:**
```
level:error AND server:filesystem
```

**Tool invocations over 1 second:**
```
message:"Tool invocation" AND duration:>1000
```

**Failed authentication attempts:**
```
message:"Authentication failed"
```

---

## Distributed Tracing

### OpenTelemetry Integration

```javascript
const { NodeTracerProvider } = require('@opentelemetry/node');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');

const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new SimpleSpanProcessor(
    new JaegerExporter({
      endpoint: 'http://jaeger:14268/api/traces'
    })
  )
);

provider.register();
```

### Trace Context Propagation

```javascript
// Incoming request
const traceContext = extractTraceContext(req.headers);

// Outgoing MCP call
const span = tracer.startSpan('mcp.invoke', {
  parent: traceContext,
  attributes: {
    'mcp.tool': toolName,
    'mcp.server': serverId
  }
});

try {
  const result = await invokeTool(toolName, args);
  span.setStatus({ code: SpanStatusCode.OK });
  return result;
} catch (error) {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message
  });
  throw error;
} finally {
  span.end();
}
```

---

## Performance Optimization

### Identifying Bottlenecks

**Slow Tools Query:**
```promql
topk(10,
  sum(rate(mcp_connect_tool_duration_seconds_sum[1h])) by (tool) /
  sum(rate(mcp_connect_tool_duration_seconds_count[1h])) by (tool)
)
```

**High-Volume Tools:**
```promql
topk(10, sum(rate(mcp_connect_tool_invocations_total[1h])) by (tool))
```

### Optimization Strategies

**1. Enable Response Caching**
```javascript
// Configure cache TTL per tool
const cacheConfig = {
  'read_file': 300,      // 5 minutes
  'list_directory': 60,  // 1 minute
  'search_issues': 600   // 10 minutes
};
```

**2. Connection Pooling**
```javascript
// Pre-warm connections at startup
await bulkConnect(enabledServerIds);
```

**3. Circuit Breaker Tuning**
```javascript
const circuitBreaker = {
  failureThreshold: 5,    // Lower = faster protection
  successThreshold: 2,    // Lower = faster recovery
  timeout: 30000          // Shorter = more aggressive
};
```

### Performance Benchmarks

| Operation | Target | Maximum |
|-----------|--------|---------|
| Health check | < 10ms | 50ms |
| Tool list | < 50ms | 200ms |
| Tool invoke (cached) | < 20ms | 100ms |
| Tool invoke (uncached) | < 500ms | 2000ms |
| Server connect | < 2s | 10s |

---

## Runbooks

### Runbook: Server Disconnected

**Symptoms:**
- Alert: `MCPServerDisconnected`
- Dashboard shows red status
- Tool invocations failing

**Investigation:**
```bash
# Check server status
curl -H "Authorization: Bearer $API_KEY" \
  https://deployment/api/servers/$SERVER_ID

# Check recent errors
curl -H "Authorization: Bearer $API_KEY" \
  "https://deployment/api/audit?resource=$SERVER_ID&action=server.error&limit=10"
```

**Resolution:**
1. Check if the MCP server process is running
2. Verify network connectivity
3. Check for credential expiration
4. Attempt reconnection:
   ```bash
   curl -X POST -H "Authorization: Bearer $API_KEY" \
     https://deployment/api/servers/$SERVER_ID/connect
   ```

---

### Runbook: High Error Rate

**Symptoms:**
- Alert: `MCPConnectHighErrorRate`
- Error rate > 5%

**Investigation:**
```bash
# Get error breakdown
curl -H "Authorization: Bearer $API_KEY" \
  "https://deployment/api/audit?action=tool.error&limit=50"

# Check Prometheus
# rate(mcp_connect_requests_total{status=~"5.."}[5m]) by (path)
```

**Resolution:**
1. Identify failing endpoint/tool
2. Check circuit breaker status
3. Review recent changes
4. Scale resources if needed

---

### Runbook: Circuit Breaker Open

**Symptoms:**
- Alert: `MCPCircuitBreakerOpen`
- Tool invocations returning 503

**Investigation:**
```bash
# Check circuit breaker state
curl -H "Authorization: Bearer $API_KEY" \
  https://deployment/api/monitor/circuit-breakers

# View failure history
# mcp_connect_circuit_breaker_transitions_total{server="$SERVER"}
```

**Resolution:**
1. Wait for automatic recovery (circuit breaker timeout)
2. Fix underlying issue with MCP server
3. Force reconnect if needed:
   ```bash
   curl -X POST -H "Authorization: Bearer $API_KEY" \
     https://deployment/api/servers/$SERVER_ID/disconnect
   curl -X POST -H "Authorization: Bearer $API_KEY" \
     https://deployment/api/servers/$SERVER_ID/connect
   ```

---

### Runbook: High Latency

**Symptoms:**
- Alert: `MCPConnectHighLatency`
- P99 > 1 second

**Investigation:**
```bash
# Find slow tools
# topk(5, histogram_quantile(0.99, rate(mcp_connect_tool_duration_seconds_bucket[5m])) by (tool))

# Check cache hit rate
curl -H "Authorization: Bearer $API_KEY" \
  https://deployment/api/cache/stats
```

**Resolution:**
1. Increase cache TTL for slow tools
2. Scale MCP Connect horizontally
3. Optimize slow MCP server operations
4. Enable response streaming if available

---

## Quick Reference

### Useful Prometheus Queries

```promql
# Overall request rate
sum(rate(mcp_connect_requests_total[5m]))

# Error rate percentage
sum(rate(mcp_connect_requests_total{status=~"5.."}[5m])) /
sum(rate(mcp_connect_requests_total[5m])) * 100

# P99 latency
histogram_quantile(0.99, rate(mcp_connect_request_duration_seconds_bucket[5m]))

# Active connections
mcp_connect_active_connections

# Cache hit ratio
mcp_connect_cache_hits_total / (mcp_connect_cache_hits_total + mcp_connect_cache_misses_total)

# Top 5 tools by invocation count
topk(5, sum(rate(mcp_connect_tool_invocations_total[1h])) by (tool))
```

### Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Liveness/readiness |
| `/metrics` | Prometheus metrics |
| `/api/monitor` | Dashboard data |
| `/api/monitor/circuit-breakers` | Circuit breaker states |
| `/api/cache/stats` | Cache statistics |
| `/api/audit` | Audit logs |
| `/api/sse/events` | Real-time events |
