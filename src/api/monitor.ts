import { Hono } from 'hono';
import type { ApiResponse } from '../core/types.js';
import { connectionPool } from '../core/pool.js';
import { toolRegistry } from '../core/registry.js';
import { serverDatabase } from '../storage/db.js';
import { circuitBreakerRegistry } from '../core/circuitBreaker.js';
import { createChildLogger } from '../observability/logger.js';

const _logger = createChildLogger({ module: 'api-monitor' });

export const monitorApi = new Hono();

// Store request metrics
interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  requestsByEndpoint: Record<string, number>;
  requestsByStatus: Record<number, number>;
  recentRequests: Array<{
    method: string;
    path: string;
    status: number;
    duration: number;
    timestamp: string;
  }>;
}

const metrics: RequestMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  avgResponseTime: 0,
  requestsByEndpoint: {},
  requestsByStatus: {},
  recentRequests: [],
};

// Track a request
export function trackRequest(
  method: string,
  path: string,
  status: number,
  duration: number
) {
  metrics.totalRequests++;

  if (status >= 200 && status < 400) {
    metrics.successfulRequests++;
  } else {
    metrics.failedRequests++;
  }

  // Update average response time
  metrics.avgResponseTime =
    (metrics.avgResponseTime * (metrics.totalRequests - 1) + duration) /
    metrics.totalRequests;

  // Track by endpoint
  metrics.requestsByEndpoint[path] = (metrics.requestsByEndpoint[path] || 0) + 1;

  // Track by status
  metrics.requestsByStatus[status] = (metrics.requestsByStatus[status] || 0) + 1;

  // Add to recent requests (keep last 100)
  metrics.recentRequests.unshift({
    method,
    path,
    status,
    duration,
    timestamp: new Date().toISOString(),
  });

  if (metrics.recentRequests.length > 100) {
    metrics.recentRequests.pop();
  }
}

// Helper to create API response
function apiResponse<T>(data: T, success = true): ApiResponse<T> {
  return {
    success,
    data,
    timestamp: new Date().toISOString(),
  };
}

// GET /monitor/metrics - Get current metrics
monitorApi.get('/metrics', (c) => {
  const servers = serverDatabase.getAllServers();
  const connectionStatuses = servers.map((server) => ({
    id: server.id,
    name: server.name,
    status: connectionPool.getConnectionStatus(server.id),
  }));

  const connectedCount = connectionStatuses.filter(
    (s) => s.status === 'connected'
  ).length;
  const erroredCount = connectionStatuses.filter(
    (s) => s.status === 'error'
  ).length;

  return c.json(
    apiResponse({
      uptime: process.uptime(),
      memory: {
        used: process.memoryUsage().heapUsed / 1024 / 1024, // MB
        total: process.memoryUsage().heapTotal / 1024 / 1024, // MB
        rss: process.memoryUsage().rss / 1024 / 1024, // MB
      },
      requests: {
        total: metrics.totalRequests,
        successful: metrics.successfulRequests,
        failed: metrics.failedRequests,
        successRate:
          metrics.totalRequests > 0
            ? (metrics.successfulRequests / metrics.totalRequests) * 100
            : 0,
        avgResponseTime: Math.round(metrics.avgResponseTime * 100) / 100,
      },
      servers: {
        total: servers.length,
        connected: connectedCount,
        errored: erroredCount,
        // Include server statuses for visibility (no sensitive data)
        list: connectionStatuses.map((s) => ({
          name: s.name,
          status: s.status,
        })),
      },
      tools: {
        registered: toolRegistry.getToolCount(),
      },
    })
  );
});

// GET /monitor/circuit-breakers - Get all circuit breaker states
monitorApi.get('/circuit-breakers', (c) => {
  const states = circuitBreakerRegistry.getAllStates();
  const counts = circuitBreakerRegistry.getStateCounts();

  const breakers: Array<{
    serverId: string;
    state: string;
    failureCount: number;
    successCount: number;
    lastFailureTime: number | null;
    lastStateChange: number;
    requestCount: number;
  }> = [];

  for (const [serverId, state] of states) {
    breakers.push({
      serverId,
      ...state,
    });
  }

  return c.json(
    apiResponse({
      breakers,
      summary: counts,
      total: breakers.length,
    })
  );
});

