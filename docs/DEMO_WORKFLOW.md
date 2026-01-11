# Demo Workflow: "AI-Powered Repository Analyzer with Budget & Security"

This workflow demonstrates all 4 new feature tracks working together:
- **Track 1**: LLM Sampling API for intelligent analysis
- **Track 2**: Real-time cost streaming in frontend
- **Track 3**: Workflow Templates for quick deployment
- **Track 4**: Budget enforcement and KeyGuardian security

---

## Workflow Overview

**Name**: GitHub Repository Intelligence Report
**Category**: Analysis
**Difficulty**: Intermediate
**Estimated Cost**: $0.05 per execution (GPT-4 Turbo)

### What It Does

1. Fetches GitHub repository information (stars, forks, languages)
2. Analyzes code quality using Claude 3 Sonnet
3. Generates executive summary with OpenAI GPT-4
4. Tracks costs in real-time
5. Blocks execution if budget exceeded
6. Scans all inputs for exposed API keys

---

## Workflow Definition (JSON)

```json
{
  "name": "GitHub Repository Intelligence Report",
  "description": "AI-powered repository analysis with cost tracking and security",
  "steps": [
    {
      "id": "fetch-repo",
      "type": "tool",
      "name": "Fetch Repository Metadata",
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
      "id": "analyze-code",
      "type": "sampling",
      "name": "Code Quality Analysis",
      "config": {
        "model": "claude-3-sonnet",
        "messages": [
          {
            "role": "system",
            "content": "You are a senior software architect. Analyze the repository and provide insights on code quality, architecture, and best practices."
          },
          {
            "role": "user",
            "content": "Repository: {{repo.name}}\nDescription: {{repo.description}}\nLanguages: {{repo.languages}}\n\nProvide a detailed analysis covering:\n1. Architecture quality (0-10)\n2. Code maintainability assessment\n3. Key strengths\n4. Areas for improvement\n5. Technology stack evaluation"
          }
        ],
        "maxTokens": 1000,
        "temperature": 0.3
      },
      "dependencies": ["fetch-repo"]
    },
    {
      "id": "generate-summary",
      "type": "sampling",
      "name": "Executive Summary Generation",
      "config": {
        "model": "gpt-4-turbo",
        "messages": [
          {
            "role": "system",
            "content": "You are an executive consultant. Create concise, actionable summaries for technical leadership."
          },
          {
            "role": "user",
            "content": "Repository Analysis:\n{{analyze-code.content}}\n\nCreate a 3-paragraph executive summary highlighting:\n1. Overall assessment\n2. Key recommendations\n3. Strategic value"
          }
        ],
        "maxTokens": 500,
        "temperature": 0.5
      },
      "dependencies": ["analyze-code"]
    },
    {
      "id": "create-report",
      "type": "tool",
      "name": "Save Report to GitHub Issue",
      "config": {
        "serverName": "github",
        "toolName": "create_issue",
        "params": {
          "owner": "{{owner}}",
          "repo": "{{repo}}",
          "title": "AI-Generated Repository Analysis Report",
          "body": "# Repository Intelligence Report\n\n## Executive Summary\n{{generate-summary.content}}\n\n## Detailed Analysis\n{{analyze-code.content}}\n\n---\n**Cost**: ${{workflow.totalCost}}\n**Tokens Used**: {{workflow.totalTokens}}\n**Generated**: {{workflow.timestamp}}"
        }
      },
      "dependencies": ["generate-summary"]
    }
  ],
  "errorHandling": {
    "strategy": "rollback",
    "onError": "notify-slack"
  },
  "timeout": 300000,
  "budgetLimit": 0.10
}
```

---

## Parameter Schema

```json
{
  "parameters": [
    {
      "name": "owner",
      "type": "string",
      "description": "GitHub repository owner (username or organization)",
      "required": true,
      "validation": {
        "pattern": "^[a-zA-Z0-9-]+$"
      }
    },
    {
      "name": "repo",
      "type": "string",
      "description": "GitHub repository name",
      "required": true,
      "validation": {
        "pattern": "^[a-zA-Z0-9_.-]+$"
      }
    }
  ]
}
```

