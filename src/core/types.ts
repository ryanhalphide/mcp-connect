import { z } from 'zod';

// Transport configuration schemas
export const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

export const SseTransportSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const HttpTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const TransportConfigSchema = z.discriminatedUnion('type', [
  StdioTransportSchema,
  SseTransportSchema,
  HttpTransportSchema,
]);

// Auth configuration schemas
export const NoAuthSchema = z.object({
  type: z.literal('none'),
});

export const ApiKeyAuthSchema = z.object({
  type: z.literal('api_key'),
  key: z.string(),
  header: z.string().default('Authorization'),
  prefix: z.string().default('Bearer'),
});

export const OAuth2AuthSchema = z.object({
  type: z.literal('oauth2'),
  clientId: z.string(),
  clientSecret: z.string(),
  tokenUrl: z.string().url(),
  scopes: z.array(z.string()).default([]),
});

export const AuthConfigSchema = z.discriminatedUnion('type', [
  NoAuthSchema,
  ApiKeyAuthSchema,
  OAuth2AuthSchema,
]);

// Health check configuration
export const HealthCheckConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().min(1000).default(30000),
  timeoutMs: z.number().min(100).default(5000),
});

// Rate limit configuration
export const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().min(0).default(60),
  requestsPerDay: z.number().min(0).default(10000),
});

// Server metadata
export const ServerMetadataSchema = z.object({
  tags: z.array(z.string()).default([]),
  category: z.string().default('general'),
  version: z.string().default('1.0.0'),
  maintainer: z.string().optional(),
});

// Server Group schema
export const ServerGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6366f1'),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().int().default(0),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type ServerGroup = z.infer<typeof ServerGroupSchema>;

// Main MCP Server Configuration schema
export const MCPServerConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().default(''),
  transport: TransportConfigSchema,
  auth: AuthConfigSchema.default({ type: 'none' }),
  healthCheck: HealthCheckConfigSchema.default({}),
  rateLimits: RateLimitConfigSchema.default({}),
  metadata: ServerMetadataSchema.default({}),
  groupId: z.string().uuid().nullable().default(null),
  enabled: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// Tool registry entry
export const ToolRegistryEntrySchema = z.object({
  name: z.string(),
  serverId: z.string().uuid(),
  serverName: z.string(),
  description: z.string().default(''),
  inputSchema: z.record(z.unknown()).optional(),
  registeredAt: z.date().default(() => new Date()),
});

// Infer types from schemas
export type StdioTransport = z.infer<typeof StdioTransportSchema>;
export type SseTransport = z.infer<typeof SseTransportSchema>;
export type HttpTransport = z.infer<typeof HttpTransportSchema>;
export type TransportConfig = z.infer<typeof TransportConfigSchema>;

export type NoAuth = z.infer<typeof NoAuthSchema>;
export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type OAuth2Auth = z.infer<typeof OAuth2AuthSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type ServerMetadata = z.infer<typeof ServerMetadataSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type ToolRegistryEntry = z.infer<typeof ToolRegistryEntrySchema>;

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// MCP Connection interface
export interface MCPConnection {
  serverId: string;
  status: ConnectionStatus;
  client: unknown; // Will be typed to MCP Client
  lastHealthCheck?: Date;
  error?: string;
}

// Tool invocation result
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  serverId: string;
  toolName: string;
  durationMs: number;
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