// GET /monitor/circuit-breakers/:serverId - Get circuit breaker for a specific server
monitorApi.get('/circuit-breakers/:serverId', (c) => {
  const serverId = c.req.param('serverId');
  const state = circuitBreakerRegistry.getState(serverId);

  if (!state) {
    c.status(404);
    return c.json({
      success: false,
      error: `No circuit breaker found for server: ${serverId}`,
      timestamp: new Date().toISOString(),
    });
  }

  return c.json(
    apiResponse({
      serverId,
      ...state,
    })
  );
});

// POST /monitor/circuit-breakers/:serverId/reset - Reset (force close) a circuit breaker
monitorApi.post('/circuit-breakers/:serverId/reset', (c) => {
  const serverId = c.req.param('serverId');
  const success = circuitBreakerRegistry.forceClose(serverId);

  if (!success) {
    c.status(404);
    return c.json({
      success: false,
      error: `No circuit breaker found for server: ${serverId}`,
      timestamp: new Date().toISOString(),
    });
  }

  return c.json(
    apiResponse({
      serverId,
      action: 'reset',
      newState: 'CLOSED',
    })
  );
});

// POST /monitor/circuit-breakers/:serverId/trip - Force open a circuit breaker
monitorApi.post('/circuit-breakers/:serverId/trip', (c) => {
  const serverId = c.req.param('serverId');
  const breaker = circuitBreakerRegistry.getBreaker(serverId);
  breaker.forceOpen();

  return c.json(
    apiResponse({
      serverId,
      action: 'trip',
      newState: 'OPEN',
    })
  );
});

// GET /monitor/requests - Get recent requests
monitorApi.get('/requests', (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);

  return c.json(
    apiResponse({
      requests: metrics.recentRequests.slice(0, limit),
      total: metrics.recentRequests.length,
    })
  );
});

// GET /monitor/stats - Get detailed statistics
monitorApi.get('/stats', (c) => {
  const servers = serverDatabase.getAllServers();

  const serverStats = servers.map((server) => {
    const status = connectionPool.getConnectionStatus(server.id);
    const tools = toolRegistry.findToolsByServer(server.id);

    return {
      id: server.id,
      name: server.name,
      status,
      enabled: server.enabled,
      toolCount: tools.length,
      rateLimit: {
        requestsPerMinute: server.rateLimits.requestsPerMinute,
        requestsPerDay: server.rateLimits.requestsPerDay,
      },
      category: server.metadata.category,
      tags: server.metadata.tags,
    };
  });

  return c.json(
    apiResponse({
      servers: serverStats,
      endpoints: {
        byPath: metrics.requestsByEndpoint,
        byStatus: metrics.requestsByStatus,
      },
      topEndpoints: Object.entries(metrics.requestsByEndpoint)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([path, count]) => ({ path, count })),
    })
  );
});

// GET /monitor/tools - Get tool usage statistics
monitorApi.get('/tools', (c) => {
  const allTools = toolRegistry.getAllTools();

  const toolsByServer: Record<string, number> = {};

  allTools.forEach((tool) => {
    toolsByServer[tool.serverName] = (toolsByServer[tool.serverName] || 0) + 1;
  });

  return c.json(
    apiResponse({
      total: allTools.length,
      byServer: toolsByServer,
      tools: allTools.map((tool) => ({
        name: tool.name,
        server: tool.serverName,
        registeredAt: tool.registeredAt,
      })),
    })
  );
});

