# MCP Connect - Railway Deployment Guide

## Overview

MCP Connect is deployed to Railway and provides a centralized REST API for managing and invoking MCP (Model Context Protocol) servers.

**Production URL:** `https://mcp-connect-production.up.railway.app`

## Deployment Architecture

### Components

1. **Node.js Application** (v20+)
   - Hono web framework
   - SQLite database for persistence
   - stdio-based MCP client connections

2. **MCP Servers** (loaded from config)
   - `filesystem` - File system operations
   - `everything` - MCP protocol demonstrations
   - `memory` - In-memory key-value storage

3. **Authentication Layer**
   - Master API key for admin operations
   - User API keys with scoped permissions
   - JWT-free token validation

### File Structure

```
mcp-connect/
├── config/
│   └── servers.json          # MCP server configurations
├── data/
│   └── mcp-connect.db        # SQLite database (auto-created)
├── dist/                     # Compiled JavaScript
├── scripts/
│   └── ensure-data-dir.js    # Pre-start database directory creation
├── railway.toml              # Railway configuration
└── package.json
```

## Railway Configuration

### Environment Variables

Set these in Railway's environment variables:

```bash
# Required
MASTER_API_KEY=<your-secure-master-key>

# Optional
PORT=3000                      # Railway sets this automatically
NODE_ENV=production
```

### Build Configuration

Railway automatically detects the Node.js app and uses these settings:

**Build Command:** `npm run build`
**Start Command:** `npm start`

The `prestart` script ensures the data directory exists before SQLite initializes:

```json
{
  "scripts": {
    "prestart": "node scripts/ensure-data-dir.js",
    "start": "node dist/index.js"
  }
}
```

### Database Persistence

**Important:** SQLite database is stored in `/data` directory which is **NOT persisted** between deployments. Each deployment creates a fresh database.

**Solutions:**
1. Use config-based server loading (recommended)
2. Migrate to PostgreSQL for production persistence
3. Use Railway volumes (if available)

## MCP Server Configuration

### Config File: `config/servers.json`

Servers defined in this file are automatically loaded at startup:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "description": "Local filesystem access via MCP",
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      },
      "auth": { "type": "none" },
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
        "tags": ["filesystem", "local"],
        "category": "storage",
        "version": "1.0.0"
      }
    }
  ]
}
```

### Supported Transport Types

1. **stdio** - Spawn child process (works on Railway)
   ```json
   {
     "type": "stdio",
     "command": "npx",
     "args": ["-y", "@modelcontextprotocol/server-name"]
   }
   ```

2. **sse** - Server-Sent Events over HTTP
   ```json
   {
     "type": "sse",
     "url": "https://mcp-server.example.com"
   }
   ```

3. **http** - HTTP transport
   ```json
   {
     "type": "http",
     "url": "https://mcp-server.example.com"
   }
   ```

## API Reference

### Base URL

```
https://mcp-connect-production.up.railway.app/api
```

### Authentication

All protected endpoints require an API key. Three authentication methods supported:

1. **Authorization Header** (Recommended)
   ```bash
   Authorization: Bearer mcp_live_<key>
   ```

2. **X-API-Key Header**
   ```bash
   x-api-key: mcp_live_<key>
   ```

3. **Query Parameter** (Less secure)
   ```bash
   ?api_key=mcp_live_<key>
   ```

### Endpoints

#### Health Check (Public)

```bash
GET /api/health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "0.1.1",
    "uptime": 301,
    "servers": {
      "total": 3,
      "connected": 3,
      "errored": 0
    },
    "tools": {
      "registered": 34
    },
    "timestamp": "2025-12-28T01:24:40.448Z"
  }
}
```

#### Create API Key (Master Key Required)

```bash
POST /api/keys
X-Master-Key: <master-api-key>
Content-Type: application/json

