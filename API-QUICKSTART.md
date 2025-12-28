# MCP Connect - API Quick Reference

> **Production URL:** `https://mcp-connect-production.up.railway.app`

## Quick Setup (30 seconds)

### 1. Get Health Status (No Auth Required)

```bash
curl https://mcp-connect-production.up.railway.app/api/health
```

### 2. Create Your API Key (Master Key Required)

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/keys \
  -H "X-Master-Key: YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-key","scopes":["tools:invoke","servers:read","tools:list"]}'
```

**Save the returned API key! Format:** `mcp_live_<64-chars>`

### 3. List Tools

```bash
curl https://mcp-connect-production.up.railway.app/api/tools \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 4. Invoke a Tool

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/everything/add/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params":{"a":15,"b":27}}'
```

**Response:** `{"success":true,"data":{"result":{"content":[{"type":"text","text":"The sum of 15 and 27 is 42."}]}}}`

## Available Tools

### everything/* (11 tools)
- `everything/add` - Add two numbers
- `everything/echo` - Echo a message
- `everything/longRunningOperation` - Test async operations
- `everything/sampleLLM` - Sample LLM interaction
- `everything/getTinyImage` - Get a small image
- `everything/zip` - Zip files

### filesystem/* (11 tools)
- `filesystem/read_text_file` - Read file contents
- `filesystem/read_multiple_files` - Read multiple files
- `filesystem/write_file` - Write to a file
- `filesystem/create_directory` - Create directory
- `filesystem/list_directory` - List directory contents
- `filesystem/move_file` - Move/rename file
- `filesystem/search_files` - Search for files
- `filesystem/get_file_info` - Get file metadata
- `filesystem/list_allowed_directories` - Show accessible paths

### memory/* (12 tools)
- `memory/store` - Store key-value pair
- `memory/retrieve` - Get stored value
- `memory/delete` - Delete key
- `memory/list` - List all keys
- `memory/search` - Search in values

## Common Patterns

### Authentication

Three methods (same result):

```bash
# Method 1: Authorization header (recommended)
-H "Authorization: Bearer mcp_live_xxx"

# Method 2: X-API-Key header
-H "x-api-key: mcp_live_xxx"

# Method 3: Query parameter (less secure)
?api_key=mcp_live_xxx
```

### Request Format

All tool invocations use this format:

```bash
POST /api/tools/{serverName}/{toolName}/invoke
{
  "params": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

### Response Format

Success:
```json
{
  "success": true,
  "data": {
    "result": {
      "content": [{"type": "text", "text": "Result here"}]
    },
    "serverId": "uuid",
    "toolName": "server/tool",
    "durationMs": 15,
    "rateLimit": {
      "remaining": {"perMinute": 28, "perDay": 4998},
      "resetAt": {"minute": "ISO-date", "day": "ISO-date"}
    }
  }
}
```

Error:
```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "ISO-date"
}
```

## Code Examples

### JavaScript/TypeScript

```typescript
const API_URL = 'https://mcp-connect-production.up.railway.app/api';
const API_KEY = 'mcp_live_your_key';

async function invoke(toolName: string, params: any) {
  const res = await fetch(`${API_URL}/tools/${toolName}/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ params })
  });
  return res.json();
}

// Usage
const result = await invoke('everything/add', { a: 10, b: 20 });
console.log(result.data.result.content[0].text);
```

### Python

```python
import requests

API_URL = "https://mcp-connect-production.up.railway.app/api"
API_KEY = "mcp_live_your_key"

def invoke(tool_name, params):
    response = requests.post(
        f"{API_URL}/tools/{tool_name}/invoke",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={"params": params}
    )
    return response.json()

# Usage
result = invoke("everything/add", {"a": 10, "b": 20})
print(result["data"]["result"]["content"][0]["text"])
```

### cURL Examples

#### Add Numbers
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/everything/add/invoke \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params":{"a":10,"b":20}}'
```

#### Echo Message
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/everything/echo/invoke \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params":{"message":"Hello!"}}'
```

#### Read File
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/filesystem/read_text_file/invoke \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params":{"path":"/tmp/test.txt"}}'
```

#### Store in Memory
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/memory/store/invoke \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params":{"key":"user:123","value":"John Doe"}}'
```

#### Retrieve from Memory
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/memory/retrieve/invoke \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params":{"key":"user:123"}}'
```

#### Batch Invocation
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/batch \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "invocations": [
      {"toolName": "everything/add", "params": {"a": 10, "b": 20}},
      {"toolName": "everything/echo", "params": {"message": "Test"}}
    ]
  }'
```

## Endpoint Cheat Sheet

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/health` | GET | None | System health |
| `/api/monitor/dashboard` | GET | None | Web dashboard |
| `/api/monitor/metrics` | GET | None | System metrics |
| `/api/keys` | POST | Master | Create API key |
| `/api/keys` | GET | Master | List API keys |
| `/api/tools` | GET | API Key | List tools |
| `/api/tools?q=search` | GET | API Key | Search tools |
| `/api/tools/{name}` | GET | API Key | Get tool details |
| `/api/tools/{name}/invoke` | POST | API Key | Invoke tool |
| `/api/tools/batch` | POST | API Key | Batch invoke |
| `/api/servers` | GET | API Key | List servers |
| `/api/servers` | POST | API Key | Add server |
| `/api/servers/{id}` | GET | API Key | Get server |
| `/api/servers/{id}` | PATCH | API Key | Update server |
| `/api/servers/{id}` | DELETE | API Key | Delete server |

## Common Errors

### 401 Unauthorized
**Cause:** Missing or invalid API key
**Fix:** Include valid API key in Authorization header

### 404 Not Found
**Cause:** Tool doesn't exist or wrong name format
**Fix:** Check tool name format: `serverName/toolName`

### 429 Rate Limited
**Cause:** Too many requests
**Fix:** Wait for rate limit reset (see `rateLimit.resetAt` in response)

### 400 Bad Request
**Cause:** Invalid parameters
**Fix:** Check tool's `inputSchema` for required params

## Rate Limits

- **Per Minute:** 30-120 requests (varies by server)
- **Per Day:** 5,000-50,000 requests (varies by server)

Rate limit info included in every response:
```json
{
  "rateLimit": {
    "remaining": {
      "perMinute": 28,
      "perDay": 4998
    },
    "resetAt": {
      "minute": "2025-12-28T01:30:00Z",
      "day": "2025-12-29T00:00:00Z"
    }
  }
}
```

## Testing in Browser

Visit the monitoring dashboard:
```
https://mcp-connect-production.up.railway.app/api/monitor/dashboard
```

## Need More Details?

See [DEPLOYMENT.md](./DEPLOYMENT.md) for:
- Complete deployment guide
- All endpoint documentation
- Security best practices
- Troubleshooting guide
- Server configuration
