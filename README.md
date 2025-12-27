# MCP Connect

Universal MCP Server Aggregator & Connection Manager

## Overview

MCP Connect is a centralized hub that aggregates multiple MCP (Model Context Protocol) servers into a single, unified API. It handles connection management, tool discovery, health monitoring, and provides a REST API for interacting with all connected MCP servers.

## Features

- **Connection Pool Management**: Automatic connection handling with health checks and reconnection
- **Tool Registry**: Unified registry of all tools from connected MCP servers
- **Tool Router**: Route tool invocations to the correct server
- **REST API**: Full API for server management, tool discovery, and invocation
- **Health Monitoring**: Kubernetes-compatible health endpoints

## Quick Start

```bash
# Install dependencies
npm install

# Create data directory
mkdir -p data

# Start development server
npm run dev
```

The server will start at `http://localhost:3000`.

## API Endpoints

### Servers

- `GET /api/servers` - List all configured servers
- `POST /api/servers` - Add a new server
- `GET /api/servers/:id` - Get server details
- `PUT /api/servers/:id` - Update server configuration
- `DELETE /api/servers/:id` - Remove a server
- `POST /api/servers/:id/connect` - Connect to a server
- `POST /api/servers/:id/disconnect` - Disconnect from a server

### Tools

- `GET /api/tools` - List all registered tools
- `GET /api/tools?q=search` - Search tools
- `GET /api/tools/:name` - Get tool details
- `POST /api/tools/:name/invoke` - Invoke a tool
- `POST /api/tools/batch` - Batch invoke multiple tools

### Health

- `GET /api/health` - Full health status
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe
- `GET /api/health/connections` - Connection details

## Configuration

### Adding a Server

```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "filesystem",
    "description": "Local filesystem access",
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }'
```

### Connecting to a Server

```bash
curl -X POST http://localhost:3000/api/servers/{server-id}/connect
```

### Invoking a Tool

```bash
curl -X POST http://localhost:3000/api/tools/filesystem/read_file/invoke \
  -H "Content-Type: application/json" \
  -d '{"params": {"path": "/tmp/test.txt"}}'
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `DB_PATH` - SQLite database path (default: ./data/mcp-connect.db)
- `LOG_LEVEL` - Logging level (default: info)
- `NODE_ENV` - Environment (development/production)

## Architecture

```
mcp-connect/
├── src/
│   ├── api/           # REST API routes
│   │   ├── servers.ts # Server management endpoints
│   │   ├── tools.ts   # Tool discovery and invocation
│   │   └── health.ts  # Health check endpoints
│   ├── core/          # Core business logic
│   │   ├── pool.ts    # Connection pool manager
│   │   ├── registry.ts# Tool registry
│   │   ├── router.ts  # Tool router
│   │   └── types.ts   # Type definitions
│   ├── mcp/           # MCP client wrapper
│   │   └── client.ts  # MCP SDK integration
│   ├── storage/       # Persistence layer
│   │   └── db.ts      # SQLite database
│   ├── observability/ # Logging and metrics
│   │   └── logger.ts  # Pino logger
│   └── index.ts       # Application entry point
├── config/            # Configuration files
└── tests/             # Test files
```

## License

MIT
