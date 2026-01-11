# MCP Connect API Documentation
## New Features: Sampling API, Workflow Templates, Budgets & KeyGuardian

**Version**: 0.1.1
**Base URL**: `https://mcp-connect-production.up.railway.app`
**Authentication**: Bearer token via `Authorization` header

---

## Table of Contents

1. [Sampling API (Track 1)](#sampling-api-track-1)
2. [Workflow Templates API (Track 3)](#workflow-templates-api-track-3)
3. [Budgets API (Track 4A)](#budgets-api-track-4a)
4. [KeyGuardian Security API (Track 4B)](#keyguardian-security-api-track-4b)
5. [Frontend Endpoints](#frontend-endpoints)
6. [Event Types (SSE)](#event-types-sse)
7. [Error Codes](#error-codes)

---

## Sampling API (Track 1)

### Overview

The Sampling API provides unified access to multiple LLM providers (OpenAI, Anthropic) with built-in cost tracking, security validation, and rate limiting.

**Features**:
- ✅ Multi-provider support (OpenAI GPT-4, Anthropic Claude 3)
- ✅ Automatic token counting and cost calculation
- ✅ Prompt injection detection
- ✅ Rate limiting (60 requests/min, 100K tokens/day)
- ✅ PII detection and content filtering

---

### POST /api/sampling/request

Execute an LLM completion request.

**Authentication**: Required (`sampling:execute` permission)

**Request Body**:
```json
{
  "model": "claude-3-sonnet" | "claude-3-opus" | "claude-3-haiku" | "gpt-4-turbo" | "gpt-3.5-turbo",
  "messages": [
    {
      "role": "system" | "user" | "assistant",
      "content": "string"
    }
  ],
  "maxTokens": 4000,      // Max: 4000
  "temperature": 0.7,      // 0-1
  "topP": 1.0,            // Optional
  "stop": ["string"]      // Optional
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "samp-abc123",
    "model": "claude-3-sonnet",
    "content": "LLM response text",
    "finishReason": "stop" | "length" | "content_filter",
    "usage": {
      "promptTokens": 150,
      "completionTokens": 450,
      "totalTokens": 600
    },
    "cost": {
      "inputCredits": 0.00015,
      "outputCredits": 0.00045,
      "totalCredits": 0.0006
    },
    "durationMs": 2340,
    "provider": "anthropic",
    "timestamp": "2026-01-11T21:00:00Z"
  },
  "timestamp": "2026-01-11T21:00:00Z"
}
```

**Error Responses**:
```json
// Rate limit exceeded
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "details": {
    "limit": 60,
    "window": "minute",
    "retryAfter": 45
  }
}

// Token limit exceeded
{
  "success": false,
  "error": "Token limit exceeded",
  "code": "TOKEN_LIMIT_EXCEEDED",
  "details": {
    "requested": 5000,
    "limit": 4000
  }
}

// Prompt injection detected
{
  "success": false,
  "error": "Potential prompt injection detected",
  "code": "SECURITY_VIOLATION",
  "details": {
    "patterns": ["ignore previous instructions", "system override"]
  }
}
```

**Example**:
```bash
curl -X POST "https://mcp-connect-production.up.railway.app/api/sampling/request" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant"},
      {"role": "user", "content": "Explain quantum computing in 3 sentences"}
    ],
    "maxTokens": 150,
    "temperature": 0.7
  }'
```

---

### GET /api/sampling/providers

List available LLM providers and their models.

**Authentication**: Required (`sampling:usage` permission)

**Response**:
```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "name": "openai",
        "available": true,
        "models": [
          {
            "name": "gpt-4-turbo",
            "displayName": "GPT-4 Turbo",
            "contextWindow": 128000,
            "maxOutputTokens": 4096,
            "pricing": {
              "input": 0.01,
              "output": 0.03,
              "unit": "1K tokens"
            }
          },
          {
            "name": "gpt-3.5-turbo",
            "displayName": "GPT-3.5 Turbo",
            "contextWindow": 16385,
            "maxOutputTokens": 4096,
            "pricing": {
              "input": 0.0005,
              "output": 0.0015,
              "unit": "1K tokens"
            }
          }
        ]
      },
      {
        "name": "anthropic",
        "available": true,
        "models": [
          {
            "name": "claude-3-opus",
            "displayName": "Claude 3 Opus",
            "contextWindow": 200000,
            "maxOutputTokens": 4096,
            "pricing": {
              "input": 0.015,
              "output": 0.075,
              "unit": "1K tokens"
            }
          },
          {
            "name": "claude-3-sonnet",
            "displayName": "Claude 3 Sonnet",
            "contextWindow": 200000,
            "maxOutputTokens": 4096,
            "pricing": {
              "input": 0.003,
              "output": 0.015,
              "unit": "1K tokens"
            }
          },
          {
            "name": "claude-3-haiku",
            "displayName": "Claude 3 Haiku",
            "contextWindow": 200000,
            "maxOutputTokens": 4096,
            "pricing": {
              "input": 0.00025,
              "output": 0.00125,
              "unit": "1K tokens"
            }
          }
        ]
      }
    ],
    "count": 2
  },
  "timestamp": "2026-01-11T21:00:00Z"
}
```

**Example**:
```bash
curl "https://mcp-connect-production.up.railway.app/api/sampling/providers" \
  -H "Authorization: Bearer $API_KEY"
```

---

### GET /api/sampling/usage

Get sampling usage statistics for the authenticated user.

**Authentication**: Required (`sampling:usage` permission)

**Query Parameters**:
- `period`: `today` | `week` | `month` (default: `today`)
- `groupBy`: `model` | `date` (default: `model`)

**Response**:
```json
{
  "success": true,
  "data": {
    "period": {
      "start": "2026-01-11T00:00:00Z",
      "end": "2026-01-11T23:59:59Z"
    },
    "usage": {
      "totalRequests": 145,
      "totalTokens": 87420,
      "totalCost": 1.24,
      "byModel": [
        {
          "model": "claude-3-sonnet",
          "requests": 95,
          "tokens": 62340,
          "cost": 0.87
        },
        {
          "model": "gpt-4-turbo",
          "requests": 50,
          "tokens": 25080,
          "cost": 0.37
        }
      ],
      "byDate": [
        {
          "date": "2026-01-11",
          "requests": 145,
          "tokens": 87420,
          "cost": 1.24
        }
      ]
    },
    "limits": {
      "requestsPerMinute": 60,
      "tokensPerDay": 100000,
      "currentTokensToday": 87420,
      "remainingTokensToday": 12580
    }
  },
  "timestamp": "2026-01-11T21:00:00Z"
}
```

---

## Workflow Templates API (Track 3)

### Overview

Workflow Templates provide pre-built, parameterized workflows that can be instantiated with custom values.

**Features**:
- ✅ 10 built-in templates across 5 categories
- ✅ Parameter validation with JSON Schema
- ✅ {{param}} interpolation syntax
- ✅ Cost estimation
- ✅ Difficulty ratings

---

### GET /api/workflow-templates

List all workflow templates with optional filtering.

**Authentication**: Required (`workflow_templates:read` permission)

**Query Parameters**:
- `category`: `automation` | `monitoring` | `data-pipeline` | `notification` | `analysis`
- `difficulty`: `beginner` | `intermediate` | `advanced`
- `tags`: Comma-separated list (e.g., `github,analysis`)
- `isBuiltIn`: `true` | `false`
- `search`: Search in name/description
- `limit`: 1-100 (default: 50)
- `offset`: Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "id": "tmpl-github-analysis",
        "name": "GitHub Repository Analysis",
        "description": "Analyze a GitHub repository using AI and generate insights",
        "category": "analysis",
        "tags": ["github", "ai", "analysis"],
        "difficulty": "intermediate",
        "estimatedCostCredits": 0.05,
        "estimatedDurationMs": 8000,
        "parameterSchema": {
          "owner": {
            "type": "string",
            "description": "Repository owner",
            "required": true,
            "validation": {
              "pattern": "^[a-zA-Z0-9-]+$"
            }
          },
          "repo": {
            "type": "string",
            "description": "Repository name",
            "required": true
          }
        },
        "isBuiltIn": true,
        "usageCount": 47,
        "createdAt": "2026-01-11T13:47:00Z",
        "updatedAt": "2026-01-11T13:47:00Z"
      }
    ],
    "total": 10,
    "limit": 50,
    "offset": 0
  },
  "timestamp": "2026-01-11T21:00:00Z"
}
```

**Example**:
```bash
# List all templates
curl "https://mcp-connect-production.up.railway.app/api/workflow-templates" \
  -H "Authorization: Bearer $API_KEY"

# Filter by category
curl "https://mcp-connect-production.up.railway.app/api/workflow-templates?category=analysis&difficulty=intermediate" \
  -H "Authorization: Bearer $API_KEY"
```

---

### GET /api/workflow-templates/:id

Get a specific workflow template with full definition.

**Authentication**: Required (`workflow_templates:read` permission)

**Response**:
```json
{
  "success": true,
  "data": {
    "template": {
      "id": "tmpl-github-analysis",
      "name": "GitHub Repository Analysis",
      "description": "Analyze a GitHub repository using AI",
      "category": "analysis",
      "tags": ["github", "ai"],
      "difficulty": "intermediate",
      "estimatedCostCredits": 0.05,
      "estimatedDurationMs": 8000,
      "definition": {
        "name": "GitHub Repository Analysis",
        "description": "...",
        "steps": [
          {
            "id": "fetch-repo",
            "type": "tool",
            "config": {
              "serverName": "github",
              "toolName": "get_repository",
              "params": {
                "owner": "{{owner}}",
                "repo": "{{repo}}"
              }
            }
          },
          {
            "id": "analyze",
            "type": "sampling",
            "config": {
              "model": "claude-3-sonnet",
              "messages": [...]
            }
          }
        ]
      },
      "parameterSchema": {...},
      "isBuiltIn": true,
      "usageCount": 47
    }
  }
}
```

---

### POST /api/workflow-templates/:id/instantiate

Instantiate a workflow from a template with parameter values.

**Authentication**: Required (`workflow_templates:execute` permission)

**Request Body**:
```json
{
  "parameters": {
    "owner": "facebook",
    "repo": "react"
  },
  "createWorkflow": true,           // Create persistent workflow
  "workflowName": "Analyze React",  // Optional custom name
  "executeImmediately": false       // Execute after creation
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "workflowId": "wf-abc123",
    "workflowName": "Analyze React",
    "definition": {
      // Workflow definition with parameters replaced
    },
    "executionId": "exec-xyz789",   // If executeImmediately: true
    "estimatedCost": 0.05
  },
  "timestamp": "2026-01-11T21:00:00Z"
}
```

**Example**:
```bash
curl -X POST "https://mcp-connect-production.up.railway.app/api/workflow-templates/tmpl-github-analysis/instantiate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "owner": "vercel",
      "repo": "next.js"
    },
    "createWorkflow": true,
    "workflowName": "Analyze Next.js",
    "executeImmediately": true
  }'
