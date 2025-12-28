# MCP Connect API Reference

Complete API documentation for MCP Connect - the unified gateway for Model Context Protocol servers.

**Base URL:** `https://your-deployment.railway.app` or `http://localhost:3000`

**Authentication:** All API endpoints require an API key passed via the `Authorization` header:
```
Authorization: Bearer your-api-key
```

---

## Table of Contents

1. [Health & Status](#health--status)
2. [Server Management](#server-management)
3. [Tool Operations](#tool-operations)
4. [Server Groups](#server-groups)
5. [Templates](#templates)
6. [Favorites](#favorites)
7. [Webhooks](#webhooks)
8. [Cache Management](#cache-management)
9. [Audit Logs](#audit-logs)
10. [Real-Time Events (SSE)](#real-time-events-sse)
11. [Monitoring & Metrics](#monitoring--metrics)
12. [Error Handling](#error-handling)

---

## Health & Status

### GET /health

Health check endpoint for load balancers and monitoring systems.

**Authentication:** None required

**Response:**
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

**Status Codes:**
- `200` - Service is healthy
- `503` - Service is unhealthy

---

## Server Management

### GET /api/servers

List all configured MCP servers.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | Filter by status: `connected`, `disconnected`, `error` |
| `groupId` | uuid | - | Filter by server group |
| `tags` | string | - | Comma-separated tags to filter by |
| `enabled` | boolean | - | Filter by enabled status |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "filesystem-server",
      "description": "Local filesystem access",
      "status": "connected",
      "toolCount": 12,
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-filesystem"]
      },
      "metadata": {
        "category": "storage",
        "tags": ["files", "local"],
        "version": "1.0.0"
      },
      "groupId": "group-uuid",
      "enabled": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### POST /api/servers

Create a new MCP server configuration.

**Request Body:**
```json
{
  "name": "github-server",
  "description": "GitHub repository access",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-server-github"],
    "env": {
      "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"
    }
  },
  "auth": {
    "type": "none"
  },
  "healthCheck": {
    "enabled": true,
    "intervalMs": 30000,
    "timeoutMs": 5000
  },
  "rateLimits": {
    "requestsPerMinute": 60,
    "requestsPerDay": 10000
  },
  "metadata": {
    "category": "development",
    "tags": ["git", "github", "vcs"],
    "version": "1.0.0"
  },
  "groupId": null,
  "enabled": true
}
```

**Transport Types:**

**stdio:**
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@anthropic/mcp-server-name"],
  "env": { "KEY": "value" }
}
```

**SSE (Server-Sent Events):**
```json
{
  "type": "sse",
  "url": "https://mcp-server.example.com/sse",
  "headers": { "Authorization": "Bearer token" }
}
```

**HTTP:**
```json
{
  "type": "http",
  "url": "https://mcp-server.example.com/api",
  "headers": { "Authorization": "Bearer token" }
}
```

**WebSocket:**
```json
{
  "type": "websocket",
  "url": "wss://mcp-server.example.com/ws",
  "headers": { "Authorization": "Bearer token" },
  "reconnect": {
    "enabled": true,
    "maxAttempts": 10,
    "initialDelayMs": 1000,
    "maxDelayMs": 30000,
    "backoffMultiplier": 2
  },
  "heartbeat": {
    "enabled": true,
    "intervalMs": 30000,
    "timeoutMs": 10000
  }
}
```

**Auth Types:**

**None:**
```json
{ "type": "none" }
```

**API Key:**
```json
{
  "type": "api_key",
  "key": "your-api-key",
  "header": "Authorization",
  "prefix": "Bearer"
}
```

**OAuth2:**
```json
{
  "type": "oauth2",
  "clientId": "client-id",
  "clientSecret": "client-secret",
  "tokenUrl": "https://auth.example.com/token",
  "scopes": ["read", "write"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "github-server",
    "status": "disconnected",
    ...
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### GET /api/servers/:id

Get a specific server by ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "filesystem-server",
    "status": "connected",
    "tools": [
      {
        "name": "read_file",
        "description": "Read contents of a file",
        "inputSchema": { ... }
      }
    ],
    ...
  }
}
```

---

### PUT /api/servers/:id

Update a server configuration.

**Request Body:** Same as POST, all fields optional.

---

### DELETE /api/servers/:id

Delete a server configuration.

**Response:**
```json
{
  "success": true,
  "message": "Server deleted successfully"
}
```

---

### POST /api/servers/:id/connect

Connect to a specific MCP server.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "connected",
    "toolCount": 12,
    "connectTime": 245
  }
}
```

---

### POST /api/servers/:id/disconnect

Disconnect from a specific MCP server.

---

### POST /api/servers/bulk/connect

Connect to multiple servers simultaneously.

**Request Body:**
```json
{
  "serverIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440001"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      { "serverId": "...", "status": "connected", "toolCount": 12 },
      { "serverId": "...", "status": "error", "error": "Connection refused" }
    ],
    "summary": {
      "total": 2,
      "connected": 1,
      "failed": 1
    }
  }
}
```

---

### POST /api/servers/bulk/disconnect

Disconnect from multiple servers simultaneously.

---

## Tool Operations

### GET /api/tools

List all available tools across connected servers.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | - | Search tools by name or description |
| `category` | string | - | Filter by category |
| `tags` | string | - | Comma-separated tags |
| `server` | string | - | Filter by server ID or name |
| `sortBy` | string | `name` | Sort by: `name`, `usage`, `recent` |
| `limit` | number | 50 | Max results (1-100) |
| `offset` | number | 0 | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "read_file",
        "serverId": "550e8400-e29b-41d4-a716-446655440000",
        "serverName": "filesystem-server",
        "description": "Read the contents of a file",
        "inputSchema": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "Path to the file"
            }
          },
          "required": ["path"]
        },
        "category": "storage",
        "tags": ["files", "read"],
        "usageCount": 150,
        "lastUsedAt": "2024-01-15T10:00:00.000Z"
      }
    ],
    "total": 60,
    "limit": 50,
    "offset": 0
  }
}
```

---

### GET /api/tools/categories

Get all tool categories with counts.

**Response:**
```json
{
  "success": true,
  "data": [
    { "name": "storage", "count": 15 },
    { "name": "development", "count": 25 },
    { "name": "communication", "count": 10 }
  ]
}
```

---

### GET /api/tools/stats

Get tool usage statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalTools": 60,
    "totalInvocations": 15000,
    "topTools": [
      { "name": "read_file", "invocations": 5000 },
      { "name": "write_file", "invocations": 3500 }
    ],
    "invocationsByDay": [
      { "date": "2024-01-15", "count": 450 },
      { "date": "2024-01-14", "count": 520 }
    ]
  }
}
```

---

### POST /api/tools/:name/invoke

Invoke a specific tool.

**Request Body:**
```json
{
  "arguments": {
    "path": "/home/user/document.txt"
  },
  "serverId": "optional-server-id-if-tool-name-is-ambiguous"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "content": [
      {
        "type": "text",
        "text": "File contents here..."
      }
    ],
    "isError": false
  },
  "metadata": {
    "serverId": "550e8400-e29b-41d4-a716-446655440000",
    "serverName": "filesystem-server",
    "durationMs": 45,
    "cached": false
  }
}
```

---

### GET /api/tools/recent

Get recently used tools for the authenticated API key.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 10 | Max results (1-50) |

---

### GET /api/tools/:name/history

Get invocation history for a specific tool.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Max results |
| `from` | ISO date | - | Start date |
| `to` | ISO date | - | End date |

---

## Server Groups

### GET /api/groups

List all server groups.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "group-uuid",
      "name": "Production Servers",
      "description": "Production MCP servers",
      "color": "#22c55e",
      "icon": "server",
      "sortOrder": 0,
      "serverCount": 5
    }
  ]
}
```

---

### POST /api/groups

Create a new server group.

**Request Body:**
```json
{
  "name": "Development",
  "description": "Development and testing servers",
  "color": "#6366f1",
  "icon": "code"
}
```

---

### PUT /api/groups/:id

Update a server group.

---

### DELETE /api/groups/:id

Delete a server group. Servers in the group are moved to ungrouped.

---

### POST /api/groups/:id/servers

Add servers to a group.

**Request Body:**
```json
{
  "serverIds": ["server-uuid-1", "server-uuid-2"]
}
```

---

## Templates

### GET /api/templates

List all available server templates.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category |
| `search` | string | Search by name or description |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "builtin-github",
      "name": "GitHub",
      "description": "GitHub repository access and management",
      "icon": "github",
      "category": "development",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-github"],
      "envPlaceholders": [
        {
          "key": "GITHUB_TOKEN",
          "description": "GitHub Personal Access Token",
          "required": true
        }
      ],
      "documentation": "https://github.com/anthropics/mcp-servers",
      "npmPackage": "@anthropic/mcp-server-github"
    }
  ]
}
```