{
  "name": "my-api-key",
  "scopes": ["tools:invoke", "servers:read", "tools:list"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "46419556ce7a594ee67d752b0c498e1b",
    "key": "mcp_live_1f4bbff162d39339066b4e120495342626ef0968e91080d12cbdf37318138d94",
    "name": "my-api-key",
    "createdAt": "2025-12-28T01:27:59.750Z",
    "enabled": true,
    "metadata": {
      "scopes": ["tools:invoke", "servers:read", "tools:list"]
    },
    "warning": "Save this API key securely. It will not be shown again."
  }
}
```

#### List API Keys (Master Key Required)

```bash
GET /api/keys?api_key=<master-api-key>
```

#### List All Tools (API Key Required)

```bash
GET /api/tools
Authorization: Bearer <api-key>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "filesystem/read_file",
        "serverId": "12e9d7b3-e85f-425b-b847-3fa95ffef56b",
        "serverName": "filesystem",
        "description": "Read the complete contents of a file as text",
        "inputSchema": {
          "type": "object",
          "properties": {
            "path": { "type": "string" }
          },
          "required": ["path"]
        },
        "registeredAt": "2025-12-28T01:25:48.036Z"
      }
    ],
    "count": 34,
    "totalRegistered": 34
  }
}
```

#### Search Tools (API Key Required)

```bash
GET /api/tools?q=filesystem
Authorization: Bearer <api-key>
```

#### Get Tool Details (API Key Required)

```bash
GET /api/tools/everything/add
Authorization: Bearer <api-key>
```

#### Invoke Tool (API Key Required)

```bash
POST /api/tools/{toolName}/invoke
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "params": {
    "a": 15,
    "b": 27
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "result": {
      "content": [
        {
          "type": "text",
          "text": "The sum of 15 and 27 is 42."
        }
      ]
    },
    "serverId": "c3627fa8-e906-4638-a8bf-ec6c65a85f94",
    "toolName": "everything/add",
    "durationMs": 15,
    "rateLimit": {
      "remaining": {
        "perMinute": 28,
        "perDay": 4998
      },
      "resetAt": {
        "minute": "2025-12-28T01:30:17.103Z",
        "day": "2025-12-28T07:00:00.000Z"
      }
    }
  },
  "timestamp": "2025-12-28T01:29:36.696Z"
}
```

#### Batch Tool Invocation (API Key Required)

```bash
POST /api/tools/batch
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "invocations": [
    {
      "toolName": "everything/add",
      "params": { "a": 10, "b": 20 }
    },
    {
      "toolName": "everything/echo",
      "params": { "message": "Hello" }
    }
  ]
}
```

#### List Servers (API Key Required)

```bash
GET /api/servers
Authorization: Bearer <api-key>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "12e9d7b3-e85f-425b-b847-3fa95ffef56b",
      "name": "filesystem",
      "description": "Local filesystem access via MCP",
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      },
      "enabled": true,
      "connectionStatus": "connected",
      "toolCount": 11
    }
  ]
}
```

#### Add Server (API Key Required)

```bash
POST /api/servers
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "name": "my-server",
  "description": "Custom MCP server",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-custom"]
  }
}
```

#### Monitoring Dashboard (Public)

```bash
GET /api/monitor/dashboard
```

Opens an HTML dashboard showing:
- System uptime and memory usage
- Connected servers and tool counts
- Request metrics and response times
- Recent API requests

#### Monitoring Metrics (Public)

```bash
GET /api/monitor/metrics
```

**Response:**
```json
{
  "success": true,
  "data": {
    "uptime": 301.12,
    "memory": {
      "used": 24.01,
      "total": 25.27,
      "rss": 85.91
    },
    "requests": {
      "total": 50,
      "successful": 26,
      "failed": 24,
      "successRate": 52,
      "avgResponseTime": 0.76
    },
    "servers": {
      "total": 3,
      "connected": 3,
      "errored": 0
    },
    "tools": {
      "registered": 34
    }
  }
}
```

## Usage Examples

### Complete Workflow

#### 1. Create an API Key

```bash
# Using master key to create a user API key
curl -X POST https://mcp-connect-production.up.railway.app/api/keys \
  -H "X-Master-Key: YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-client",
    "scopes": ["tools:invoke", "servers:read", "tools:list"]
  }'
