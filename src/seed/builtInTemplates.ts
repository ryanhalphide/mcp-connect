import { templateStore } from '../storage/templates.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'built-in-templates' });

/**
 * Register all built-in server templates
 */
export function registerBuiltInTemplates(): void {
  // Filesystem MCP Server
  templateStore.addBuiltInTemplate('builtin-filesystem', {
    name: 'Filesystem',
    description: 'Provides file system access with read, write, list, and search operations',
    icon: 'folder',
    category: 'storage',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
    envPlaceholders: [
      {
        key: 'ALLOWED_DIR',
        description: 'Directory path to allow filesystem access',
        required: true,
        default: '/tmp',
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    npmPackage: '@modelcontextprotocol/server-filesystem',
  });

  // Memory MCP Server
  templateStore.addBuiltInTemplate('builtin-memory', {
    name: 'Memory',
    description: 'In-memory key-value store for temporary data storage',
    icon: 'database',
    category: 'storage',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    npmPackage: '@modelcontextprotocol/server-memory',
  });

  // GitHub MCP Server
  templateStore.addBuiltInTemplate('builtin-github', {
    name: 'GitHub',
    description: 'GitHub integration for repository management, issues, and pull requests',
    icon: 'github',
    category: 'development',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envPlaceholders: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        description: 'GitHub Personal Access Token with appropriate permissions',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    npmPackage: '@modelcontextprotocol/server-github',
  });

  // PostgreSQL MCP Server
  templateStore.addBuiltInTemplate('builtin-postgres', {
    name: 'PostgreSQL',
    description: 'PostgreSQL database integration for querying and schema inspection',
    icon: 'database',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envPlaceholders: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        description: 'PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/db)',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    npmPackage: '@modelcontextprotocol/server-postgres',
  });

  // Slack MCP Server
  templateStore.addBuiltInTemplate('builtin-slack', {
    name: 'Slack',
    description: 'Slack workspace integration for messaging and channel management',
    icon: 'message-square',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envPlaceholders: [
      {
        key: 'SLACK_BOT_TOKEN',
        description: 'Slack Bot OAuth Token (xoxb-...)',
        required: true,
      },
      {
        key: 'SLACK_TEAM_ID',
        description: 'Slack Team/Workspace ID',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    npmPackage: '@modelcontextprotocol/server-slack',
  });

  // Google Drive MCP Server
  templateStore.addBuiltInTemplate('builtin-gdrive', {
    name: 'Google Drive',
    description: 'Google Drive integration for file access and management',
    icon: 'cloud',
    category: 'storage',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    envPlaceholders: [
      {
        key: 'GOOGLE_DRIVE_CREDENTIALS',
        description: 'Path to Google OAuth credentials JSON file',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
    npmPackage: '@modelcontextprotocol/server-gdrive',
  });

  // Brave Search MCP Server
  templateStore.addBuiltInTemplate('builtin-brave-search', {
    name: 'Brave Search',
    description: 'Web and local search using Brave Search API',
    icon: 'search',
    category: 'search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envPlaceholders: [
      {
        key: 'BRAVE_API_KEY',
        description: 'Brave Search API key',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    npmPackage: '@modelcontextprotocol/server-brave-search',
  });

  // Fetch MCP Server
  templateStore.addBuiltInTemplate('builtin-fetch', {
    name: 'Fetch',
    description: 'HTTP client for fetching and transforming web content',
    icon: 'globe',
    category: 'web',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    npmPackage: '@modelcontextprotocol/server-fetch',
  });

  // Puppeteer MCP Server
  templateStore.addBuiltInTemplate('builtin-puppeteer', {
    name: 'Puppeteer',
    description: 'Browser automation using Puppeteer for web scraping and testing',
    icon: 'monitor',
    category: 'automation',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    npmPackage: '@modelcontextprotocol/server-puppeteer',
  });

  // Everart MCP Server
  templateStore.addBuiltInTemplate('builtin-everart', {
    name: 'EverArt',
    description: 'AI image generation and editing capabilities',
    icon: 'image',
    category: 'ai',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everart'],
    envPlaceholders: [
      {
        key: 'EVERART_API_KEY',
        description: 'EverArt API key',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everart',
    npmPackage: '@modelcontextprotocol/server-everart',
  });

  // Sequential Thinking MCP Server
  templateStore.addBuiltInTemplate('builtin-sequentialthinking', {
    name: 'Sequential Thinking',
    description: 'Dynamic problem-solving through structured thought sequences',
    icon: 'brain',
    category: 'ai',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequentialthinking'],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    npmPackage: '@modelcontextprotocol/server-sequentialthinking',
  });

  // SQLite MCP Server
  templateStore.addBuiltInTemplate('builtin-sqlite', {
    name: 'SQLite',
    description: 'SQLite database integration for querying and management',
    icon: 'database',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '/path/to/database.db'],
    envPlaceholders: [
      {
        key: 'SQLITE_DB_PATH',
        description: 'Path to SQLite database file',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    npmPackage: '@modelcontextprotocol/server-sqlite',
  });

  const counts = templateStore.getCount();
  logger.info({ builtIn: counts.builtIn }, 'Built-in templates registered');
}