---

## How It Demonstrates Each Track

### Track 1: LLM Sampling API ✅

**Steps 2 & 3** use the Sampling API:
- **Step 2**: Claude 3 Sonnet for detailed technical analysis
- **Step 3**: GPT-4 Turbo for executive summary

**Cost Tracking**:
```javascript
{
  "step2": {
    "model": "claude-3-sonnet",
    "tokensUsed": 1247,
    "costCredits": 0.0187,  // Tracked automatically
    "durationMs": 3420
  },
  "step3": {
    "model": "gpt-4-turbo",
    "tokensUsed": 612,
    "costCredits": 0.0245,
    "durationMs": 2810
  }
}
```

### Track 2: Frontend Real-Time Monitoring ✅

**Workflow Builder**:
- Visual canvas shows all 4 steps connected
- Live execution preview with step highlighting
- Real-time cost counter updates as each sampling step completes

**Analytics Dashboard**:
```javascript
// LiveCostStream component
<LiveCostStream executionId="exec-123">
  Current Cost: $0.0432
  Tokens: 1,859
  Step: 3/4 (Generating Summary...)
</LiveCostStream>

// ExecutionVisualizer component
Step 1: Fetch Repo          ████████████ 850ms  ✓
Step 2: Analyze Code        ████████████████████ 3,420ms ✓
Step 3: Generate Summary    ████████████████ 2,810ms ⏳
Step 4: Create Report       ░░░░░░░░░░░░ pending
```

### Track 3: Workflow Templates ✅

This workflow is **saved as a template** in the library:

```bash
# Instantiate from template
curl -X POST "https://mcp-connect-production.up.railway.app/api/workflow-templates/github-intelligence/instantiate" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "parameters": {
      "owner": "anthropics",
      "repo": "anthropic-sdk-typescript"
    },
    "createWorkflow": true,
    "workflowName": "Analyze Anthropic SDK"
  }'
```

**Template Features**:
- Pre-configured with optimal model settings
- Parameter validation (regex patterns)
- Budget limit ($0.10) built-in
- Reusable across multiple repositories

### Track 4: Budget Enforcement & KeyGuardian ✅

**Budget Check (Pre-Execution)**:
```javascript
// Before workflow starts
const budgetCheck = budgetEnforcer.canExecuteWorkflow(workflowId);
if (!budgetCheck.allowed) {
  throw new Error('Monthly budget of $100 exceeded. Current spend: $98.50');
}
```

**Cost Recording (Post-Execution)**:
```javascript
// After workflow completes
budgetEnforcer.recordWorkflowCost(executionId, 0.0432);

// If threshold crossed, trigger alert
if (currentSpend >= budget * 0.75) {
  budgetNotificationService.sendAlert({
    budgetName: "Production Monthly",
    threshold: "75%",
    currentSpend: "$75.20",
    budgetLimit: "$100.00"
  });
}
```

**KeyGuardian Security**:
```javascript
// Before workflow creation
const scanResult = keyGuardian.scanWorkflowDefinition(definition);

if (scanResult.keysDetected.length > 0) {
  // Example detection:
  {
    pattern: "OpenAI API Key",
    location: "steps[2].config.messages[0].content",
    keyPrefix: "sk-xx",
    action: "BLOCKED"
  }

  throw new Error('API key exposure detected. Workflow creation blocked.');
}
```

---

## Execution Flow with All Features