```

#### 2. List Available Tools

```bash
curl https://mcp-connect-production.up.railway.app/api/tools \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### 3. Invoke a Tool

```bash
# Add two numbers
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/everything/add/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {"a": 15, "b": 27}}'

# Echo a message
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/everything/echo/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {"message": "Hello MCP!"}}'

# Read a file
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/filesystem/read_text_file/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {"path": "/tmp/test.txt"}}'
```

#### 4. Batch Invocation

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/batch \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "invocations": [
      {
        "toolName": "everything/add",
        "params": {"a": 10, "b": 20}
      },
      {
        "toolName": "everything/echo",
        "params": {"message": "Batch test"}
      }
    ]
  }'
```

### JavaScript/Node.js Client

```javascript
const API_URL = 'https://mcp-connect-production.up.railway.app/api';
const API_KEY = 'mcp_live_your_key_here';

// List tools
async function listTools() {
  const response = await fetch(`${API_URL}/tools`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`
    }
  });
  const data = await response.json();
  return data.data.tools;
}

// Invoke a tool
async function invokeTool(toolName, params) {
  const response = await fetch(`${API_URL}/tools/${toolName}/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ params })
  });
  const data = await response.json();
  return data.data.result;
}

// Usage
const tools = await listTools();
console.log('Available tools:', tools.map(t => t.name));

const result = await invokeTool('everything/add', { a: 15, b: 27 });
console.log('Result:', result.content[0].text);
// Output: "The sum of 15 and 27 is 42."
```

### Python Client

```python
import requests

API_URL = "https://mcp-connect-production.up.railway.app/api"
API_KEY = "mcp_live_your_key_here"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# List tools
response = requests.get(f"{API_URL}/tools", headers=headers)
tools = response.json()["data"]["tools"]
print(f"Available tools: {len(tools)}")

