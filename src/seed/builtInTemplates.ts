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

  // AWS S3 MCP Server (Community)
  templateStore.addBuiltInTemplate('builtin-s3', {
    name: 'AWS S3',
    description: 'Amazon S3 integration for object storage operations',
    icon: 'cloud',
    category: 'storage',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-s3'],
    envPlaceholders: [
      {
        key: 'AWS_ACCESS_KEY_ID',
        description: 'AWS Access Key ID',
        required: true,
      },
      {
        key: 'AWS_SECRET_ACCESS_KEY',
        description: 'AWS Secret Access Key',
        required: true,
      },
      {
        key: 'AWS_REGION',
        description: 'AWS Region (e.g., us-east-1)',
        required: true,
        default: 'us-east-1',
      },
      {
        key: 'S3_BUCKET',
        description: 'Default S3 bucket name',
        required: false,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-s3',
  });

  // Linear MCP Server
  templateStore.addBuiltInTemplate('builtin-linear', {
    name: 'Linear',
    description: 'Linear project management integration for issues and projects',
    icon: 'check-square',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-linear'],
    envPlaceholders: [
      {
        key: 'LINEAR_API_KEY',
        description: 'Linear API key (Personal API key from Settings)',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-linear',
  });

  // Jira MCP Server
  templateStore.addBuiltInTemplate('builtin-jira', {
    name: 'Jira',
    description: 'Atlassian Jira integration for issue tracking and project management',
    icon: 'check-square',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-jira'],
    envPlaceholders: [
      {
        key: 'JIRA_HOST',
        description: 'Jira instance URL (e.g., https://your-domain.atlassian.net)',
        required: true,
      },
      {
        key: 'JIRA_EMAIL',
        description: 'Jira account email',
        required: true,
      },
      {
        key: 'JIRA_API_TOKEN',
        description: 'Jira API token (from https://id.atlassian.com/manage-profile/security/api-tokens)',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-jira',
  });

  // Notion MCP Server
  templateStore.addBuiltInTemplate('builtin-notion', {
    name: 'Notion',
    description: 'Notion workspace integration for pages, databases, and content',
    icon: 'file-text',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-notion'],
    envPlaceholders: [
      {
        key: 'NOTION_API_KEY',
        description: 'Notion Integration API key',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-notion',
  });

  // Discord MCP Server
  templateStore.addBuiltInTemplate('builtin-discord', {
    name: 'Discord',
    description: 'Discord integration for server and channel management',
    icon: 'message-circle',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-discord'],
    envPlaceholders: [
      {
        key: 'DISCORD_BOT_TOKEN',
        description: 'Discord Bot Token',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-discord',
  });

  // Sentry MCP Server
  templateStore.addBuiltInTemplate('builtin-sentry', {
    name: 'Sentry',
    description: 'Sentry error tracking and performance monitoring',
    icon: 'alert-circle',
    category: 'monitoring',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    envPlaceholders: [
      {
        key: 'SENTRY_AUTH_TOKEN',
        description: 'Sentry Auth Token with project:read scope',
        required: true,
      },
      {
        key: 'SENTRY_ORG',
        description: 'Sentry organization slug',
        required: true,
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sentry',
    npmPackage: '@modelcontextprotocol/server-sentry',
  });

  // GitLab MCP Server
  templateStore.addBuiltInTemplate('builtin-gitlab', {
    name: 'GitLab',
    description: 'GitLab integration for repositories, merge requests, and pipelines',
    icon: 'git-branch',
    category: 'development',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    envPlaceholders: [
      {
        key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        description: 'GitLab Personal Access Token',
        required: true,
      },
      {
        key: 'GITLAB_URL',
        description: 'GitLab instance URL (defaults to gitlab.com)',
        required: false,
        default: 'https://gitlab.com',
      },
    ],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
    npmPackage: '@modelcontextprotocol/server-gitlab',
  });

  // Cloudflare MCP Server
  templateStore.addBuiltInTemplate('builtin-cloudflare', {
    name: 'Cloudflare',
    description: 'Cloudflare Workers, KV, and R2 management',
    icon: 'cloud',
    category: 'infrastructure',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@cloudflare/mcp-server-cloudflare'],
    envPlaceholders: [
      {
        key: 'CLOUDFLARE_API_TOKEN',
        description: 'Cloudflare API Token with appropriate permissions',
        required: true,
      },
      {
        key: 'CLOUDFLARE_ACCOUNT_ID',
        description: 'Cloudflare Account ID',
        required: true,
      },
    ],
    documentation: 'https://github.com/cloudflare/mcp-server-cloudflare',
    npmPackage: '@cloudflare/mcp-server-cloudflare',
  });

  // Time MCP Server
  templateStore.addBuiltInTemplate('builtin-time', {
    name: 'Time',
    description: 'Time and timezone utilities for scheduling and conversion',
    icon: 'clock',
    category: 'utility',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    npmPackage: '@modelcontextprotocol/server-time',
  });

  // Everything MCP Server (File Search)
  templateStore.addBuiltInTemplate('builtin-everything', {
    name: 'Everything Search',
    description: 'Fast file search using Everything SDK (Windows)',
    icon: 'search',
    category: 'search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    npmPackage: '@modelcontextprotocol/server-everything',
  });

  // MySQL MCP Server
  templateStore.addBuiltInTemplate('builtin-mysql', {
    name: 'MySQL',
    description: 'MySQL database integration for querying and management',
    icon: 'database',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-mysql'],
    envPlaceholders: [
      {
        key: 'MYSQL_HOST',
        description: 'MySQL server host',
        required: true,
        default: 'localhost',
      },
      {
        key: 'MYSQL_PORT',
        description: 'MySQL server port',
        required: false,
        default: '3306',
      },
      {
        key: 'MYSQL_USER',
        description: 'MySQL username',
        required: true,
      },
      {
        key: 'MYSQL_PASSWORD',
        description: 'MySQL password',
        required: true,
      },
      {
        key: 'MYSQL_DATABASE',
        description: 'MySQL database name',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-mysql',
  });

  // Redis MCP Server
  templateStore.addBuiltInTemplate('builtin-redis', {
    name: 'Redis',
    description: 'Redis key-value store integration',
    icon: 'database',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-redis'],
    envPlaceholders: [
      {
        key: 'REDIS_URL',
        description: 'Redis connection URL (e.g., redis://localhost:6379)',
        required: true,
        default: 'redis://localhost:6379',
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-redis',
  });

  // MongoDB MCP Server
  templateStore.addBuiltInTemplate('builtin-mongodb', {
    name: 'MongoDB',
    description: 'MongoDB database integration for document operations',
    icon: 'database',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-mongodb'],
    envPlaceholders: [
      {
        key: 'MONGODB_URI',
        description: 'MongoDB connection URI',
        required: true,
        default: 'mongodb://localhost:27017',
      },
      {
        key: 'MONGODB_DATABASE',
        description: 'Default database name',
        required: false,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-mongodb',
  });

  // Docker MCP Server
  templateStore.addBuiltInTemplate('builtin-docker', {
    name: 'Docker',
    description: 'Docker container and image management',
    icon: 'box',
    category: 'infrastructure',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-docker'],
    envPlaceholders: [
      {
        key: 'DOCKER_HOST',
        description: 'Docker daemon socket/host (optional)',
        required: false,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-docker',
  });

  // Kubernetes MCP Server
  templateStore.addBuiltInTemplate('builtin-kubernetes', {
    name: 'Kubernetes',
    description: 'Kubernetes cluster management and operations',
    icon: 'server',
    category: 'infrastructure',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-kubernetes'],
    envPlaceholders: [
      {
        key: 'KUBECONFIG',
        description: 'Path to kubeconfig file (optional, uses default if not set)',
        required: false,
      },
      {
        key: 'KUBERNETES_CONTEXT',
        description: 'Kubernetes context to use (optional)',
        required: false,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-kubernetes',
  });

  // Airtable MCP Server
  templateStore.addBuiltInTemplate('builtin-airtable', {
    name: 'Airtable',
    description: 'Airtable base and record management',
    icon: 'table',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-airtable'],
    envPlaceholders: [
      {
        key: 'AIRTABLE_API_KEY',
        description: 'Airtable Personal Access Token',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-airtable',
  });

  // Twilio MCP Server
  templateStore.addBuiltInTemplate('builtin-twilio', {
    name: 'Twilio',
    description: 'Twilio SMS and voice communication',
    icon: 'phone',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-twilio'],
    envPlaceholders: [
      {
        key: 'TWILIO_ACCOUNT_SID',
        description: 'Twilio Account SID',
        required: true,
      },
      {
        key: 'TWILIO_AUTH_TOKEN',
        description: 'Twilio Auth Token',
        required: true,
      },
      {
        key: 'TWILIO_PHONE_NUMBER',
        description: 'Twilio phone number for sending',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-twilio',
  });

  // SendGrid MCP Server
  templateStore.addBuiltInTemplate('builtin-sendgrid', {
    name: 'SendGrid',
    description: 'SendGrid email sending and management',
    icon: 'mail',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-sendgrid'],
    envPlaceholders: [
      {
        key: 'SENDGRID_API_KEY',
        description: 'SendGrid API key',
        required: true,
      },
      {
        key: 'SENDGRID_FROM_EMAIL',
        description: 'Verified sender email address',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-sendgrid',
  });

  // Stripe MCP Server
  templateStore.addBuiltInTemplate('builtin-stripe', {
    name: 'Stripe',
    description: 'Stripe payments and subscription management',
    icon: 'credit-card',
    category: 'finance',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-stripe'],
    envPlaceholders: [
      {
        key: 'STRIPE_SECRET_KEY',
        description: 'Stripe Secret API Key',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-stripe',
  });

  // OpenAI MCP Server
  templateStore.addBuiltInTemplate('builtin-openai', {
    name: 'OpenAI',
    description: 'OpenAI API integration for GPT and embeddings',
    icon: 'brain',
    category: 'ai',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-openai'],
    envPlaceholders: [
      {
        key: 'OPENAI_API_KEY',
        description: 'OpenAI API Key',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-openai',
  });

  // Raygun MCP Server (Error Tracking)
  templateStore.addBuiltInTemplate('builtin-raygun', {
    name: 'Raygun',
    description: 'Raygun error and performance monitoring',
    icon: 'alert-triangle',
    category: 'monitoring',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-raygun'],
    envPlaceholders: [
      {
        key: 'RAYGUN_API_KEY',
        description: 'Raygun API Key',
        required: true,
      },
    ],
    documentation: 'https://github.com/anthropics/mcp-servers',
    npmPackage: '@anthropic/mcp-server-raygun',
  });

  const counts = templateStore.getCount();
  logger.info({ builtIn: counts.builtIn }, 'Built-in templates registered');
}