// GET /monitor/dashboard - Serve monitoring dashboard
monitorApi.get('/dashboard', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Connect - Monitoring Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 2rem;
      margin-bottom: 1rem;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 20px;
      border: 1px solid #334155;
    }
    .card h2 {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-bottom: 12px;
    }
    .metric {
      font-size: 2rem;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 8px;
    }
    .metric-label {
      font-size: 0.875rem;
      color: #64748b;
    }
    .metric.success { color: #22c55e; }
    .metric.error { color: #ef4444; }
    .metric.warning { color: #f59e0b; }
    .metric.info { color: #3b82f6; }

    .server-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .server-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: #0f172a;
      border-radius: 8px;
      border: 1px solid #334155;
    }
    .server-name {
      font-weight: 600;
      color: #f1f5f9;
    }
    .server-meta {
      font-size: 0.875rem;
      color: #64748b;
    }
    .badge {
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.connected { background: #166534; color: #86efac; }
    .badge.disconnected { background: #7f1d1d; color: #fca5a5; }
    .badge.error { background: #7c2d12; color: #fdba74; }

    .table-container {
      overflow-x: auto;
      background: #1e293b;
      border-radius: 12px;
      border: 1px solid #334155;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      background: #0f172a;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      font-weight: 600;
    }
    td {
      padding: 12px 16px;
      border-top: 1px solid #334155;
      font-size: 0.875rem;
    }
    .status-200 { color: #22c55e; }
    .status-400 { color: #f59e0b; }
    .status-500 { color: #ef4444; }

    .refresh-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .refresh-btn:hover { background: #2563eb; }

    .auto-refresh {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    }
    .auto-refresh label {
      font-size: 0.875rem;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      <span class="status-dot"></span>
      MCP Connect Monitoring
    </h1>

    <div class="auto-refresh">
      <button class="refresh-btn" onclick="loadData()">Refresh Now</button>
      <label>
        <input type="checkbox" id="autoRefresh" checked> Auto-refresh (5s)
      </label>
    </div>

    <div class="grid" id="metrics"></div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>Connected Servers</h2>
      <div class="server-list" id="servers"></div>
    </div>

    <div class="card">
      <h2>Recent Requests</h2>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Path</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody id="requests"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    async function loadData() {
      try {
        const [metricsRes, statsRes, requestsRes] = await Promise.all([
          fetch('/api/monitor/metrics'),
          fetch('/api/monitor/stats'),
          fetch('/api/monitor/requests?limit=20')
        ]);

        const metrics = await metricsRes.json();
        const stats = await statsRes.json();
        const requests = await requestsRes.json();

        // Update metrics
        document.getElementById('metrics').innerHTML = \`
          <div class="card">
            <h2>Uptime</h2>
            <div class="metric info">\${formatUptime(metrics.data.uptime)}</div>
            <div class="metric-label">System running</div>
          </div>

          <div class="card">
            <h2>Total Requests</h2>
            <div class="metric">\${metrics.data.requests.total.toLocaleString()}</div>
            <div class="metric-label">\${metrics.data.requests.successRate.toFixed(1)}% success rate</div>
          </div>

          <div class="card">
            <h2>Avg Response Time</h2>
            <div class="metric warning">\${metrics.data.requests.avgResponseTime}ms</div>
            <div class="metric-label">Average latency</div>
          </div>

          <div class="card">
            <h2>Memory Usage</h2>
            <div class="metric">\${metrics.data.memory.used.toFixed(0)}MB</div>
            <div class="metric-label">of \${metrics.data.memory.total.toFixed(0)}MB heap</div>
          </div>

          <div class="card">
            <h2>Active Servers</h2>
            <div class="metric success">\${metrics.data.servers.connected}</div>
            <div class="metric-label">of \${metrics.data.servers.total} total</div>
          </div>

          <div class="card">
            <h2>Registered Tools</h2>
            <div class="metric info">\${metrics.data.tools.registered}</div>
            <div class="metric-label">Available tools</div>
          </div>
        \`;

        // Update servers
        document.getElementById('servers').innerHTML = stats.data.servers
          .map(server => \`
            <div class="server-item">
              <div>
                <div class="server-name">\${server.name}</div>
                <div class="server-meta">\${server.toolCount} tools • \${server.category}</div>
              </div>
              <span class="badge \${server.status}">\${server.status}</span>
            </div>
          \`)
          .join('');

        // Update requests
        document.getElementById('requests').innerHTML = requests.data.requests
          .map(req => {
            const time = new Date(req.timestamp).toLocaleTimeString();
            const statusClass = \`status-\${Math.floor(req.status / 100) * 100}\`;
            return \`
              <tr>
                <td>\${time}</td>
                <td>\${req.method}</td>
                <td>\${req.path}</td>
                <td class="\${statusClass}">\${req.status}</td>
                <td>\${req.duration}ms</td>
              </tr>
            \`;
          })
          .join('');

      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }

    function formatUptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);

      if (days > 0) return \`\${days}d \${hours}h\`;
      if (hours > 0) return \`\${hours}h \${minutes}m\`;
      return \`\${minutes}m\`;
    }

    // Initial load
    loadData();

    // Auto-refresh
    setInterval(() => {
      if (document.getElementById('autoRefresh').checked) {
        loadData();
      }
    }, 5000);
  </script>
</body>
</html>
  `);
});
