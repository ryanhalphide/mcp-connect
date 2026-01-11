import { serverDatabase } from '../storage/db.js';
import { WorkflowTemplateStore } from '../workflows/workflowTemplateStore.js';
import type { WorkflowTemplate } from '../workflows/workflowTemplateStore.js';
import { createChildLogger } from '../observability/logger.js';

const logger = createChildLogger({ module: 'built-in-templates' });

/**
 * Built-in workflow templates that ship with mcp-connect
 */
const builtInTemplates: Array<
  Omit<WorkflowTemplate, 'createdAt' | 'updatedAt' | 'isBuiltIn' | 'usageCount'>
> = [
  // 1. GitHub Repository Analysis
  {
    id: 'github-repo-analysis',
    name: 'GitHub Repository Analysis',
    description:
      'Analyze a GitHub repository by fetching its README, analyzing code structure with sampling, and generating a comprehensive report.',
    category: 'analysis',
    tags: ['github', 'analysis', 'code-review', 'documentation'],
    difficulty: 'intermediate',
    estimatedCostCredits: 0.05,
    estimatedDurationMs: 30000,
    definition: {
      name: '{{input.repo_name}} Analysis',
      description: 'Analyze GitHub repository structure and documentation',
      steps: [
        {
          name: 'fetch_readme',
          type: 'tool',
          config: {
            server: 'github',
            tool: 'get_file_contents',
            params: {
              owner: '{{input.owner}}',
              repo: '{{input.repo}}',
              path: 'README.md',
            },
          },
          onError: 'continue',
        },
        {
          name: 'analyze_structure',
          type: 'tool',
          config: {
            server: 'github',
            tool: 'list_directory',
            params: {
              owner: '{{input.owner}}',
              repo: '{{input.repo}}',
              path: '/',
            },
          },
        },
        {
          name: 'sample_codebase',
          type: 'prompt',
          config: {
            prompt: 'analyze_codebase',
            arguments: {
              readme: '{{steps.fetch_readme.output}}',
              structure: '{{steps.analyze_structure.output}}',
              repo_name: '{{input.repo}}',
            },
          },
        },
      ],
      timeout: 60000,
    },
    parameterSchema: [
      {
        name: 'owner',
        type: 'string',
        description: 'GitHub repository owner',
        required: true,
      },
      {
        name: 'repo',
        type: 'string',
        description: 'GitHub repository name',
        required: true,
      },
      {
        name: 'repo_name',
        type: 'string',
        description: 'Display name for the repository',
        required: false,
        default: 'Repository',
      },
    ],
  },

  // 2. Multi-Repo Health Check
  {
    id: 'multi-repo-health-check',
    name: 'Multi-Repository Health Check',
    description:
      'Run parallel health checks across multiple repositories to verify CI status, open issues, and recent activity.',
    category: 'monitoring',
    tags: ['github', 'monitoring', 'health-check', 'ci-cd'],
    difficulty: 'advanced',
    estimatedCostCredits: 0.03,
    estimatedDurationMs: 15000,
    definition: {
      name: 'Multi-Repo Health Check',
      description: 'Check health status of multiple repositories in parallel',
      steps: [
        {
          name: 'parallel_checks',
          type: 'parallel',
          config: {
            steps: [
              {
                name: 'check_repo_1',
                type: 'tool',
                config: {
                  server: 'github',
                  tool: 'get_repository',
                  params: {
                    owner: '{{input.repos[0].owner}}',
                    repo: '{{input.repos[0].name}}',
                  },
                },
              },
              {
                name: 'check_repo_2',
                type: 'tool',
                config: {
                  server: 'github',
                  tool: 'get_repository',
                  params: {
                    owner: '{{input.repos[1].owner}}',
                    repo: '{{input.repos[1].name}}',
                  },
                },
              },
            ],
          },
        },
        {
          name: 'aggregate_results',
          type: 'prompt',
          config: {
            prompt: 'summarize_health',
            arguments: {
              results: '{{steps.parallel_checks.output}}',
            },
          },
        },
      ],
      timeout: 30000,
    },
    parameterSchema: [
      {
        name: 'repos',
        type: 'array',
        description: 'Array of repositories to check (each with owner and name)',
        required: true,
      },
    ],
  },

  // 3. Slack Notification Pipeline
  {
    id: 'slack-notification-pipeline',
    name: 'Slack Notification Pipeline',
    description:
      'Fetch data from an API, transform it, and send formatted notifications to Slack channels.',
    category: 'notification',
    tags: ['slack', 'notification', 'integration', 'automation'],
    difficulty: 'beginner',
    estimatedCostCredits: 0.01,
    estimatedDurationMs: 5000,
    definition: {
      name: 'Slack Notification: {{input.title}}',
      description: 'Send notification to Slack',
      steps: [
        {
          name: 'fetch_data',
          type: 'tool',
          config: {
            server: '{{input.data_server}}',
            tool: '{{input.data_tool}}',
            params: {
              _dynamic: '{{input.data_params}}',
            },
          },
        },
        {
          name: 'format_message',
          type: 'prompt',
          config: {
            prompt: 'format_slack_message',
            arguments: {
              data: '{{steps.fetch_data.output}}',
              title: '{{input.title}}',
              format: '{{input.format}}',
            },
          },
        },
        {
          name: 'send_notification',
          type: 'tool',
          config: {
            server: 'slack',
            tool: 'post_message',
            params: {
              channel: '{{input.channel}}',
              text: '{{steps.format_message.output}}',
            },
          },
        },
      ],
      timeout: 10000,
    },
    parameterSchema: [
      {
        name: 'title',
        type: 'string',
        description: 'Notification title',
        required: true,
      },
      {
        name: 'channel',
        type: 'string',
        description: 'Slack channel to post to',
        required: true,
      },
      {
        name: 'data_server',
        type: 'string',
        description: 'MCP server to fetch data from',
        required: true,
      },
      {
        name: 'data_tool',
        type: 'string',
        description: 'Tool to use for fetching data',
        required: true,
      },
      {
        name: 'data_params',
        type: 'object',
        description: 'Parameters for the data fetching tool',
        required: true,
      },
      {
        name: 'format',
        type: 'string',
        description: 'Message format style',
        required: false,
        default: 'detailed',
      },
    ],
  },

  // 4. Data Pipeline
  {
    id: 'data-pipeline',
    name: 'Data ETL Pipeline',
    description:
      'Extract data from an API source, transform it using custom logic, and load it into a destination.',
    category: 'data-pipeline',
    tags: ['etl', 'data-processing', 'transformation', 'integration'],
    difficulty: 'intermediate',
    estimatedCostCredits: 0.04,
    estimatedDurationMs: 20000,
    definition: {
      name: 'Data Pipeline: {{input.pipeline_name}}',
      description: 'ETL pipeline for data processing',
      steps: [
        {
          name: 'extract',
          type: 'tool',
          config: {
            server: '{{input.source_server}}',
            tool: '{{input.source_tool}}',
            params: {
              _dynamic: '{{input.source_params}}',
            },
          },
          retryConfig: {
            maxAttempts: 3,
            backoffMs: 1000,
          },
        },
        {
          name: 'transform',
          type: 'prompt',
          config: {
            prompt: '{{input.transform_prompt}}',
            arguments: {
              data: '{{steps.extract.output}}',
              rules: '{{input.transform_rules}}',
            },
          },
        },
        {
          name: 'validate',
          type: 'condition',
          config: {
            condition: {
              type: 'exists',
              path: 'steps.transform.output.data',
            },
            then: [
              {
                name: 'load',
                type: 'tool',
                config: {
                  server: '{{input.destination_server}}',
                  tool: '{{input.destination_tool}}',
                  params: {
                    data: '{{steps.transform.output.data}}',
                  },
                },
              },
            ],
            else: [
              {
                name: 'log_error',
                type: 'prompt',
                config: {
                  prompt: 'log_validation_error',
                  arguments: {
                    error: 'Transformation produced no data',
                  },
                },
              },
            ],
          },
        },
      ],
      errorHandling: {
        strategy: 'rollback',
      },
      timeout: 60000,
    },
    parameterSchema: [
      {
        name: 'pipeline_name',
        type: 'string',
        description: 'Name of the data pipeline',
        required: true,
      },
      {
        name: 'source_server',
        type: 'string',
        description: 'Source MCP server',
        required: true,
      },
      {
        name: 'source_tool',
        type: 'string',
        description: 'Tool to extract data',
        required: true,
      },
      {
        name: 'source_params',
        type: 'object',
        description: 'Parameters for source tool',
        required: true,
      },
      {
        name: 'transform_prompt',
        type: 'string',
        description: 'Prompt for data transformation',
        required: true,
      },
      {
        name: 'transform_rules',
        type: 'object',
        description: 'Transformation rules',
        required: true,
      },
      {
        name: 'destination_server',
        type: 'string',
        description: 'Destination MCP server',
        required: true,
      },
      {
        name: 'destination_tool',
        type: 'string',
        description: 'Tool to load data',
        required: true,
      },
    ],
  },

  // 5. Content Moderation
  {
    id: 'content-moderation',
    name: 'Content Moderation Workflow',
    description:
      'Fetch user-generated content, analyze it for policy violations, and automatically flag or approve content.',
    category: 'automation',
    tags: ['moderation', 'content', 'ai-analysis', 'compliance'],
    difficulty: 'intermediate',
    estimatedCostCredits: 0.03,
    estimatedDurationMs: 10000,
    definition: {
      name: 'Content Moderation',
      description: 'Analyze and moderate user content',
      steps: [
        {
          name: 'fetch_content',
          type: 'tool',
          config: {
            server: '{{input.content_server}}',
            tool: '{{input.fetch_tool}}',
            params: {
              id: '{{input.content_id}}',
            },
          },
        },
        {
          name: 'analyze_content',
          type: 'prompt',
          config: {
            prompt: 'moderate_content',
            arguments: {
              content: '{{steps.fetch_content.output}}',
              policies: '{{input.policies}}',
            },
          },
        },
        {
          name: 'decision',
          type: 'condition',
          config: {
            condition: {
              type: 'equals',
              path: 'steps.analyze_content.output.status',
              value: 'approved',
            },
            then: [
              {
                name: 'approve_content',
                type: 'tool',
                config: {
                  server: '{{input.content_server}}',
                  tool: 'approve_content',
                  params: {
                    id: '{{input.content_id}}',
                  },
                },
              },
            ],
            else: [
              {
                name: 'flag_content',
                type: 'tool',
                config: {
                  server: '{{input.content_server}}',
                  tool: 'flag_content',
                  params: {
                    id: '{{input.content_id}}',
                    reason: '{{steps.analyze_content.output.reason}}',
                  },
                },
              },
            ],
          },
        },
      ],
      timeout: 30000,
    },
    parameterSchema: [
      {
        name: 'content_id',
        type: 'string',
        description: 'ID of content to moderate',
        required: true,
      },
      {
        name: 'content_server',
        type: 'string',
        description: 'MCP server hosting the content',
        required: true,
      },
      {
        name: 'fetch_tool',
        type: 'string',
        description: 'Tool to fetch content',
        required: true,
      },
      {
        name: 'policies',
        type: 'object',
        description: 'Content moderation policies',
        required: true,
      },
    ],
  },

  // 6. API Monitoring
  {
    id: 'api-monitoring',
    name: 'API Health Monitoring',
    description:
      'Continuously monitor API endpoints, log response times, and alert on failures or degraded performance.',
    category: 'monitoring',
    tags: ['monitoring', 'api', 'health-check', 'alerting'],
    difficulty: 'beginner',
    estimatedCostCredits: 0.01,
    estimatedDurationMs: 5000,
    definition: {
      name: 'API Monitor: {{input.api_name}}',
      description: 'Monitor API endpoint health',
      steps: [
        {
          name: 'health_check',
          type: 'tool',
          config: {
            server: '{{input.server}}',
            tool: '{{input.health_tool}}',
            params: {
              _dynamic: '{{input.health_params}}',
            },
          },
          retryConfig: {
            maxAttempts: 3,
            backoffMs: 2000,
          },
        },
        {
          name: 'log_result',
          type: 'tool',
          config: {
            server: 'logging',
            tool: 'log_metric',
            params: {
              name: '{{input.api_name}}_health',
              status: '{{steps.health_check.output.status}}',
              response_time: '{{steps.health_check.output.response_time}}',
            },
          },
        },
        {
          name: 'check_failure',
          type: 'condition',
          config: {
            condition: {
              type: 'notEquals',
              path: 'steps.health_check.output.status',
              value: 'healthy',
            },
            then: [
              {
                name: 'send_alert',
                type: 'tool',
                config: {
                  server: '{{input.alert_server}}',
                  tool: 'send_alert',
                  params: {
                    severity: 'high',
                    message: 'API {{input.api_name}} is unhealthy',
                    details: '{{steps.health_check.output}}',
                  },
                },
              },
            ],
          },
        },
      ],
      timeout: 15000,
    },
    parameterSchema: [
      {
        name: 'api_name',
        type: 'string',
        description: 'Name of the API being monitored',
        required: true,
      },
      {
        name: 'server',
        type: 'string',
        description: 'MCP server to perform health check',
        required: true,
      },
      {
        name: 'health_tool',
        type: 'string',
        description: 'Tool to check API health',
        required: true,
      },
      {
        name: 'health_params',
        type: 'object',
        description: 'Parameters for health check',
        required: true,
      },
      {
        name: 'alert_server',
        type: 'string',
        description: 'Server to send alerts to',
        required: true,
      },
    ],
  },

  // 7. Document Processing
  {
    id: 'document-processing',
    name: 'Document Processing Pipeline',
    description:
      'Fetch documents from various sources, extract text content, and generate AI-powered summaries.',
    category: 'data-pipeline',
    tags: ['documents', 'ai', 'summarization', 'text-extraction'],
    difficulty: 'intermediate',
    estimatedCostCredits: 0.06,
    estimatedDurationMs: 25000,
    definition: {
      name: 'Process Document: {{input.document_name}}',
      description: 'Extract and summarize document content',
      steps: [
        {
          name: 'fetch_document',
          type: 'resource',
          config: {
            server: '{{input.source_server}}',
            uri: '{{input.document_uri}}',
          },
        },
        {
          name: 'extract_text',
          type: 'prompt',
          config: {
            prompt: 'extract_document_text',
            arguments: {
              document: '{{steps.fetch_document.output}}',
              format: '{{input.document_format}}',
            },
          },
        },
        {
          name: 'summarize',
          type: 'prompt',
          config: {
            prompt: 'summarize_text',
            arguments: {
              text: '{{steps.extract_text.output}}',
              max_length: '{{input.summary_length}}',
              style: '{{input.summary_style}}',
            },
          },
        },
        {
          name: 'store_summary',
          type: 'tool',
          config: {
            server: '{{input.storage_server}}',
            tool: 'store_document',
            params: {
              id: '{{input.document_id}}',
              summary: '{{steps.summarize.output}}',
              original_text: '{{steps.extract_text.output}}',
            },
          },
        },
      ],
      timeout: 60000,
    },
    parameterSchema: [
      {
        name: 'document_name',
        type: 'string',
        description: 'Display name for the document',
        required: true,
      },
      {
        name: 'document_id',
        type: 'string',
        description: 'Unique document identifier',
        required: true,
      },
      {
        name: 'source_server',
        type: 'string',
        description: 'MCP server hosting the document',
        required: true,
      },
      {
        name: 'document_uri',
        type: 'string',
        description: 'URI of the document resource',
        required: true,
      },
      {
        name: 'document_format',
        type: 'string',
        description: 'Format of the document (pdf, docx, etc)',
        required: true,
      },
      {
        name: 'summary_length',
        type: 'number',
        description: 'Maximum length of summary in words',
        required: false,
        default: 200,
      },
      {
        name: 'summary_style',
        type: 'string',
        description: 'Style of summary (brief, detailed, technical)',
        required: false,
        default: 'brief',
      },
      {
        name: 'storage_server',
        type: 'string',
        description: 'Server to store processed results',
        required: true,
      },
    ],
  },

  // 8. Social Media Aggregator
  {
    id: 'social-media-aggregator',
    name: 'Social Media Aggregator',
    description:
      'Fetch posts from multiple social media platforms, aggregate and deduplicate content, then publish a digest.',
    category: 'automation',
    tags: ['social-media', 'aggregation', 'content', 'publishing'],
    difficulty: 'advanced',
    estimatedCostCredits: 0.05,
    estimatedDurationMs: 30000,
    definition: {
      name: 'Social Media Digest',
      description: 'Aggregate content from social platforms',
      steps: [
        {
          name: 'fetch_platforms',
          type: 'parallel',
          config: {
            steps: [
              {
                name: 'fetch_twitter',
                type: 'tool',
                config: {
                  server: 'twitter',
                  tool: 'get_timeline',
                  params: {
                    count: '{{input.count_per_platform}}',
                  },
                },
              },
              {
                name: 'fetch_linkedin',
                type: 'tool',
                config: {
                  server: 'linkedin',
                  tool: 'get_feed',
                  params: {
                    count: '{{input.count_per_platform}}',
                  },
                },
              },
            ],
          },
        },
        {
          name: 'aggregate',
          type: 'prompt',
          config: {
            prompt: 'aggregate_social_posts',
            arguments: {
              twitter: '{{steps.fetch_platforms.output.fetch_twitter}}',
              linkedin: '{{steps.fetch_platforms.output.fetch_linkedin}}',
              deduplicate: 'true',
            },
          },
        },
        {
          name: 'create_digest',
          type: 'prompt',
          config: {
            prompt: 'create_social_digest',
            arguments: {
              posts: '{{steps.aggregate.output}}',
              title: '{{input.digest_title}}',
            },
          },
        },
        {
          name: 'publish',
          type: 'tool',
          config: {
            server: '{{input.publish_server}}',
            tool: '{{input.publish_tool}}',
            params: {
              content: '{{steps.create_digest.output}}',
              destination: '{{input.publish_destination}}',
            },
          },
        },
      ],
      timeout: 60000,
    },
    parameterSchema: [
      {
        name: 'digest_title',
        type: 'string',
        description: 'Title for the social media digest',
        required: true,
      },
      {
        name: 'count_per_platform',
        type: 'number',
        description: 'Number of posts to fetch per platform',
        required: false,
        default: 10,
      },
      {
        name: 'publish_server',
        type: 'string',
        description: 'Server to publish digest to',
        required: true,
      },
      {
        name: 'publish_tool',
        type: 'string',
        description: 'Tool to use for publishing',
        required: true,
      },
      {
        name: 'publish_destination',
        type: 'string',
        description: 'Where to publish the digest',
        required: true,
      },
    ],
  },

  // 9. Error Triage
  {
    id: 'error-triage',
    name: 'Error Triage and Assignment',
    description:
      'Fetch errors from monitoring systems, classify by severity, assign to appropriate teams, and send notifications.',
    category: 'automation',
    tags: ['error-tracking', 'incident-management', 'automation', 'devops'],
    difficulty: 'advanced',
    estimatedCostCredits: 0.04,
    estimatedDurationMs: 20000,
    definition: {
      name: 'Error Triage',
      description: 'Classify and assign errors from monitoring',
      steps: [
        {
          name: 'fetch_errors',
          type: 'tool',
          config: {
            server: 'sentry',
            tool: 'get_recent_errors',
            params: {
              project: '{{input.project}}',
              limit: '{{input.limit}}',
              since: '{{input.time_range}}',
            },
          },
        },
        {
          name: 'classify_errors',
          type: 'prompt',
          config: {
            prompt: 'classify_errors',
            arguments: {
              errors: '{{steps.fetch_errors.output}}',
              classification_rules: '{{input.rules}}',
            },
          },
        },
        {
          name: 'assign_to_teams',
          type: 'parallel',
          config: {
            steps: [
              {
                name: 'assign_critical',
                type: 'tool',
                config: {
                  server: 'jira',
                  tool: 'create_ticket',
                  params: {
                    priority: 'critical',
                    team: '{{input.critical_team}}',
                    errors: '{{steps.classify_errors.output.critical}}',
                  },
                },
              },
              {
                name: 'assign_high',
                type: 'tool',
                config: {
                  server: 'jira',
                  tool: 'create_ticket',
                  params: {
                    priority: 'high',
                    team: '{{input.high_team}}',
                    errors: '{{steps.classify_errors.output.high}}',
                  },
                },
              },
            ],
          },
        },
        {
          name: 'notify_teams',
          type: 'tool',
          config: {
            server: 'slack',
            tool: 'post_message',
            params: {
              channel: '{{input.notification_channel}}',
              text: 'New errors triaged and assigned. Critical: {{steps.classify_errors.output.critical_count}}, High: {{steps.classify_errors.output.high_count}}',
            },
          },
        },
      ],
      timeout: 45000,
    },
    parameterSchema: [
      {
        name: 'project',
        type: 'string',
        description: 'Project to fetch errors from',
        required: true,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of errors to process',
        required: false,
        default: 50,
      },
      {
        name: 'time_range',
        type: 'string',
        description: 'Time range for errors (e.g., 1h, 24h)',
        required: false,
        default: '1h',
      },
      {
        name: 'rules',
        type: 'object',
        description: 'Classification rules for errors',
        required: true,
      },
      {
        name: 'critical_team',
        type: 'string',
        description: 'Team to assign critical errors',
        required: true,
      },
      {
        name: 'high_team',
        type: 'string',
        description: 'Team to assign high priority errors',
        required: true,
      },
      {
        name: 'notification_channel',
        type: 'string',
        description: 'Slack channel for notifications',
        required: true,
      },
    ],
  },

  // 10. Backup Orchestration
  {
    id: 'backup-orchestration',
    name: 'Backup Orchestration',
    description:
      'Orchestrate database backups across multiple systems, verify integrity, upload to storage, and send completion notifications.',
    category: 'automation',
    tags: ['backup', 'database', 'storage', 'disaster-recovery'],
    difficulty: 'advanced',
    estimatedCostCredits: 0.02,
    estimatedDurationMs: 120000,
    definition: {
      name: 'Backup: {{input.backup_name}}',
      description: 'Orchestrate multi-database backup',
      steps: [
        {
          name: 'create_backups',
          type: 'parallel',
          config: {
            steps: [
              {
                name: 'backup_primary',
                type: 'tool',
                config: {
                  server: 'database',
                  tool: 'create_backup',
                  params: {
                    database: '{{input.primary_db}}',
                    format: 'compressed',
                  },
                },
                retryConfig: {
                  maxAttempts: 2,
                  backoffMs: 5000,
                },
              },
              {
                name: 'backup_secondary',
                type: 'tool',
                config: {
                  server: 'database',
                  tool: 'create_backup',
                  params: {
                    database: '{{input.secondary_db}}',
                    format: 'compressed',
                  },
                },
                retryConfig: {
                  maxAttempts: 2,
                  backoffMs: 5000,
                },
              },
            ],
          },
        },
        {
          name: 'verify_backups',
          type: 'parallel',
          config: {
            steps: [
              {
                name: 'verify_primary',
                type: 'tool',
                config: {
                  server: 'database',
                  tool: 'verify_backup',
                  params: {
                    backup_id: '{{steps.create_backups.output.backup_primary.id}}',
                  },
                },
              },
              {
                name: 'verify_secondary',
                type: 'tool',
                config: {
                  server: 'database',
                  tool: 'verify_backup',
                  params: {
                    backup_id: '{{steps.create_backups.output.backup_secondary.id}}',
                  },
                },
              },
            ],
          },
        },
        {
          name: 'upload_to_storage',
          type: 'tool',
          config: {
            server: '{{input.storage_server}}',
            tool: 'upload_files',
            params: {
              files: [
                '{{steps.create_backups.output.backup_primary.path}}',
                '{{steps.create_backups.output.backup_secondary.path}}',
              ],
              destination: '{{input.storage_path}}',
            },
          },
        },
        {
          name: 'notify_completion',
          type: 'tool',
          config: {
            server: '{{input.notification_server}}',
            tool: 'send_notification',
            params: {
              to: '{{input.notification_recipients}}',
              subject: 'Backup completed: {{input.backup_name}}',
              message:
                'Backups verified and uploaded successfully. Primary: {{steps.verify_primary.output.size}}, Secondary: {{steps.verify_secondary.output.size}}',
            },
          },
        },
      ],
      errorHandling: {
        strategy: 'continue',
      },
      timeout: 300000,
    },
    parameterSchema: [
      {
        name: 'backup_name',
        type: 'string',
        description: 'Name for this backup job',
        required: true,
      },
      {
        name: 'primary_db',
        type: 'string',
        description: 'Primary database to backup',
        required: true,
      },
      {
        name: 'secondary_db',
        type: 'string',
        description: 'Secondary database to backup',
        required: true,
      },
      {
        name: 'storage_server',
        type: 'string',
        description: 'Storage server for backups',
        required: true,
      },
      {
        name: 'storage_path',
        type: 'string',
        description: 'Path in storage for backups',
        required: true,
      },
      {
        name: 'notification_server',
        type: 'string',
        description: 'Server to send completion notification',
        required: true,
      },
      {
        name: 'notification_recipients',
        type: 'array',
        description: 'Recipients for completion notification',
        required: true,
      },
    ],
  },
];

/**
 * Register all built-in workflow templates
 */
export function registerBuiltInWorkflowTemplates(): void {
  const db = serverDatabase.getDatabase();
  const store = new WorkflowTemplateStore(db);

  let registered = 0;
  let skipped = 0;

  for (const template of builtInTemplates) {
    try {
      const existing = store.getTemplate(template.id);
      if (existing) {
        skipped++;
        continue;
      }

      store.addBuiltInTemplate(template.id, template);
      registered++;
    } catch (error) {
      logger.error(
        { templateId: template.id, error },
        'Failed to register built-in template'
      );
    }
  }

  logger.info(
    { registered, skipped, total: builtInTemplates.length },
    'Built-in workflow templates registered'
  );
}