---

### POST /api/templates/:id/instantiate

Create a server from a template.

**Request Body:**
```json
{
  "name": "My GitHub Server",
  "env": {
    "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"
  },
  "groupId": "optional-group-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "new-server-uuid",
    "name": "My GitHub Server",
    "status": "disconnected",
    ...
  }
}
```

---

## Favorites

### GET /api/favorites

Get favorited tools for the authenticated API key.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "toolName": "read_file",
      "serverId": "server-uuid",
      "serverName": "filesystem-server",
      "favoritedAt": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

---

### POST /api/favorites/:toolName

Add a tool to favorites.

**Request Body (optional):**
```json
{
  "serverId": "server-uuid-if-ambiguous"
}
```

---

### DELETE /api/favorites/:toolName

Remove a tool from favorites.

---

## Webhooks

### GET /api/webhooks

List all webhook subscriptions.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "webhook-uuid",
      "url": "https://your-app.com/webhook",
      "events": ["server.connected", "server.disconnected", "tool.invoked"],
      "secret": "whsec_xxxxx (first 10 chars)",
      "enabled": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "lastDeliveryAt": "2024-01-15T10:00:00.000Z",
      "deliveryStats": {
        "total": 150,
        "successful": 148,
        "failed": 2
      }
    }
  ]
}
```

---

### POST /api/webhooks

Create a webhook subscription.

**Request Body:**
```json
{
  "url": "https://your-app.com/webhook",
  "events": ["server.connected", "server.disconnected", "server.error", "tool.invoked", "circuit.opened"],
  "secret": "optional-webhook-secret"
}
```

**Events:**
| Event | Description |
|-------|-------------|
| `server.connected` | MCP server connected |
| `server.disconnected` | MCP server disconnected |
| `server.error` | MCP server error occurred |
| `tool.invoked` | Tool was invoked |
| `tool.error` | Tool invocation failed |
| `circuit.opened` | Circuit breaker opened |
| `circuit.closed` | Circuit breaker closed |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "webhook-uuid",
    "secret": "whsec_full_secret_shown_only_once",
    ...
  }
}
```