```

---

### POST /api/workflow-templates

Create a custom workflow template.

**Authentication**: Required (`workflow_templates:write` permission)

**Request Body**:
```json
{
  "name": "Custom Analysis Workflow",
  "description": "My custom workflow",
  "category": "analysis",
  "tags": ["custom", "analysis"],
  "difficulty": "intermediate",
  "estimatedCostCredits": 0.10,
  "estimatedDurationMs": 10000,
  "definition": {
    "name": "Custom Analysis",
    "steps": [...]
  },
  "parameterSchema": [
    {
      "name": "input",
      "type": "string",
      "description": "Input data",
      "required": true
    }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "template": {
      "id": "tmpl-custom-123",
      "name": "Custom Analysis Workflow",
      // ... full template
    }
  }
}
```

---

### GET /api/workflow-templates/categories

Get template categories with counts.

**Authentication**: Required (`workflow_templates:read` permission)

**Response**:
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "name": "analysis",
        "displayName": "Analysis",
        "count": 3
      },
      {
        "name": "automation",
        "displayName": "Automation",
        "count": 2
      },
      {
        "name": "data-pipeline",
        "displayName": "Data Pipeline",
        "count": 2
      },
      {
        "name": "monitoring",
        "displayName": "Monitoring",
        "count": 2
      },
      {
        "name": "notification",
        "displayName": "Notification",
        "count": 1
      }
    ],
    "total": 5
  }
}
```

