# CSV Export Feature

Export your analytics data to CSV files for further analysis in Excel, Google Sheets, or other tools.

## Quick Start

1. **Open Dashboard:**
   ```
   http://localhost:3000/analytics.html
   ```

2. **Navigate to any analytics page**

3. **Click an export button** - CSV file downloads automatically

## Available Exports

### Overview Page
- **📊 Export Model Breakdown** - Cost distribution by LLM model
- **📈 Export Cost Trend** - Daily cost data (7 days)
- **📋 Export Workflows** - Top workflows by cost

### Breakdown Page
- **📥 Export to CSV** - Current breakdown view (Workflow/Model/Step)

### Performance Page
- **⏱️ Export Slowest Steps** - Performance bottlenecks
- **✅ Export Success Rates** - Workflow reliability
- **💰 Export Cost Efficiency** - Cost per successful execution

## File Format

**Filename Pattern:** `{type}_{timestamp}.csv`

**Examples:**
- `model_breakdown_20251230_051430.csv`
- `cost_breakdown_by_workflow_20251230_051435.csv`
- `success_rates_20251230_051447.csv`

**CSV Structure:**
```csv
Column1,Column2,Column3
Value1,Value2,Value3
Value1,Value2,Value3
```

## Date Filter Integration

Exports respect the active date filter:
- Select "Last 7 Days" → Export only 7 days of data
- Select "Custom Range" → Export only data within custom range
- Change filter → Export reflects new date range

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Mobile browsers

## Sample Data

**Model Breakdown:**
```csv
Model,Uses,Total Tokens,Total Cost,Avg Cost
gpt-4-turbo,11,31000,0.8220,0.0747
claude-3-sonnet,9,29700,0.3990,0.0443
```

**Cost Trend:**
```csv
Date,Daily Cost,Daily Tokens,Daily Executions
2025-12-30,0.0020,1650,1
2025-12-29,0.2320,11400,22
```

**Workflows:**
```csv
Workflow,Executions,Total Cost,Avg Cost/Step,Total Tokens
AI Content Generator,11,0.8220,0.0747,31000
Code Review Assistant,6,0.2380,0.0397,18100
```

## Use Cases

### Monthly Reporting
1. Set date filter to "Last 30 Days"
2. Export all data types
3. Share with team/management

### Budget Analysis
1. Set custom date range (billing period)
2. Export model breakdown and workflows
3. Create Excel pivot tables
4. Forecast future costs

### Performance Investigation
1. Set date filter to incident timeframe
2. Export slowest steps and success rates
3. Identify bottlenecks and failures
4. Create action plan

## Tips

- **Unique Filenames** - Timestamp prevents overwrites
- **Sortable Names** - Files sort chronologically
- **Excel Compatible** - Opens directly in spreadsheet apps
- **Proper Escaping** - Handles commas, quotes, newlines

## Documentation

For complete implementation details, see:
- `/tmp/CSV_EXPORT_IMPLEMENTATION.md`

## Support

Dashboard URL: http://localhost:3000/analytics.html