---

### DELETE /api/webhooks/:id

Delete a webhook subscription.

---

### POST /api/webhooks/:id/test

Send a test webhook delivery.

**Response:**
```json
{
  "success": true,
  "data": {
    "deliveryId": "delivery-uuid",
    "statusCode": 200,
    "durationMs": 145
  }
}
```

---

### GET /api/webhooks/:id/deliveries

Get webhook delivery history.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | Filter: `success`, `failed` |
| `limit` | number | 20 | Max results |

---

## Cache Management

### GET /api/cache/stats

Get cache statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "entries": 156,
    "hits": 4500,
    "misses": 1200,
    "hitRate": 0.789,
    "memoryUsage": "2.5 MB",
    "oldestEntry": "2024-01-15T08:00:00.000Z"
  }
}
```

---

### DELETE /api/cache

Clear the response cache.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | string | Clear entries matching pattern (e.g., `read_file*`) |
| `serverId` | uuid | Clear entries for specific server |

---

## Audit Logs

### GET /api/audit

Query audit logs.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `action` | string | - | Filter by action type |
| `actor` | string | - | Filter by API key ID |
| `resource` | string | - | Filter by resource type |
| `from` | ISO date | - | Start date |
| `to` | ISO date | - | End date |
| `limit` | number | 50 | Max results |
| `offset` | number | 0 | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "audit-uuid",
        "timestamp": "2024-01-15T10:30:00.000Z",
        "action": "tool.invoke",
        "actor": {
          "type": "api_key",
          "id": "key-uuid",
          "name": "Production Key"
        },
        "resource": {
          "type": "tool",
          "id": "read_file",
          "serverId": "server-uuid"
        },
        "details": {
          "arguments": { "path": "/home/user/file.txt" },
          "durationMs": 45,
          "success": true
        },
        "ip": "192.168.1.1",
        "userAgent": "MCP-Client/1.0"
      }
    ],
    "total": 1500,
    "limit": 50,
    "offset": 0
  }
}
```