---

## Budgets API (Track 4A)

### Overview

The Budgets API provides cost tracking and enforcement with configurable alerts and automatic workflow pausing.

**Features**:
- ✅ Multi-scope budgets (workflow, tenant, api_key, global)
- ✅ 4-tier alerts (50%, 75%, 90%, 100%)
- ✅ Automatic workflow pausing on budget exceeded
- ✅ Period-based budgets (daily, weekly, monthly, total)

---

### POST /api/budgets

Create a new cost budget.

**Authentication**: Required (`budgets:write` permission)

**Request Body**:
```json
{
  "name": "Production Monthly Budget",
  "scope": "global" | "workflow" | "tenant" | "api_key",
  "scopeId": "optional-id",       // Required for non-global scopes
  "budgetCredits": 100.00,
  "period": "daily" | "weekly" | "monthly" | "total",
  "enforceLimit": true,           // Pause workflows on exceed
  "enabled": true
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "budget": {
      "id": "bdg-abc123",
      "name": "Production Monthly Budget",
      "scope": "global",
      "scopeId": null,
      "budgetCredits": 100.00,
      "period": "monthly",
      "periodStart": "2026-01-11T21:00:00Z",
      "periodEnd": "2026-02-11T21:00:00Z",
      "currentSpend": 0.00,
      "enabled": true,
      "enforceLimit": true,
      "alerts": [
        {
          "thresholdPercent": 50,
          "triggered": false
        },
        {
          "thresholdPercent": 75,
          "triggered": false
        },
        {
          "thresholdPercent": 90,
          "triggered": false
        },
        {
          "thresholdPercent": 100,
          "triggered": false
        }
      ],
      "createdAt": "2026-01-11T21:00:00Z",
      "updatedAt": "2026-01-11T21:00:00Z"
    }
  }
}
```

