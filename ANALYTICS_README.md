# Analytics Dashboard

Comprehensive LLM cost tracking and performance analytics for MCP Connect.

## Quick Start

### Access the Dashboard

1. **Start MCP Connect:**
```bash
npm start
```

2. **Open Dashboard:**
```
http://localhost:3000/analytics.html
```

3. **Start Tracking:**
- Dashboard loads with live data automatically
- Navigate between pages using top navigation
- All data updates in real-time

## Features

### 📊 Overview Page
- **Total cost, tokens, and executions** (KPI cards)
- **Cost distribution by model** (Doughnut chart)
- **7-day cost trend** (Line chart)
- **Top workflows by cost** (Sortable table)

### 💰 Cost Breakdown
- **Dynamic grouping** - by Workflow, Model, or Step
- **Top 10 visual ranking** (Bar chart)
- **Detailed breakdown** (Table with costs, tokens, usage)

### ⚡ Performance Metrics
- **Slowest steps** (Bar chart)
- **Success rates by workflow** (Table with badges)
- **Cost efficiency** (Cost per successful execution)

### ⚙️ Settings
- **API configuration** (Base URL, API Key)
- **LocalStorage persistence** (Settings saved across sessions)

## API Endpoints

All endpoints require `analytics:read` permission.

### Cost Overview
```
GET /api/analytics/cost/overview
```
Returns total metrics, model breakdown, and 7-day trend.

### Time-Series
```
GET /api/analytics/cost/timeseries?interval=day&limit=7
```
Returns cost data grouped by time interval.

### Cost Breakdown
```
GET /api/analytics/cost/breakdown?groupBy=workflow&limit=10
```
Returns costs grouped by workflow, model, or step.

### Period Comparison
```
GET /api/analytics/cost/comparison
```
Compares current 7 days vs previous 7 days.

### Workflow Details
```
GET /api/analytics/workflows/:id/costs
```
Returns detailed cost analysis for a specific workflow.

### Performance Metrics
```
GET /api/analytics/performance
```
Returns slowest steps, success rates, and cost efficiency.

## Configuration

### Default Settings
```javascript
{
  baseURL: 'http://localhost:3000',
  apiKey: 'your-api-key-here'
}
```

### Update Configuration
1. Navigate to Settings page
2. Update Base URL and API Key
3. Click "Save Configuration"
4. Reload page to apply

### API Key Requirements
- Must have `analytics:read` permission
- Admin role has this permission by default
- Custom roles can be granted this permission via RBAC

## Data Model

### Cost Tracking
Costs are automatically tracked when workflows execute MCP tool steps that return token usage:

```sql
workflow_execution_steps:
  - cost_credits (USD)
  - tokens_used (count)
  - model_name (e.g., gpt-4-turbo)
  - duration_ms
  - started_at (timestamp)
```

### Supported Models
- GPT-4 Turbo
- GPT-3.5 Turbo
- Claude 3 Opus
- Claude 3 Sonnet
- Claude 3 Haiku
- Text Embeddings (OpenAI)

## Architecture

### Backend
- **Framework:** Hono (TypeScript)
- **Database:** SQLite
- **Authentication:** API key + RBAC
- **Validation:** Zod schemas

### Frontend
- **UI Library:** React 18 (CDN)
- **Charts:** Chart.js 4.4.1 (CDN)
- **Styling:** Custom CSS
- **Storage:** LocalStorage (config)
- **Build:** None (single HTML file)

## Sample Data

Generate sample data for testing:

```bash
sqlite3 ./data/mcp-connect.db < /tmp/seed-analytics-data.sql
```

This creates:
- 5 test workflows
- 30 executions (spanning 30 days)
- 94,800 tokens tracked
- $1.34 in costs
- Multiple LLM models

## Testing

### Test All Endpoints
```bash
/tmp/test-all-analytics.sh
```

### Manual Testing
```bash
# Get overview
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/api/analytics/cost/overview

# Get breakdown
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/api/analytics/cost/breakdown?groupBy=workflow
```

## Troubleshooting

### Dashboard Not Loading
1. Check server is running: `curl http://localhost:3000/api/health`
2. Verify static files: `ls public/analytics.html`
3. Check browser console for errors

### API Errors
1. Verify API key in Settings
2. Check key has `analytics:read` permission
3. Confirm server is running and accessible

### No Data Showing
1. Run sample data script (see above)
2. Execute workflows to generate real data
3. Check database: `sqlite3 ./data/mcp-connect.db "SELECT COUNT(*) FROM workflow_execution_steps"`

## Performance

- **Initial Load:** < 1 second
- **API Response:** < 100ms
- **Chart Rendering:** < 50ms
- **Data Size:** ~5-10KB per request

## Security

- ✅ API key authentication required
- ✅ RBAC permission enforcement
- ✅ CORS protection enabled
- ✅ Secure headers middleware
- ⚠️ Use HTTPS in production

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers

## Documentation

- **API Docs:** `/tmp/analytics-dashboard-complete.md`
- **Frontend Guide:** `/tmp/FRONTEND_DASHBOARD_COMPLETE.md`
- **Visual Guide:** `/tmp/DASHBOARD_VISUAL_GUIDE.md`
- **Implementation:** `/tmp/COMPLETE_IMPLEMENTATION_SUMMARY.md`

## License

Same as MCP Connect

## Support

For issues or questions, please refer to the main MCP Connect documentation.