**Action Types:**
- `server.create`, `server.update`, `server.delete`
- `server.connect`, `server.disconnect`
- `tool.invoke`
- `group.create`, `group.update`, `group.delete`
- `webhook.create`, `webhook.delete`
- `api_key.create`, `api_key.revoke`

---

### GET /api/audit/export

Export audit logs as CSV or JSON.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | `json` | Export format: `json`, `csv` |
| `from` | ISO date | - | Start date |
| `to` | ISO date | - | End date |

---

## Real-Time Events (SSE)

### GET /api/sse/events

Server-Sent Events stream for real-time updates.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `types` | string | Comma-separated event types to subscribe |
| `servers` | string | Comma-separated server IDs to filter |

**Event Format:**
```
event: server.connected
data: {"serverId":"uuid","serverName":"filesystem","toolCount":12,"timestamp":"2024-01-15T10:30:00.000Z"}

event: tool.invoked
data: {"serverId":"uuid","toolName":"read_file","durationMs":45,"success":true,"timestamp":"2024-01-15T10:30:01.000Z"}
```

**JavaScript Example:**
```javascript
const eventSource = new EventSource('/api/sse/events?types=server.connected,server.disconnected', {
  headers: { 'Authorization': 'Bearer your-api-key' }
});

eventSource.addEventListener('server.connected', (e) => {
  const data = JSON.parse(e.data);
  console.log(`Server connected: ${data.serverName}`);
});

eventSource.addEventListener('server.disconnected', (e) => {
  const data = JSON.parse(e.data);
  console.log(`Server disconnected: ${data.serverName}`);
});
```

---

## Monitoring & Metrics

### GET /api/monitor

Get monitoring dashboard data.

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalServers": 5,
      "connectedServers": 4,
      "totalTools": 60,
      "uptime": 86400,
      "requestsToday": 1500
    },
    "servers": [...],
    "recentActivity": [...],
    "circuitBreakers": [
      {
        "serverId": "uuid",
        "serverName": "external-api",
        "state": "closed",
        "failures": 0,
        "lastFailure": null
      }
    ]
  }
}
```

---

### GET /api/monitor/circuit-breakers

Get circuit breaker states for all servers.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "serverId": "uuid",
      "serverName": "external-api",
      "state": "closed",
      "failures": 0,
      "successCount": 150,
      "lastStateChange": "2024-01-15T08:00:00.000Z"
    },
    {
      "serverId": "uuid2",
      "serverName": "slow-service",
      "state": "open",
      "failures": 5,
      "successCount": 0,
      "lastStateChange": "2024-01-15T10:25:00.000Z",
      "cooldownEndsAt": "2024-01-15T10:26:00.000Z"
    }
  ]
}
```