**Example**:
```bash
curl -X POST "https://mcp-connect-production.up.railway.app/api/budgets" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monthly Budget",
    "scope": "global",
    "budgetCredits": 500,
    "period": "monthly",
    "enforceLimit": true
  }'
```

---

### GET /api/budgets

List all budgets with current status.

**Authentication**: Required (`budgets:read` permission)

**Query Parameters**:
- `scope`: Filter by scope
- `enabled`: `true` | `false`

**Response**:
```json
{
  "success": true,
  "data": {
    "budgets": [
      {
        "id": "bdg-abc123",
        "name": "Production Monthly",
        "scope": "global",
        "budgetCredits": 100.00,
        "currentSpend": 45.67,
        "percentUsed": 45.67,
        "period": "monthly",
        "periodStart": "2026-01-11T21:00:00Z",
        "periodEnd": "2026-02-11T21:00:00Z",
        "daysRemaining": 30,
        "status": "ok" | "warning" | "critical" | "exceeded",
        "nextAlert": {
          "threshold": 50,
          "remainingCredits": 4.33
        },
        "enabled": true,
        "enforceLimit": true
      }
    ],
    "total": 1
  }
}
```

---

### GET /api/budgets/:id/status

Get detailed budget status with spending breakdown.

**Authentication**: Required (`budgets:read` permission)

