# MCP Connect Integration Guide

A comprehensive guide to integrating MCP Connect into your applications and workflows.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Quick Start Examples](#quick-start-examples)
3. [Authentication](#authentication)
4. [Connecting MCP Servers](#connecting-mcp-servers)
5. [Working with Tools](#working-with-tools)
6. [Real-Time Integration](#real-time-integration)
7. [AI/LLM Integration](#aillm-integration)
8. [Production Patterns](#production-patterns)
9. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

- Node.js 18+ (for self-hosting) or a cloud deployment
- An MCP Connect API key
- At least one MCP server to connect

### Installation Options

**Option 1: Cloud Deployment (Recommended)**

Deploy to Railway, Render, or any container platform:

```bash
# Clone the repository
git clone https://github.com/your-org/mcp-connect.git
cd mcp-connect

# Deploy to Railway
railway deploy
```

**Option 2: Self-Hosted**

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start the server
npm start
```

**Option 3: Docker**

```bash
docker run -d \
  -p 3000:3000 \
  -e API_KEYS=your-api-key \
  -v ./config:/app/config \
  your-org/mcp-connect:latest
```

### Environment Variables

```bash
# Required
API_KEYS=key1,key2,key3          # Comma-separated API keys
PORT=3000                         # Server port

# Optional
LOG_LEVEL=info                    # debug, info, warn, error
NODE_ENV=production               # development, production
ENABLE_PROMETHEUS=true            # Enable /metrics endpoint
CACHE_TTL_SECONDS=300             # Default cache TTL
```

---

## Quick Start Examples

### 1. Connect Your First Server

```bash
# Create a filesystem server using the template
curl -X POST \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Filesystem",
    "env": {
      "ALLOWED_DIRECTORIES": "/home/user/documents"
    }
  }' \
  https://your-deployment/api/templates/builtin-filesystem/instantiate

# Connect the server
curl -X POST \
  -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/servers/{server-id}/connect
```

### 2. List Available Tools

```bash
curl -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/tools
```

### 3. Invoke a Tool

```bash
curl -X POST \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"path": "/home/user/documents/readme.txt"}}' \
  https://your-deployment/api/tools/read_file/invoke
```

---

## Authentication

### API Key Authentication

All API requests require an API key in the `Authorization` header:

```
Authorization: Bearer your-api-key
```

### Managing API Keys

API keys are configured via environment variables or the admin interface:

```bash
# Environment variable (comma-separated)
API_KEYS=prod-key-abc123,dev-key-xyz789

# Or via config file
echo '{"keys": [{"id": "key1", "name": "Production"}]}' > config/api-keys.json
```

### Key Rotation

To rotate an API key without downtime:

1. Add the new key to the configuration
2. Update your applications to use the new key
3. Remove the old key from the configuration

### Per-Key Rate Limits

Each API key can have custom rate limits:

```json
{
  "keys": [
    {
      "id": "prod-key-abc123",
      "name": "Production",
      "rateLimits": {
        "requestsPerMinute": 300,
        "requestsPerDay": 50000
      }
    }
  ]
}
```

---

## Connecting MCP Servers

### Using Templates (Recommended)

Templates provide pre-configured setups for popular services:

```javascript
// List available templates
const templates = await fetch('/api/templates', {
  headers: { 'Authorization': 'Bearer your-api-key' }
}).then(r => r.json());

// Instantiate a template
const server = await fetch('/api/templates/builtin-github/instantiate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My GitHub',
    env: {
      GITHUB_TOKEN: 'ghp_xxxxxxxxxxxx'
    }
  })
}).then(r => r.json());
```

### Available Templates

| Template | Category | Description |
|----------|----------|-------------|
| Filesystem | Storage | Local file system access |
| GitHub | Development | GitHub repositories, issues, PRs |
| PostgreSQL | Database | PostgreSQL database operations |
| Slack | Communication | Slack messaging and channels |
| S3 | Cloud | AWS S3 bucket operations |
| Redis | Database | Redis key-value operations |
| Docker | Infrastructure | Docker container management |
| Stripe | Finance | Payment processing |
| And 20+ more... | | |

### Manual Server Configuration

For custom servers, create them directly:

```javascript
const server = await fetch('/api/servers', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Custom Server',
    description: 'My custom MCP server',
    transport: {
      type: 'stdio',
      command: 'node',
      args: ['./my-mcp-server.js'],
      env: {
        MY_SECRET: 'value'
      }
    },
    auth: { type: 'none' },
    metadata: {
      category: 'custom',
      tags: ['internal', 'testing']
    }
  })
}).then(r => r.json());
```

### Transport Types

**stdio** - For local command-line MCP servers:
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@anthropic/mcp-server-filesystem"],
  "env": { "ALLOWED_DIRECTORIES": "/home/user" }
}
```