---

### GET /metrics

Prometheus metrics endpoint.

**Response (text/plain):**
```
# HELP mcp_connect_requests_total Total number of requests
# TYPE mcp_connect_requests_total counter
mcp_connect_requests_total{method="GET",path="/api/tools",status="200"} 1500

# HELP mcp_connect_tool_invocations_total Total tool invocations
# TYPE mcp_connect_tool_invocations_total counter
mcp_connect_tool_invocations_total{tool="read_file",server="filesystem",status="success"} 5000

# HELP mcp_connect_active_connections Current active server connections
# TYPE mcp_connect_active_connections gauge
mcp_connect_active_connections 4

# HELP mcp_connect_circuit_breaker_state Circuit breaker state (0=closed, 1=half-open, 2=open)
# TYPE mcp_connect_circuit_breaker_state gauge
mcp_connect_circuit_breaker_state{server="external-api"} 0

# HELP mcp_connect_request_duration_seconds Request duration histogram
# TYPE mcp_connect_request_duration_seconds histogram
mcp_connect_request_duration_seconds_bucket{le="0.01"} 500
mcp_connect_request_duration_seconds_bucket{le="0.05"} 1200
mcp_connect_request_duration_seconds_bucket{le="0.1"} 1400
mcp_connect_request_duration_seconds_bucket{le="0.5"} 1490
mcp_connect_request_duration_seconds_bucket{le="1"} 1498
mcp_connect_request_duration_seconds_bucket{le="+Inf"} 1500
```

---

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message description",
  "code": "ERROR_CODE",
  "details": { },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Common Error Codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `FORBIDDEN` | 403 | API key lacks required permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `SERVER_DISCONNECTED` | 503 | MCP server is not connected |
| `CIRCUIT_OPEN` | 503 | Circuit breaker is open |
| `TIMEOUT` | 504 | Request timed out |
| `INTERNAL_ERROR` | 500 | Internal server error |

**Rate Limit Headers:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705315860
```

---

## SDK Examples

### Node.js / TypeScript

```typescript
import { MCPConnectClient } from '@your-org/mcp-connect-sdk';

const client = new MCPConnectClient({
  baseUrl: 'https://your-deployment.railway.app',
  apiKey: 'your-api-key'
});

// List tools
const tools = await client.tools.list({ category: 'storage' });

// Invoke a tool
const result = await client.tools.invoke('read_file', {
  path: '/home/user/document.txt'
});

// Subscribe to events
client.events.subscribe(['server.connected', 'tool.invoked'], (event) => {
  console.log('Event:', event.type, event.data);
});
```

### Python

```python
from mcp_connect import MCPConnectClient

client = MCPConnectClient(
    base_url="https://your-deployment.railway.app",
    api_key="your-api-key"
)

# List tools
tools = client.tools.list(category="storage")

# Invoke a tool
result = client.tools.invoke("read_file", path="/home/user/document.txt")

# Stream events
for event in client.events.stream(types=["server.connected"]):
    print(f"Event: {event.type}")
```

### cURL

```bash
# List servers
curl -H "Authorization: Bearer your-api-key" \
  https://your-deployment.railway.app/api/servers

# Invoke a tool
curl -X POST \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"path": "/home/user/file.txt"}}' \
  https://your-deployment.railway.app/api/tools/read_file/invoke
```

---

## Rate Limits

Default rate limits per API key:

| Tier | Requests/Minute | Requests/Day |
|------|-----------------|--------------|
| Free | 60 | 1,000 |
| Pro | 300 | 50,000 |
| Enterprise | Unlimited | Unlimited |

Rate limits can be customized per API key. Contact support for enterprise limits.

---

## Changelog

### v1.0.0 (2024-01-15)
- Initial release with full API support
- Server management, tool invocation, groups, templates
- Real-time SSE events
- Prometheus metrics
- Webhook subscriptions
- Circuit breaker pattern
- Response caching