**Response**:
```json
{
  "success": true,
  "data": {
    "budget": {
      "id": "bdg-abc123",
      "name": "Production Monthly",
      "budgetCredits": 100.00,
      "currentSpend": 45.67,
      "percentUsed": 45.67,
      "status": "ok",
      "alerts": [
        {
          "threshold": 50,
          "triggered": false,
          "remainingUntilAlert": 4.33
        },
        {
          "threshold": 75,
          "triggered": false,
          "remainingUntilAlert": 29.33
        }
      ]
    },
    "spending": {
      "byWorkflow": [
        {
          "workflowId": "wf-123",
          "workflowName": "GitHub Analysis",
          "executions": 47,
          "totalCost": 28.40,
          "percentOfBudget": 28.40
        }
      ],
      "byDay": [
        {
          "date": "2026-01-11",
          "cost": 12.45,
          "executions": 15
        }
      ]
    },
    "projection": {
      "dailyAverage": 1.52,
      "projectedEndOfPeriod": 45.60,
      "willExceed": false
    }
  }
}
```

---

### GET /api/budgets/:id/violations

Get budget violation history.

**Authentication**: Required (`budgets:read` permission)

**Response**:
```json
{
  "success": true,
  "data": {
    "violations": [
      {
        "id": "viol-123",
        "budgetId": "bdg-abc123",
        "workflowExecutionId": "exec-xyz",
        "exceededBy": 5.50,
        "actionTaken": "workflow_paused",
        "occurredAt": "2026-01-10T15:30:00Z"
      }
    ],
    "total": 1
  }
}
```

---

### POST /api/budgets/:id/reset

Manually reset a budget's current spend.

**Authentication**: Required (`budgets:admin` permission)

**Response**:
```json
{
  "success": true,
  "data": {
    "budget": {
      "id": "bdg-abc123",
      "currentSpend": 0.00,
      "periodStart": "2026-01-11T21:00:00Z",
      "alerts": [
        // All alerts reset to not triggered
      ]
    }
  }
}
```

---

## KeyGuardian Security API (Track 4B)

### Overview

KeyGuardian provides automatic detection of exposed API keys in workflow definitions, tool parameters, and prompts.

**Features**:
- ✅ 8 built-in patterns (OpenAI, Anthropic, GitHub, AWS, Stripe, Slack, SendGrid)
- ✅ Deep recursive scanning with JSONPath tracking
- ✅ Automatic workflow creation blocking
- ✅ Custom pattern support

---

### GET /api/security/key-patterns

List all key detection patterns.

**Authentication**: Required (`security:read` permission)

**Query Parameters**:
- `provider`: Filter by provider (e.g., `openai`, `github`)
- `enabled`: `true` | `false`

**Response**:
```json
{
  "success": true,
  "data": {
    "patterns": [
      {
        "id": "builtin-openai-api-key",
        "name": "OpenAI API Key",
        "pattern": "sk-[a-zA-Z0-9]{32,}",
        "description": "OpenAI secret API key",
        "provider": "OpenAI",
        "severity": "high",
        "enabled": true,
        "createdAt": "2026-01-11T13:47:00Z",
        "updatedAt": "2026-01-11T13:47:00Z"
      },
      {
        "id": "builtin-anthropic-api-key",
        "name": "Anthropic API Key",
        "pattern": "sk-ant-[a-zA-Z0-9-]{95,}",
        "description": "Anthropic (Claude) API key",
        "provider": "Anthropic",
        "severity": "high",
        "enabled": true,
        "createdAt": "2026-01-11T13:47:00Z",
        "updatedAt": "2026-01-11T13:47:00Z"
      }
    ],
    "total": 8
  }
}
```

---

### POST /api/security/scan

Manually scan an object for exposed keys.

**Authentication**: Required (`security:read` permission)

**Request Body**:
```json
{
  "data": {
    "apiKey": "sk-test123",
    "config": {
      "token": "ghp_sometoken"
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "keysDetected": [
      {
        "pattern": "OpenAI API Key",
        "provider": "OpenAI",
        "location": "data.apiKey",
        "keyPrefix": "sk-t",
        "severity": "high"
      },
      {
        "pattern": "GitHub Personal Access Token",
        "provider": "GitHub",
        "location": "data.config.token",
        "keyPrefix": "ghp_",
        "severity": "high"
      }
    ],
    "count": 2,
    "safe": false
  }
}
```