```
START
  │
  ├─→ [KeyGuardian] Scan workflow definition for exposed keys
  │   └─→ ✓ No keys detected
  │
  ├─→ [Budget] Check if execution allowed
  │   └─→ ✓ Current spend: $45.20 / $100 (45%)
  │
  ├─→ [Step 1] Fetch repo metadata (GitHub API)
  │   └─→ ✓ 250ms, $0
  │
  ├─→ [Step 2] Claude 3 Sonnet analysis
  │   ├─→ [Frontend] LiveCostStream updates: $0.0187
  │   ├─→ [Backend] Record tokens: 1,247
  │   └─→ ✓ 3,420ms, $0.0187
  │
  ├─→ [Step 3] GPT-4 Turbo summary
  │   ├─→ [Frontend] LiveCostStream updates: $0.0432
  │   ├─→ [Backend] Record tokens: 612
  │   └─→ ✓ 2,810ms, $0.0245
  │
  ├─→ [Step 4] Create GitHub issue with report
  │   └─→ ✓ 1,120ms, $0
  │
  ├─→ [Budget] Record total cost: $0.0432
  │   └─→ ✓ New spend: $45.24 / $100 (45.24%)
  │
COMPLETE
  │
  └─→ [Frontend] Show execution summary with waterfall chart
```

---

## Cost Breakdown

| Step | Model | Tokens | Cost | Duration |
|------|-------|--------|------|----------|
| 1. Fetch Repo | - | 0 | $0 | 250ms |
| 2. Analyze | claude-3-sonnet | 1,247 | $0.0187 | 3,420ms |
| 3. Summary | gpt-4-turbo | 612 | $0.0245 | 2,810ms |
| 4. Create Issue | - | 0 | $0 | 1,120ms |
| **TOTAL** | | **1,859** | **$0.0432** | **7,600ms** |

---

## Security Features Demonstrated

### 1. Pre-Execution Validation
- ✅ Workflow scanned for exposed API keys
- ✅ Budget limit checked before execution
- ✅ RBAC permissions verified

### 2. Runtime Protection
- ✅ Token limits enforced (max 4,000 per request)
- ✅ Prompt injection detection on all LLM inputs
- ✅ PII detection (email, SSN, credit card patterns)

### 3. Post-Execution Tracking
- ✅ Cost recorded for budget tracking
- ✅ Audit log created with full execution details
- ✅ Threshold alerts sent if budget limits approached

---

## Testing the Demo Workflow

### Option 1: Via Workflow Builder UI

1. Open: https://mcp-connect-production.up.railway.app/workflows.html
2. Click "New from Template"
3. Select "GitHub Repository Intelligence Report"
4. Fill parameters:
   - Owner: `vercel`
   - Repo: `next.js`
5. Click "Execute"
6. Watch real-time cost streaming in the execution panel

### Option 2: Via API

```bash
export API_KEY="mcp_live_..."

# Create workflow from template
curl -X POST "https://mcp-connect-production.up.railway.app/api/workflow-templates/github-intelligence/instantiate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "owner": "facebook",
      "repo": "react"
    },
    "createWorkflow": true,
    "workflowName": "Analyze React Repository"
  }' | jq '.data.workflowId'

# Execute the workflow
WORKFLOW_ID="..."
curl -X POST "https://mcp-connect-production.up.railway.app/api/workflows/$WORKFLOW_ID/execute" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "owner": "facebook",
      "repo": "react"
    }
  }' | jq '.data.executionId'

# Watch execution with cost tracking
EXECUTION_ID="..."
curl "https://mcp-connect-production.up.railway.app/api/workflows/executions/$EXECUTION_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '{
    status: .data.status,
    totalCost: .data.totalCost,
    tokensUsed: .data.totalTokens,
    steps: [.data.steps[] | {name, status, costCredits, tokensUsed, durationMs}]
  }'
```

### Option 3: Via Template Instantiation

```bash
# List available templates
curl "https://mcp-connect-production.up.railway.app/api/workflow-templates?category=analysis" \
  -H "Authorization: Bearer $API_KEY" | jq '.data.templates[] | {name, estimatedCostCredits}'

# Instantiate and execute in one call
curl -X POST "https://mcp-connect-production.up.railway.app/api/workflow-templates/github-intelligence/instantiate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "owner": "microsoft",
      "repo": "vscode"
    },
    "createWorkflow": true,
    "workflowName": "VSCode Analysis",
    "executeImmediately": true
  }'
```