# Invoke a tool
response = requests.post(
    f"{API_URL}/tools/everything/add/invoke",
    headers=headers,
    json={"params": {"a": 15, "b": 27}}
)
result = response.json()["data"]["result"]
print(result["content"][0]["text"])
# Output: "The sum of 15 and 27 is 42."
```

## Rate Limiting

Each API key has default rate limits:

- **Per Minute:** 30-120 requests (varies by server)
- **Per Day:** 5,000-50,000 requests (varies by server)

Rate limit information is returned in every tool invocation response:

```json
{
  "rateLimit": {
    "remaining": {
      "perMinute": 28,
      "perDay": 4998
    },
    "resetAt": {
      "minute": "2025-12-28T01:30:17.103Z",
      "day": "2025-12-28T07:00:00.000Z"
    }
  }
}
```

When rate limit is exceeded, you'll receive a `429 Too Many Requests` response with headers:
- `Retry-After`: Seconds until rate limit resets
- `X-RateLimit-Remaining-Minute`: Remaining requests this minute
- `X-RateLimit-Remaining-Day`: Remaining requests today

## Error Handling

### Common Error Responses

**401 Unauthorized**
```json
{
  "success": false,
  "error": "Authentication required. Provide API key via Authorization header (Bearer token), x-api-key header, or api_key query parameter.",
  "timestamp": "2025-12-28T01:26:16.200Z"
}
```

**404 Not Found**
```json
{
  "success": false,
  "error": "Tool not found: nonexistent/tool",
  "timestamp": "2025-12-28T01:26:16.200Z"
}
```

**429 Rate Limit Exceeded**
```json
{
  "success": false,
  "error": "Rate limit exceeded for server 'everything'. Try again in 42 seconds.",
  "rateLimit": {
    "remaining": {
      "perMinute": 0,
      "perDay": 4998
    },
    "resetAt": {
      "minute": "2025-12-28T01:30:17.103Z",
      "day": "2025-12-28T07:00:00.000Z"
    }
  },
  "timestamp": "2025-12-28T01:29:36.696Z"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "error": "MCP error -32603: Internal server error",
  "timestamp": "2025-12-28T01:26:16.200Z"
}
```

## Troubleshooting

### Database Directory Error

**Error:** `Cannot open database because the directory does not exist`

**Solution:** This was fixed in v0.1.1 with the `prestart` script. If you see this error:
1. Ensure `scripts/ensure-data-dir.js` exists
2. Verify `package.json` has `"prestart": "node scripts/ensure-data-dir.js"`
3. Redeploy to Railway

### MCP Servers Not Connecting

**Symptoms:** Health endpoint shows `"connected": 0` and `"tools": {"registered": 0}`

**Solutions:**
1. Check `config/servers.json` exists and is valid JSON
2. Verify server configurations have correct `command` and `args`
3. For stdio transport, ensure npx packages are publicly available
4. Check Railway logs for connection errors

### API Key Not Working

**Symptoms:** `401 Unauthorized` or `Invalid or revoked API key`

**Solutions:**
1. Verify API key format: `mcp_live_<64-character-hash>`
2. Check key hasn't been revoked via `/api/keys` endpoint
3. Ensure correct authentication header format
4. For master key operations, use the exact master key from Railway environment variables

### Tool Invocation Fails

**Error:** `Tool not found` or `Required parameter missing`

**Solutions:**
1. List available tools first: `GET /api/tools`
2. Check tool name format: `serverName/toolName`
3. Verify params are wrapped: `{"params": {...}}`
4. Review tool's `inputSchema` for required parameters

### Fresh Database After Deployment

**Issue:** Database resets on each deployment, losing API keys and servers

**Explanation:** SQLite database in `/data` directory is not persisted between Railway deployments.

**Solutions:**
1. **Use config-based servers** (recommended): Add servers to `config/servers.json`
2. **Migrate to PostgreSQL**: Use Railway's PostgreSQL addon for persistence
3. **Re-create keys**: Use master key to recreate API keys after each deployment
4. **External storage**: Store server configs in external service

## Security Best Practices

1. **Master Key Protection**
   - Store master key in Railway environment variables only
   - Never commit master key to git
   - Rotate master key periodically

2. **API Key Management**
   - Create scoped API keys for different clients
   - Use least-privilege principle for scopes
   - Revoke unused keys regularly
   - Monitor key usage via logs

3. **Rate Limiting**
   - Implement client-side rate limit handling
   - Cache tool responses when appropriate
   - Use batch invocation for multiple tools

4. **HTTPS Only**
   - Railway provides automatic HTTPS
   - Never use HTTP in production
   - Validate SSL certificates in clients

## Monitoring

### Health Check

Monitor deployment health:
```bash
curl https://mcp-connect-production.up.railway.app/api/health
```

### Metrics Dashboard

View real-time metrics:
```
https://mcp-connect-production.up.railway.app/api/monitor/dashboard
```

### Railway Logs

View application logs in Railway dashboard:
1. Go to Railway project
2. Select `mcp-connect` service
3. Click "Deployments" tab
4. Select active deployment
5. View logs

## Deployment Checklist

- [ ] Set `MASTER_API_KEY` in Railway environment variables
- [ ] Configure MCP servers in `config/servers.json`
- [ ] Verify `prestart` script exists in `package.json`
- [ ] Test health endpoint after deployment
- [ ] Create initial API keys via master key
- [ ] Test tool invocation with API key
- [ ] Set up monitoring/alerting (optional)
- [ ] Document API keys securely

## Support

For issues or questions:
1. Check Railway deployment logs
2. Review this documentation
3. Test with health endpoint first
4. Verify API key authentication
5. Check MCP server configurations

## Version History

- **v0.1.1** (2025-12-28)
  - Fixed database directory creation issue
  - Added prestart script for Railway compatibility
  - Verified stdio transport works on Railway
  - Confirmed 3 servers with 34 tools working

- **v0.1.0** (2025-12-27)
  - Initial Railway deployment
  - Authentication system implemented
  - Config-based server loading
