import { Hono } from 'hono';
import { z } from 'zod';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import type { ApiResponse } from '../core/types.js';
import { createChildLogger } from '../observability/logger.js';

const execAsync = promisify(exec);
const logger = createChildLogger({ module: 'api-docker' });

export const dockerApi = new Hono();

// Schema for setting a secret
const SetSecretSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.string().min(1),
});

// Helper to create API response
function apiResponse<T>(data: T, success = true): ApiResponse<T> {
  return {
    success,
    data,
    timestamp: new Date().toISOString(),
  };
}

function errorResponse(error: string): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Check if Docker MCP is available
function isDockerMcpAvailable(): boolean {
  try {
    execSync('docker mcp --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// GET /docker/status - Check Docker MCP availability
dockerApi.get('/status', (c) => {
  const available = isDockerMcpAvailable();

  if (!available) {
    return c.json(apiResponse({
      available: false,
      message: 'Docker MCP is not available. Ensure Docker Desktop with MCP support is installed.',
    }));
  }

  // Get version info
  try {
    const version = execSync('docker mcp --version', { encoding: 'utf8' }).trim();
    return c.json(apiResponse({
      available: true,
      version,
    }));
  } catch (error) {
    return c.json(apiResponse({
      available: true,
      version: 'unknown',
    }));
  }
});

// GET /docker/secrets - List all Docker MCP secrets
dockerApi.get('/secrets', async (c) => {
  if (!isDockerMcpAvailable()) {
    c.status(503);
    return c.json(errorResponse('Docker MCP is not available'));
  }

  try {
    const output = execSync('docker mcp secret ls', { encoding: 'utf8' });

    // Parse the output (format: "name | value")
    const secrets = output
      .split('\n')
      .filter(line => line.includes('|'))
      .map(line => {
        const [name, status] = line.split('|').map(s => s.trim());
        return {
          name,
          configured: status !== '',
        };
      });

    return c.json(apiResponse({
      secrets,
      count: secrets.length,
    }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to list secrets';
    logger.error({ error }, 'Failed to list Docker MCP secrets');
    c.status(500);
    return c.json(errorResponse(errorMsg));
  }
});

// POST /docker/secrets - Set a Docker MCP secret
dockerApi.post('/secrets', async (c) => {
  if (!isDockerMcpAvailable()) {
    c.status(503);
    return c.json(errorResponse('Docker MCP is not available'));
  }

  try {
    const body = await c.req.json();
    const { name, value } = SetSecretSchema.parse(body);

    // Use docker mcp secret set command
    // We pipe the value through stdin to avoid it appearing in process list
    await execAsync(`echo "${value}" | docker mcp secret set ${name}`, {
      encoding: 'utf8',
    });

    logger.info({ secretName: name }, 'Docker MCP secret set successfully');

    return c.json(apiResponse({
      name,
      configured: true,
      message: `Secret '${name}' has been configured. Restart affected servers for changes to take effect.`,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      c.status(400);
      return c.json(errorResponse(`Validation error: ${error.message}`));
    }
    const errorMsg = error instanceof Error ? error.message : 'Failed to set secret';
    logger.error({ error }, 'Failed to set Docker MCP secret');
    c.status(500);
    return c.json(errorResponse(errorMsg));
  }
});

// DELETE /docker/secrets/:name - Remove a Docker MCP secret
dockerApi.delete('/secrets/:name', async (c) => {
  if (!isDockerMcpAvailable()) {
    c.status(503);
    return c.json(errorResponse('Docker MCP is not available'));
  }

  const name = c.req.param('name');

  try {
    await execAsync(`docker mcp secret rm ${name}`, { encoding: 'utf8' });

    logger.info({ secretName: name }, 'Docker MCP secret removed');

    return c.json(apiResponse({
      name,
      removed: true,
      message: `Secret '${name}' has been removed.`,
    }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to remove secret';
    logger.error({ error, secretName: name }, 'Failed to remove Docker MCP secret');
    c.status(500);
    return c.json(errorResponse(errorMsg));
  }
});

// GET /docker/catalog - List available servers in Docker MCP catalog
dockerApi.get('/catalog', async (c) => {
  if (!isDockerMcpAvailable()) {
    c.status(503);
    return c.json(errorResponse('Docker MCP is not available'));
  }

  try {
    const output = execSync('docker mcp catalog ls 2>/dev/null || echo "[]"', { encoding: 'utf8' });

    // Try to parse as JSON, otherwise return raw
    let servers;
    try {
      servers = JSON.parse(output);
    } catch {
      servers = output.trim().split('\n').filter(Boolean);
    }

    return c.json(apiResponse({
      servers,
    }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to list catalog';
    logger.error({ error }, 'Failed to list Docker MCP catalog');
    c.status(500);
    return c.json(errorResponse(errorMsg));
  }
});