**SSE** - For HTTP-based MCP servers with Server-Sent Events:
```json
{
  "type": "sse",
  "url": "https://mcp-server.example.com/sse",
  "headers": { "Authorization": "Bearer token" }
}
```

**WebSocket** - For real-time bidirectional communication:
```json
{
  "type": "websocket",
  "url": "wss://mcp-server.example.com/ws",
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

### Connection Management

```javascript
// Connect a server
await fetch(`/api/servers/${serverId}/connect`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your-api-key' }
});

// Disconnect a server
await fetch(`/api/servers/${serverId}/disconnect`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your-api-key' }
});

// Bulk connect multiple servers
await fetch('/api/servers/bulk/connect', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    serverIds: ['server-1', 'server-2', 'server-3']
  })
});
```

---

## Working with Tools

### Discovering Tools

```javascript
// Search for tools
const tools = await fetch('/api/tools?query=file&category=storage', {
  headers: { 'Authorization': 'Bearer your-api-key' }
}).then(r => r.json());

// Get tool categories
const categories = await fetch('/api/tools/categories', {
  headers: { 'Authorization': 'Bearer your-api-key' }
}).then(r => r.json());
```

### Invoking Tools

```javascript
async function invokeTool(toolName, args) {
  const response = await fetch(`/api/tools/${toolName}/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-api-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ arguments: args })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

// Example: Read a file
const fileContent = await invokeTool('read_file', {
  path: '/home/user/document.txt'
});

// Example: Search GitHub
const issues = await invokeTool('search_issues', {
  query: 'bug fix',
  repo: 'owner/repo'
});
```

### Handling Tool Responses

Tool responses follow the MCP content format:

```javascript
const result = await invokeTool('read_file', { path: '/file.txt' });

// Result structure:
// {
//   content: [
//     { type: 'text', text: 'File contents here...' }
//   ],
//   isError: false
// }

// Handle different content types
for (const item of result.content) {
  switch (item.type) {
    case 'text':
      console.log(item.text);
      break;
    case 'image':
      console.log('Image:', item.data, item.mimeType);
      break;
    case 'resource':
      console.log('Resource URI:', item.uri);
      break;
  }
}
```

### Caching Tool Responses

MCP Connect automatically caches tool responses to improve performance:

```javascript
// Normal request (may return cached response)
const result = await invokeTool('read_file', { path: '/file.txt' });

// Bypass cache for fresh data
const freshResult = await fetch('/api/tools/read_file/invoke', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-key',
    'Content-Type': 'application/json',
    'X-Cache-Bypass': 'true'  // Skip cache
  },
  body: JSON.stringify({ arguments: { path: '/file.txt' } })
}).then(r => r.json());
```

---

## Real-Time Integration

### Server-Sent Events (SSE)

Subscribe to real-time events for live updates:

```javascript
class MCPEventStream {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.eventSource = null;
    this.handlers = new Map();
  }

  connect(eventTypes = []) {
    const typesParam = eventTypes.length > 0
      ? `?types=${eventTypes.join(',')}`
      : '';

    this.eventSource = new EventSource(
      `${this.baseUrl}/api/sse/events${typesParam}`,
      { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
    );

    this.eventSource.onopen = () => {
      console.log('SSE connected');
    };

    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);
    };

    // Register handlers for each event type
    const allEvents = [
      'server.connected',
      'server.disconnected',
      'server.error',
      'tool.invoked',
      'tool.error',
      'circuit.opened',
      'circuit.closed'
    ];

    allEvents.forEach(eventType => {
      this.eventSource.addEventListener(eventType, (e) => {
        const data = JSON.parse(e.data);
        this.emit(eventType, data);
      });
    });
  }

  on(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);
  }

  emit(eventType, data) {
    const handlers = this.handlers.get(eventType) || [];
    handlers.forEach(handler => handler(data));
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Usage
const stream = new MCPEventStream('your-api-key', 'https://your-deployment');

stream.on('server.connected', (data) => {
  console.log(`Server ${data.serverName} connected with ${data.toolCount} tools`);
});

stream.on('tool.invoked', (data) => {
  console.log(`Tool ${data.toolName} invoked, took ${data.durationMs}ms`);
});

stream.connect(['server.connected', 'server.disconnected', 'tool.invoked']);
```

### Webhooks

For server-side event handling:

```javascript
// Create a webhook subscription
const webhook = await fetch('/api/webhooks', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://your-app.com/mcp-webhook',
    events: ['server.connected', 'server.disconnected', 'tool.invoked'],
    secret: 'your-webhook-secret'
  })
}).then(r => r.json());

// Webhook handler (Express.js example)
app.post('/mcp-webhook', (req, res) => {
  // Verify signature
  const signature = req.headers['x-mcp-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', 'your-webhook-secret')
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }

  // Handle event
  const { event, data, timestamp } = req.body;

  switch (event) {
    case 'server.connected':
      console.log(`Server connected: ${data.serverName}`);
      break;
    case 'tool.invoked':
      console.log(`Tool invoked: ${data.toolName}`);
      break;
  }

  res.status(200).send('OK');
});
```

---

## AI/LLM Integration

### OpenAI Function Calling

Transform MCP tools into OpenAI function definitions:

```javascript
async function getMCPToolsAsOpenAIFunctions() {
  const tools = await fetch('/api/tools', {
    headers: { 'Authorization': 'Bearer your-api-key' }
  }).then(r => r.json());

  return tools.data.tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} }
    }
  }));
}

// Use with OpenAI
import OpenAI from 'openai';

const openai = new OpenAI();
const functions = await getMCPToolsAsOpenAIFunctions();

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Read the file at /home/user/readme.txt' }
  ],
  tools: functions,
  tool_choice: 'auto'
});

// Handle tool calls
if (response.choices[0].message.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    const result = await invokeTool(
      toolCall.function.name,
      JSON.parse(toolCall.function.arguments)
    );

    // Continue conversation with tool result
  }
}
```

### Claude Integration

Use MCP Connect as a tool provider for Claude:

```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const tools = await getMCPToolsAsClaudeFormat();

const response = await anthropic.messages.create({
  model: 'claude-3-opus-20240229',
  max_tokens: 4096,
  tools: tools,
  messages: [
    { role: 'user', content: 'What files are in /home/user/documents?' }
  ]
});

// Handle tool use
for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await invokeTool(block.name, block.input);

    // Continue with tool result
  }
}
```

### LangChain Integration

```python
from langchain.tools import Tool
from langchain.agents import initialize_agent
import requests

class MCPConnectTool(Tool):
    def __init__(self, name, description, api_key, base_url):
        self.api_key = api_key
        self.base_url = base_url
        super().__init__(name=name, description=description, func=self._invoke)

    def _invoke(self, args):
        response = requests.post(
            f"{self.base_url}/api/tools/{self.name}/invoke",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"arguments": args}
        )
        return response.json()["data"]

# Create tools from MCP Connect
def get_mcp_tools(api_key, base_url):
    response = requests.get(
        f"{base_url}/api/tools",
        headers={"Authorization": f"Bearer {api_key}"}
    )

    return [
        MCPConnectTool(
            name=tool["name"],
            description=tool["description"],
            api_key=api_key,
            base_url=base_url
        )
        for tool in response.json()["data"]["tools"]
    ]

# Initialize agent
tools = get_mcp_tools("your-api-key", "https://your-deployment")
agent = initialize_agent(tools, llm, agent="zero-shot-react-description")
```

---

## Production Patterns

### Health Checks

```javascript
// Kubernetes readiness probe
app.get('/health/ready', async (req, res) => {
  const health = await fetch('/api/monitor', {
    headers: { 'Authorization': 'Bearer your-api-key' }
  }).then(r => r.json());

  if (health.data.overview.connectedServers > 0) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready' });
  }
});

// Kubernetes liveness probe
app.get('/health/live', async (req, res) => {
  const response = await fetch('/health');
  if (response.status === 200) {
    res.status(200).json({ status: 'alive' });
  } else {
    res.status(503).json({ status: 'dead' });
  }
});
```

### Circuit Breaker Handling

```javascript
async function invokeWithCircuitBreaker(toolName, args) {
  try {
    return await invokeTool(toolName, args);
  } catch (error) {
    if (error.code === 'CIRCUIT_OPEN') {
      // Circuit is open - use fallback
      console.log(`Circuit open for tool ${toolName}, using fallback`);
      return { fallback: true, message: 'Service temporarily unavailable' };
    }
    throw error;
  }
}
```

### Retry Logic

```javascript
async function invokeWithRetry(toolName, args, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await invokeTool(toolName, args);
    } catch (error) {
      lastError = error;

      // Don't retry on client errors
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Connection Pooling

MCP Connect maintains connection pools automatically. For optimal performance:

```javascript
// Connect all servers at startup
async function initializeMCPConnect() {
  const servers = await fetch('/api/servers', {
    headers: { 'Authorization': 'Bearer your-api-key' }
  }).then(r => r.json());

  // Bulk connect enabled servers
  const enabledIds = servers.data
    .filter(s => s.enabled)
    .map(s => s.id);

  await fetch('/api/servers/bulk/connect', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-api-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ serverIds: enabledIds })
  });
}
```

### Graceful Shutdown

```javascript
async function shutdown() {
  console.log('Shutting down...');

  // Disconnect all servers
  const servers = await fetch('/api/servers?status=connected', {
    headers: { 'Authorization': 'Bearer your-api-key' }
  }).then(r => r.json());

  await fetch('/api/servers/bulk/disconnect', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-api-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      serverIds: servers.data.map(s => s.id)
    })
  });

  console.log('All servers disconnected');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