---

## Expected Output

### GitHub Issue Created

```markdown
# Repository Intelligence Report

## Executive Summary

The React repository demonstrates exceptional engineering practices with a mature,
well-architected codebase. The project maintains high code quality standards through
comprehensive testing and clear architectural boundaries. Key strengths include robust
documentation, active community engagement, and forward-thinking feature development.

Strategic recommendations focus on continued investment in performance optimization
and expanding the ecosystem of complementary tools. The modular architecture provides
excellent foundation for long-term maintainability and feature expansion.

Overall assessment: This is a best-in-class open source project that serves as an
excellent reference for modern frontend framework development.

## Detailed Analysis

**Architecture Quality: 9/10**

The React codebase exhibits excellent architectural decisions with clear separation
of concerns between core rendering, reconciliation, and DOM manipulation layers.
The fiber architecture represents a sophisticated approach to concurrent rendering.

**Code Maintainability: High**

Strong TypeScript adoption, comprehensive test coverage (>90%), and consistent
code style contribute to high maintainability. Documentation is thorough and
regularly updated.

**Key Strengths:**
- Highly modular design enabling incremental adoption
- Excellent test infrastructure with multiple testing strategies
- Strong community governance and RFC process
- Performance-focused with continuous benchmarking

**Areas for Improvement:**
- Legacy code patterns in some older modules
- Opportunity for further TypeScript migration in core packages
- Documentation could benefit from more advanced use case examples

**Technology Stack Evaluation:**

Core technologies (JavaScript, Flow, TypeScript) are well-chosen for the project's
goals. The build system is robust with Rollup for bundling and comprehensive
development tooling.

---
**Cost**: $0.0432
**Tokens Used**: 1,859
**Generated**: 2026-01-11T21:15:30Z
```

---

## Monitoring & Alerts

### Real-Time Dashboard View

```
┌─ Workflow Execution: "Analyze React Repository" ──────────────┐
│                                                                │
│  Status: ✓ Completed                                          │
│  Duration: 7.6s                                                │
│  Cost: $0.0432                                                 │
│  Tokens: 1,859                                                 │
│                                                                │
│  ┌─ Live Cost Stream ──────────────────────────────────┐     │
│  │  $0.0432  ██████████████████████████ 100%            │     │
│  │  Budget: $0.10 remaining                             │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌─ Step Execution Timeline ───────────────────────────┐     │
│  │  ▓▓░░░░░░░░░░░░░░░░░░  1. Fetch Repo (250ms)        │     │
│  │  ░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  2. Analyze ($0.0187)         │     │
│  │  ░░░░░░░░░░░░░░▓▓▓▓▓▓  3. Summary ($0.0245)         │     │
│  │  ░░░░░░░░░░░░░░░░░░▓▓  4. Create Issue (1.1s)       │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Budget Alert Example

```json
{
  "event": "budget.threshold_75_reached",
  "budget": {
    "name": "Production Monthly",
    "scope": "global",
    "budgetCredits": 100,
    "currentSpend": 75.24,
    "percentUsed": 75.24
  },
  "workflow": {
    "id": "wf-abc123",
    "name": "Analyze React Repository",
    "costCredits": 0.0432
  },
  "timestamp": "2026-01-11T21:15:35Z",
  "alertLevel": "warning",
  "message": "75% of monthly budget consumed. Remaining: $24.76"
}
```

---

## Summary: All 4 Tracks in Action

This single workflow demonstrates the complete integration:

1. **Sampling API** → Powers intelligent analysis with Claude & GPT-4
2. **Frontend** → Real-time cost visualization and execution monitoring
3. **Templates** → One-click deployment with parameter validation
4. **Budget & Security** → Automatic cost tracking and API key protection

**Total Implementation**: 4 steps, 2 LLM calls, $0.04 per execution, 100% secured

🎉 **All features working together seamlessly!**