---

### GET /api/security/key-detections

List all key exposure detections.

**Authentication**: Required (`security:read` permission)

**Query Parameters**:
- `severity`: `high` | `medium` | `low`
- `resolved`: `true` | `false`
- `limit`: 1-100 (default: 50)
- `offset`: Pagination offset

**Response**:
```json
{
  "success": true,
  "data": {
    "detections": [
      {
        "id": "det-abc123",
        "detectionType": "workflow_definition",
        "entityType": "workflow",
        "entityId": "wf-xyz",
        "keyPattern": "OpenAI API Key",
        "keyPrefix": "sk-xx",
        "location": "steps[2].config.params.apiKey",
        "severity": "high",
        "actionTaken": "blocked",
        "detectedAt": "2026-01-11T20:00:00Z",
        "resolvedAt": null,
        "resolutionNotes": null
      }
    ],
    "total": 1
  }
}
```

---

### POST /api/security/key-detections/:id/resolve

Mark a key detection as resolved.

**Authentication**: Required (`security:write` permission)

**Request Body**:
```json
{
  "resolutionNotes": "False positive - key was example placeholder"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "detection": {
      "id": "det-abc123",
      "resolvedAt": "2026-01-11T21:00:00Z",
      "resolutionNotes": "False positive - key was example placeholder"
    }
  }
}
```

---

### POST /api/security/key-patterns

Add a custom key detection pattern.

**Authentication**: Required (`security:write` permission)

**Request Body**:
```json
{
  "name": "Custom Service API Key",
  "pattern": "csk_[a-zA-Z0-9]{40}",
  "description": "My custom service API key",
  "provider": "CustomService",
  "severity": "high"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "pattern": {
      "id": "custom-pattern-123",
      "name": "Custom Service API Key",
      "pattern": "csk_[a-zA-Z0-9]{40}",
      "provider": "CustomService",
      "severity": "high",
      "enabled": true,
      "createdAt": "2026-01-11T21:00:00Z"
    }
  }
}
```

---

## Frontend Endpoints

### GET /

Main dashboard with server management, tool browsing, real-time notifications.

### GET /workflows.html

Visual workflow builder with drag-and-drop canvas.

**Features**:
- Canvas-based node editor
- Live execution preview
- Real-time cost streaming
- Template instantiation

### GET /analytics.html

Enhanced analytics dashboard.

**Features**:
- `<LiveCostStream>` - Real-time cost during execution
- `<ExecutionVisualizer>` - Waterfall chart of step durations
- `<CostForecast>` - 7-day and 30-day projections
- `<BudgetMonitor>` - Progress bars with alert levels

---

## Event Types (SSE)

Subscribe to real-time events via `/api/sse/events`.

**New Event Types**:

```typescript
// Workflow execution events
'workflow.step.started'
'workflow.step.completed'      // Includes costCredits, tokensUsed
'workflow.step.failed'
'workflow.execution.started'
'workflow.execution.completed'
'workflow.execution.failed'

// Template events
'workflow_template.created'
'workflow_template.instantiated'

// Budget events
'budget.threshold_50_reached'
'budget.threshold_75_reached'
'budget.threshold_90_reached'
'budget.exceeded'
'workflow.paused_budget'

// Security events
'key_exposure.detected'
'key_exposure.blocked'
```