---

## Troubleshooting

### Common Issues

**1. Server Won't Connect**

```bash
# Check server logs
curl -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/servers/{id}

# Common causes:
# - Invalid command path
# - Missing dependencies (npx packages)
# - Environment variables not set
# - Permission issues
```

**2. Tool Invocation Failing**

```bash
# Check tool schema
curl -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/tools/{name}

# Common causes:
# - Invalid arguments
# - Server disconnected
# - Circuit breaker open
# - Rate limit exceeded
```

**3. SSE Connection Dropping**

```javascript
// Implement reconnection logic
class ResilientEventStream {
  connect() {
    this.eventSource = new EventSource(this.url);

    this.eventSource.onerror = () => {
      this.reconnect();
    };
  }

  reconnect() {
    this.eventSource?.close();
    setTimeout(() => this.connect(), 5000);
  }
}
```

**4. Rate Limiting**

```javascript
// Check rate limit headers
const response = await fetch('/api/tools/read_file/invoke', { ... });

const remaining = response.headers.get('X-RateLimit-Remaining');
const reset = response.headers.get('X-RateLimit-Reset');

if (remaining === '0') {
  const waitMs = (parseInt(reset) * 1000) - Date.now();
  await new Promise(r => setTimeout(r, waitMs));
}
```

### Debug Mode

Enable debug logging:

```bash
# Environment variable
LOG_LEVEL=debug npm start

# Or via API (if supported)
curl -X POST \
  -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/admin/log-level \
  -d '{"level": "debug"}'
```

### Monitoring Queries

```bash
# Check circuit breaker states
curl -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/monitor/circuit-breakers

# Get cache statistics
curl -H "Authorization: Bearer your-api-key" \
  https://your-deployment/api/cache/stats

# View recent audit logs
curl -H "Authorization: Bearer your-api-key" \
  "https://your-deployment/api/audit?limit=20"
```

---

## Next Steps

- [API Reference](./API-REFERENCE.md) - Complete endpoint documentation
- [Security Guide](./SECURITY.md) - Authentication and security best practices
- [Monitoring Guide](./MONITORING.md) - Prometheus, alerting, and dashboards
