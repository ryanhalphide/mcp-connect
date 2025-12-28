import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { MCPServerConfig, TransportConfig, AuthConfig } from '../core/types.js';
import { getAuthHeaders, clearAuthCache } from '../core/auth.js';
import { createChildLogger } from '../observability/logger.js';
import { LenientJsonSchemaValidator } from './lenientValidator.js';
import { createWebSocketTransport, type RobustWebSocketTransport } from './websocketTransport.js';

const logger = createChildLogger({ module: 'mcp-client' });

export interface MCPClientWrapper {
  client: Client;
  disconnect: () => Promise<void>;
  transport?: RobustWebSocketTransport; // Exposed for WebSocket state inspection
}

function createStdioTransport(
  config: Extract<TransportConfig, { type: 'stdio' }>,
  _auth: AuthConfig
) {
  // Note: stdio transport doesn't support auth headers directly
  // Auth for stdio would be via environment variables if needed
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  });
}

async function createSseTransport(
  serverId: string,
  config: Extract<TransportConfig, { type: 'sse' }>,
  auth: AuthConfig
) {
  const authHeaders = await getAuthHeaders(serverId, auth);
  const headers = { ...config.headers, ...authHeaders };

  logger.debug(
    { serverId, hasAuthHeaders: Object.keys(authHeaders).length > 0 },
    'Creating SSE transport with auth'
  );

  return new SSEClientTransport(new URL(config.url), {
    requestInit: {
      headers,
    },
    eventSourceInit: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: {
            ...(init?.headers || {}),
            ...headers,
          },
        }),
    },
  });
}

async function createHttpTransport(
  serverId: string,
  config: Extract<TransportConfig, { type: 'http' }>,
  auth: AuthConfig
) {
  const authHeaders = await getAuthHeaders(serverId, auth);
  const headers = { ...config.headers, ...authHeaders };

  logger.debug(
    { serverId, hasAuthHeaders: Object.keys(authHeaders).length > 0 },
    'Creating HTTP transport with auth'
  );

  // HTTP transport uses SSE under the hood for MCP
  return new SSEClientTransport(new URL(config.url), {
    requestInit: {
      headers,
    },
    eventSourceInit: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: {
            ...(init?.headers || {}),
            ...headers,
          },
        }),
    },
  });
}

export async function createMCPClient(serverConfig: MCPServerConfig): Promise<MCPClientWrapper> {
  const { transport, auth, name, id } = serverConfig;

  logger.info(
    { serverId: id, serverName: name, transportType: transport.type, authType: auth.type },
    'Creating MCP client'
  );

  let mcpTransport;

  switch (transport.type) {
    case 'stdio':
      mcpTransport = createStdioTransport(transport, auth);
      break;
    case 'sse':
      mcpTransport = await createSseTransport(id, transport, auth);
      break;
    case 'http':
      mcpTransport = await createHttpTransport(id, transport, auth);
      break;
    case 'websocket':
      mcpTransport = createWebSocketTransport(id, name, {
        url: transport.url,
        headers: transport.headers,
        reconnect: transport.reconnect,
        heartbeat: transport.heartbeat,
      });
      break;
    default:
      throw new Error(`Unsupported transport type: ${(transport as { type: string }).type}`);
  }

  const client = new Client(
    { name: `mcp-connect-${name}`, version: '0.1.0' },
    {
      capabilities: {},
      // Use lenient validator to allow additional properties in tool responses
      jsonSchemaValidator: new LenientJsonSchemaValidator(),
    }
  );

  await client.connect(mcpTransport);

  logger.info({ serverId: id, serverName: name }, 'MCP client connected');

  // For WebSocket transport, expose the transport for state inspection
  const wsTransport = transport.type === 'websocket'
    ? mcpTransport as RobustWebSocketTransport
    : undefined;

  return {
    client,
    disconnect: async () => {
      logger.info({ serverId: id, serverName: name }, 'Disconnecting MCP client');
      clearAuthCache(id);
      await client.close();
    },
    transport: wsTransport,
  };
}

export async function listTools(client: Client) {
  const response = await client.listTools();
  return response.tools;
}

export async function callTool(client: Client, toolName: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name: toolName, arguments: args });
  return response;
}

export async function listResources(client: Client) {
  const response = await client.listResources();
  return response.resources;
}

export async function readResource(client: Client, uri: string) {
  const response = await client.readResource({ uri });
  return response;
}

export async function listPrompts(client: Client) {
  const response = await client.listPrompts();
  return response.prompts;
}

export async function getPrompt(client: Client, name: string, args?: Record<string, string>) {
  const response = await client.getPrompt({ name, arguments: args });
  return response;
}