**Example Event**:
```json
{
  "type": "workflow.step.completed",
  "data": {
    "executionId": "exec-abc123",
    "stepId": "analyze-code",
    "stepName": "Code Quality Analysis",
    "costCredits": 0.0187,
    "tokensUsed": 1247,
    "model": "claude-3-sonnet",
    "durationMs": 3420,
    "timestamp": "2026-01-11T21:00:00Z"
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `TOKEN_LIMIT_EXCEEDED` | 400 | Token limit exceeded |
| `BUDGET_EXCEEDED` | 403 | Budget limit exceeded |
| `SECURITY_VIOLATION` | 403 | Security check failed |
| `KEY_EXPOSURE_DETECTED` | 403 | API key detected in input |
| `PERMISSION_DENIED` | 403 | Insufficient RBAC permissions |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `NOT_FOUND` | 404 | Resource not found |
| `PROVIDER_UNAVAILABLE` | 503 | LLM provider unavailable |

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/sampling/request` | 60 | 1 minute |
| `/api/sampling/*` | 100,000 tokens | 1 day |
| `/api/workflow-templates/*` | 300 | 1 minute |
| `/api/budgets/*` | 100 | 1 minute |
| `/api/security/*` | 200 | 1 minute |

---

## Cost Tracking

All LLM sampling requests automatically track:
- ✅ Token usage (prompt + completion)
- ✅ Cost in credits (calculated from provider pricing)
- ✅ Model name and provider
- ✅ Duration in milliseconds

Costs are recorded in:
- `workflow_execution_steps` table
- Budget spend tracking
- Usage analytics
- Real-time SSE events

---

## Example: Complete Workflow Execution with All Features

```bash
#!/bin/bash
export API_KEY="mcp_live_..."
export BASE_URL="https://mcp-connect-production.up.railway.app"

# 1. Create a budget
BUDGET_ID=$(curl -s -X POST "$BASE_URL/api/budgets" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Budget",
    "scope": "global",
    "budgetCredits": 10,
    "period": "daily",
    "enforceLimit": true
  }' | jq -r '.data.budget.id')

echo "Budget created: $BUDGET_ID"

# 2. List available templates
curl -s "$BASE_URL/api/workflow-templates?category=analysis" \
  -H "Authorization: Bearer $API_KEY" | jq '.data.templates[] | {name, estimatedCost: .estimatedCostCredits}'

# 3. Instantiate template with parameters
WORKFLOW_ID=$(curl -s -X POST "$BASE_URL/api/workflow-templates/tmpl-github-analysis/instantiate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "owner": "facebook",
      "repo": "react"
    },
    "createWorkflow": true,
    "workflowName": "Analyze React"
  }' | jq -r '.data.workflowId')

echo "Workflow created: $WORKFLOW_ID"

# 4. Execute workflow (KeyGuardian scans, Budget checks)
EXECUTION_ID=$(curl -s -X POST "$BASE_URL/api/workflows/$WORKFLOW_ID/execute" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {}}' | jq -r '.data.executionId')

echo "Execution started: $EXECUTION_ID"

# 5. Monitor execution with cost tracking
while true; do
  STATUS=$(curl -s "$BASE_URL/api/workflows/executions/$EXECUTION_ID" \
    -H "Authorization: Bearer $API_KEY" | jq -r '.data.status')
  COST=$(curl -s "$BASE_URL/api/workflows/executions/$EXECUTION_ID" \
    -H "Authorization: Bearer $API_KEY" | jq -r '.data.totalCost')

  echo "Status: $STATUS, Cost: \$$COST"

  if [ "$STATUS" == "completed" ] || [ "$STATUS" == "failed" ]; then
    break
  fi

  sleep 2
done

# 6. Check budget status
curl -s "$BASE_URL/api/budgets/$BUDGET_ID/status" \
  -H "Authorization: Bearer $API_KEY" | jq '{
    currentSpend: .data.budget.currentSpend,
    percentUsed: .data.budget.percentUsed,
    status: .data.budget.status
  }'

# 7. Check for any key exposures
curl -s "$BASE_URL/api/security/key-detections" \
  -H "Authorization: Bearer $API_KEY" | jq '{
    totalDetections: .data.total,
    unresolved: [.data.detections[] | select(.resolvedAt == null)]
  }'
```

---

## Support

- **Documentation**: https://github.com/ryanhalphide/mcp-connect/docs
- **Issues**: https://github.com/ryanhalphide/mcp-connect/issues
- **API Status**: https://mcp-connect-production.up.railway.app/api/health

---

**Built with ❤️ using Claude Code**
