# 📊 MCP Connect Analytics Dashboard

A comprehensive analytics dashboard for tracking and analyzing LLM usage costs, performance metrics, and workflow efficiency across your MCP Connect instance.

---

## 🚀 Quick Start

### 1. Start the Server

```bash
npm start
```

### 2. Access the Dashboard

Open your browser to:
```
http://localhost:3000/analytics.html
```

### 3. Configure API Access

On first visit, you'll be prompted to enter:
- **API Key**: Your MCP Connect API key
- **Base URL**: `http://localhost:3000` (or your server URL)

Click **Save Configuration** - settings are stored in browser localStorage.

---

## 📋 Features Overview

### ✅ Core Analytics
- **Real-time KPIs** - Total cost, tokens, executions, and averages
- **Cost Breakdown** - By workflow, model, or individual steps
- **Performance Metrics** - Success rates, duration analysis, efficiency
- **Time-series Charts** - 7-day cost trends and patterns
- **Interactive Tables** - Sortable, detailed breakdowns

### ✅ Date Range Filtering
- **Preset Ranges** - Last 7 Days, Last 30 Days, Last 90 Days
- **Custom Ranges** - Select any start/end date
- **Persistent Filter** - Applies across all dashboard pages
- **Real-time Updates** - Data refreshes when filter changes

### ✅ Data Export
- **CSV Exports** - 7 different data views for Excel/Google Sheets
- **PDF Reports** - 3 professional reports with charts and tables
- **Timestamped Files** - Unique filenames prevent overwrites
- **Date-Filtered** - Exports respect active date range

---

## 📖 Pages & Navigation

### Overview Page

**Purpose:** High-level cost summary and trends

**KPIs Displayed:**
- Total Cost (30 days)
- Total Tokens
- Total Executions
- Avg Cost/Execution

**Visualizations:**
- 🍩 Cost by Model (doughnut chart)
- 📈 7-Day Cost Trend (line chart)

**Tables:**
- Model Breakdown (model, uses, tokens, cost, avg cost)
- Top Workflows by Cost (workflow, executions, cost, tokens)

**Export Options:**
- 📊 Export Model Breakdown (CSV)
- 📈 Export Cost Trend (CSV)
- 📋 Export Workflows (CSV)
- 📄 Export to PDF (Complete overview report)

---

### Cost Breakdown Page

**Purpose:** Detailed cost analysis by different dimensions

**Grouping Options:**
- **By Workflow** - See which workflows cost the most
- **By Model** - Compare LLM model costs (GPT-4, Claude, etc.)
- **By Step** - Analyze individual step costs

**Visualizations:**
- 📊 Top 10 Bar Chart (by selected grouping)

**Tables:**
- Detailed Breakdown (name, cost, tokens, executions/uses, avg cost)
- Up to 20 items displayed

**Export Options:**
- 📥 Export to CSV (Current breakdown view)
- 📄 Export to PDF (Summary metrics + chart + table)

**Dynamic Behavior:**
- Change grouping → Chart and table update
- Export filename reflects grouping (e.g., `breakdown_by_model.csv`)

---

### Performance Page

**Purpose:** Workflow reliability and efficiency analysis

**Metrics:**
- **Slowest Steps** - Identify performance bottlenecks
- **Success Rates** - Track workflow reliability
- **Cost Efficiency** - Cost per successful execution

**Visualizations:**
- ⏱️ Slowest Steps Chart (horizontal bar chart)

**Tables:**
- Slowest Steps (step name, avg duration, executions)
- Success Rates by Workflow (total, successful, failed, rate %)
- Cost Efficiency (workflow, executions, successful, cost, cost/success)

**Export Options:**
- ⏱️ Export Slowest Steps (CSV)
- ✅ Export Success Rates (CSV)
- 💰 Export Cost Efficiency (CSV)
- 📄 Export to PDF (Complete performance report)

---

### Settings Page

**Purpose:** Configure dashboard API connection

**Settings:**
- **API Key** - Your MCP Connect API key
- **Base URL** - Server URL (default: `http://localhost:3000`)

**Actions:**
- Save Configuration (stores in localStorage)
- Settings persist across browser sessions

---

## 🗓️ Date Range Filtering

### Accessing the Date Filter

The date filter panel appears at the top of all analytics pages (Overview, Breakdown, Performance).

### Preset Ranges

Click any preset button to instantly filter data:

- **Last 7 Days** - Rolling 7-day window
- **Last 30 Days** - Rolling 30-day window (default)
- **Last 90 Days** - Rolling 90-day window

**Behavior:** Automatically calculates date range and refreshes all data.

### Custom Date Range

1. Click **Custom Range** button
2. Date picker inputs appear
3. Select **Start Date**
4. Select **End Date**
5. Click **Apply** button

**Date Range:** Includes start date at 00:00:00 and end date at 23:59:59.

### Filter Persistence

- Filter applies to **all pages** (Overview, Breakdown, Performance)
- Navigate between pages → Filter remains active
- Filter info displayed: "📅 Last 30 Days" or "📅 2025-12-01 to 2025-12-30"

### Date Filter Integration

All API calls automatically include date parameters:
```javascript
api.getCostOverview(startDate, endDate)
api.getCostBreakdown(groupBy, limit, startDate, endDate)
api.getPerformanceMetrics(startDate, endDate)
```

---

## 📥 CSV Export

### What Gets Exported

CSV exports provide raw data for further analysis in Excel, Google Sheets, or other tools.

### Export Format

**File Structure:**
```csv
Column1,Column2,Column3
Value1,Value2,Value3
```

**Features:**
- Proper CSV escaping (handles commas, quotes, newlines)
- Column headers in first row
- UTF-8 encoding
- Compatible with Excel, Google Sheets, LibreOffice

### Available CSV Exports

#### Overview Page
1. **📊 Export Model Breakdown**
   - Columns: Model, Uses, Total Tokens, Total Cost, Avg Cost
   - Filename: `model_breakdown_YYYYMMDD_HHMMSS.csv`

2. **📈 Export Cost Trend**
   - Columns: Date, Daily Cost, Daily Tokens, Daily Executions
   - Filename: `cost_trend_YYYYMMDD_HHMMSS.csv`

3. **📋 Export Workflows**
   - Columns: Workflow, Executions, Total Cost, Avg Cost/Step, Total Tokens
   - Filename: `workflows_breakdown_YYYYMMDD_HHMMSS.csv`

#### Breakdown Page
4. **📥 Export to CSV**
   - Columns: Name, Total Cost, Total Tokens, Executions/Uses, Avg Cost
   - Filename: `cost_breakdown_by_{groupBy}_YYYYMMDD_HHMMSS.csv`
   - Dynamic: Reflects selected grouping (workflow/model/step)

#### Performance Page
5. **⏱️ Export Slowest Steps**
   - Columns: Step Name, Avg Duration (ms), Executions
   - Filename: `slowest_steps_YYYYMMDD_HHMMSS.csv`

6. **✅ Export Success Rates**
   - Columns: Workflow, Total Executions, Successful, Success Rate (%)
   - Filename: `success_rates_YYYYMMDD_HHMMSS.csv`

7. **💰 Export Cost Efficiency**
   - Columns: Workflow, Total Executions, Successful, Total Cost, Cost per Success
   - Filename: `cost_efficiency_YYYYMMDD_HHMMSS.csv`

### CSV File Naming

**Pattern:** `{type}_{timestamp}.csv`

**Timestamp Format:** YYYYMMDD_HHMMSS

**Example:** `model_breakdown_20251230_143522.csv`

**Benefits:**
- Unique filenames prevent overwrites
- Sortable chronologically
- Descriptive base names

### Date Filter Integration

CSV exports automatically include data from the active date filter:
- Select "Last 7 Days" → Export only 7 days of data
- Select custom range → Export only that date range

---

## 📄 PDF Export

### What Gets Exported

PDF exports generate professional reports with:
- ✅ Branded headers with MCP Connect logo
- ✅ KPI summary metrics
- ✅ Data visualization charts (as images)
- ✅ Detailed data tables
- ✅ Page numbers on all pages
- ✅ Date filter information

### Available PDF Reports

#### 1. Overview Report

**Button:** Overview page → "📄 Export to PDF"

**Filename:** `overview_report_YYYYMMDD_HHMMSS.pdf`

**Contents:**
- **Header:** "Cost Overview Report" + date period
- **KPI Metrics:**
  - Total Cost
  - Total Tokens
  - Total Executions
  - Avg Cost/Execution
- **Chart:** 7-Day Cost Trend (line chart)
- **Table:** Cost by Model (model, uses, tokens, cost, avg cost)
- **Table:** Top Workflows by Cost (workflow, executions, cost, tokens)
- **Footer:** Page numbers

**Use Cases:**
- Executive summaries
- Monthly cost reports
- Budget presentations

---

#### 2. Breakdown Report

**Button:** Breakdown page → "📄 Export to PDF"

**Filename:** `breakdown_by_{groupBy}_YYYYMMDD_HHMMSS.pdf`

**Contents:**
- **Header:** "Cost Breakdown by Workflow/Model/Step" + date period
- **Summary Metrics:**
  - Total Items
  - Total Cost
  - Total Tokens
  - Avg Cost
- **Chart:** Top 10 bar chart (by selected grouping)
- **Table:** Detailed Breakdown (all items with name, cost, tokens, executions, avg cost)
- **Footer:** Page numbers

**Dynamic Features:**
- Title adapts to selected grouping
- Column headers change (Executions vs Uses)
- Filename includes grouping type

**Use Cases:**
- Workflow cost analysis
- Model comparison reports
- Step-level cost investigation

---

#### 3. Performance Report

**Button:** Performance page → "📄 Export to PDF"

**Filename:** `performance_metrics_YYYYMMDD_HHMMSS.pdf`

**Contents:**
- **Header:** "Performance Metrics Report" + date period
- **Summary Metrics:**
  - Total Executions
  - Successful Executions
  - Overall Success Rate (%)
  - Average Duration (ms)
- **Chart:** Slowest Steps (horizontal bar chart)
- **Table:** Slowest Steps (step name, avg duration, executions)
- **Table:** Success Rates by Workflow (workflow, total, successful, failed, rate %)
- **Table:** Cost Efficiency (workflow, executions, successful, cost, cost/success)
- **Footer:** Page numbers

**Use Cases:**
- Performance reviews
- Bottleneck identification
- Reliability tracking
- Efficiency optimization

---

### PDF Features

#### Professional Styling
- **Brand Colors:** MCP Connect blue (#3B82F6)
- **Clean Typography:** Sans-serif fonts, readable sizes
- **Structured Layout:** Consistent spacing and margins
- **Visual Hierarchy:** Clear section titles

#### Multi-Page Support
- **Auto-Pagination:** Tables automatically split across pages
- **Page Numbers:** "Page X of Y" on every page
- **Consistent Headers:** MCP Connect branding on first page

#### Chart Integration
- **High Quality:** Charts converted to PNG images
- **Preserved Styling:** Colors and formatting maintained
- **Customizable Size:** Charts sized for optimal readability

#### Date Context
- **Period Display:** Shows active date filter in header
- **Contextual Data:** All data reflects filtered date range
- **Clear Labeling:** "Last 30 Days" or "2025-12-01 to 2025-12-30"

---

## 🎯 Common Workflows

### Monthly Cost Report

**Goal:** Generate monthly cost summary for management

**Steps:**
1. Navigate to **Overview** page
2. Click **Custom Range** in date filter
3. Select **Start Date:** First day of month
4. Select **End Date:** Last day of month
5. Click **Apply**
6. Click **📄 Export to PDF**
7. Share `overview_report_YYYYMMDD_HHMMSS.pdf` with stakeholders

**Result:** Professional PDF with monthly cost summary, trends, and breakdowns.

---

### Workflow Cost Analysis

**Goal:** Compare costs across different workflows

**Steps:**
1. Navigate to **Breakdown** page
2. Ensure **Group By** is set to "Workflow"
3. Set desired date filter (e.g., "Last 30 Days")
4. Review the Top 10 chart and detailed table
5. Click **📥 Export to CSV** for Excel analysis
6. OR click **📄 Export to PDF** for report sharing

**Result:** Detailed workflow cost breakdown in CSV or PDF format.

---

### Performance Investigation

**Goal:** Identify and analyze performance bottlenecks

**Steps:**
1. Navigate to **Performance** page
2. Set date filter to investigation timeframe
3. Review **Slowest Steps** chart
4. Identify bottlenecks in table
5. Check **Success Rates** for failing workflows
6. Review **Cost Efficiency** for expensive failures
7. Click **📄 Export to PDF** to document findings

**Result:** Comprehensive performance report with bottlenecks, failures, and efficiency metrics.

---

### Budget Tracking

**Goal:** Track spending against budget over time

**Steps:**
1. Navigate to **Overview** page
2. Click **Custom Range**
3. Select billing period dates
4. Note **Total Cost** KPI
5. Click **📈 Export Cost Trend** (CSV)
6. Open CSV in Excel
7. Create pivot table or forecast
8. Compare against budget

**Result:** Historical cost data for budget analysis and forecasting.

---

## 🔧 Technical Details

### Architecture

**Frontend:**
- React 18 (CDN-based, no build step for dashboard)
- Chart.js 4.4.1 (data visualization)
- jsPDF 2.5.1 + jsPDF-autotable 3.8.2 (PDF generation)
- Babel Standalone (JSX transformation)

**Backend:**
- Express.js REST API
- SQLite database (step-level cost tracking)
- 6 analytics endpoint groups

**Storage:**
- localStorage for dashboard settings
- SQLite for analytics data

### API Endpoints

All endpoints accept optional `startDate` and `endDate` query parameters.

#### Cost Analytics
```
GET /api/analytics/cost/overview?startDate={ISO8601}&endDate={ISO8601}
GET /api/analytics/cost/timeseries?interval=day&limit=7&startDate={ISO8601}&endDate={ISO8601}
GET /api/analytics/cost/breakdown?groupBy=workflow&limit=10&startDate={ISO8601}&endDate={ISO8601}
GET /api/analytics/cost/comparison?startDate={ISO8601}&endDate={ISO8601}
```

#### Performance Analytics
```
GET /api/analytics/performance?startDate={ISO8601}&endDate={ISO8601}
```

#### Workflow Analytics
```
GET /api/analytics/workflows/{workflowId}/costs?startDate={ISO8601}&endDate={ISO8601}
```

### Date Parameter Format

**ISO 8601 Timestamps:**
```
startDate: "2025-12-01T00:00:00.000Z"
endDate: "2025-12-30T23:59:59.999Z"
```

**Behavior:**
- Optional parameters (backward compatible)
- If omitted, returns all data
- If provided, filters at database level

---

## 📊 Data Tracked

### Cost Metrics
- **Total Cost** - Sum of all LLM API costs
- **Total Tokens** - Input + output tokens
- **Total Executions** - Number of workflow runs
- **Avg Cost/Execution** - Cost efficiency metric
- **Cost by Model** - GPT-4, Claude, etc.
- **Cost by Workflow** - Which workflows cost most
- **Cost by Step** - Individual step costs

### Performance Metrics
- **Avg Duration** - Execution time per step
- **Success Rate** - % of successful executions
- **Failed Executions** - Count of failures
- **Slowest Steps** - Performance bottlenecks
- **Cost Efficiency** - Cost per successful execution

### Time Series
- **Daily Cost** - Cost trends over time
- **Daily Tokens** - Token usage trends
- **Daily Executions** - Activity trends

---

## 🎨 Color Scheme

**Primary Colors:**
- Blue: `#3B82F6` (buttons, headers, charts)
- Green: `#10B981` (success indicators)
- Orange: `#F59E0B` (warnings, performance)
- Red: `#EF4444` (errors, failures)
- Purple: `#8B5CF6` (accents)

**Neutral Colors:**
- Gray-50: `#F9FAFB` (backgrounds)
- Gray-100: `#F3F4F6` (light backgrounds)
- Gray-200: `#E5E7EB` (borders)
- Gray-300: `#D1D5DB` (disabled)
- Gray-500: `#6B7280` (text secondary)
- Gray-700: `#374151` (text primary)
- Gray-900: `#111827` (headings)

---

## 🌐 Browser Compatibility

**Minimum Versions:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Requirements:**
- JavaScript enabled
- LocalStorage enabled
- Canvas API support (for charts)

**Mobile Support:**
- Responsive layout
- Touch-friendly buttons
- Readable on tablets

---

## 🔒 Security & Privacy

### API Key Storage
- Stored in browser localStorage
- Never transmitted except in Authorization header
- Not logged or cached server-side

### Data Privacy
- All analytics data stays on your server
- No third-party analytics
- No external API calls except to your own server

### CORS
- Dashboard must be served from same origin as API
- Or configure CORS headers on server

---

## 🐛 Troubleshooting

### Dashboard Not Loading

**Symptom:** Blank page or loading forever

**Solutions:**
1. Check server is running: `npm start`
2. Verify URL: `http://localhost:3000/analytics.html`
3. Check browser console (F12) for errors
4. Clear browser cache and reload

---

### "API Error" Messages

**Symptom:** Red error boxes on dashboard

**Solutions:**
1. Verify API Key in Settings page
2. Check Base URL is correct
3. Ensure server is running
4. Check server logs for errors
5. Verify network connectivity

---

### No Data Displayed

**Symptom:** Charts and tables are empty

**Possible Causes:**
1. **No analytics data yet** - Run some workflows first
2. **Date filter too narrow** - Expand date range
3. **Database empty** - Check if sample data was generated

**Solutions:**
1. Change date filter to "Last 90 Days"
2. Generate sample data (if testing)
3. Execute some workflows to generate real data

---

### Export Buttons Not Working

**Symptom:** Click export button, nothing happens

**Solutions:**
1. Check browser console (F12) for JavaScript errors
2. Verify pop-up blocker isn't blocking downloads
3. Check browser download settings
4. Try different browser
5. Ensure data is loaded (wait for charts to render)

---

### PDF Charts Not Appearing

**Symptom:** PDF exports but charts are missing

**Possible Causes:**
1. Charts not fully rendered when export clicked
2. Canvas not captured correctly

**Solutions:**
1. Wait for all charts to fully load before exporting
2. Try exporting again after page fully loads
3. Check browser console for errors

---

## 📚 Additional Documentation

### Implementation Details
- `/tmp/DATE_FILTER_IMPLEMENTATION.md` - Date filtering technical docs
- `/tmp/CSV_EXPORT_IMPLEMENTATION.md` - CSV export technical docs
- `/tmp/PDF_EXPORT_IMPLEMENTATION.md` - PDF export technical docs

### User Guides
- `CSV_EXPORT_README.md` - Quick reference for CSV exports
- `/tmp/DATE_FILTER_VISUAL_GUIDE.md` - Visual guide for date filtering

---

## 🎉 What's Next?

### Suggested Enhancements

**Analytics Features:**
- Token usage by time of day
- Cost anomaly detection
- Budget alerts
- Cost forecasting

**Export Features:**
- Excel export with formulas
- Scheduled report emails
- Multiple date range comparison
- Custom report templates

**UI Improvements:**
- Dark mode
- Customizable dashboards
- Saved filter presets
- Real-time updates (WebSocket)

---

## 📞 Support

**Dashboard URL:** http://localhost:3000/analytics.html

**Issues:**
- Check server logs for backend errors
- Check browser console for frontend errors
- Verify API key and connectivity

**Documentation:**
- README files in project root
- API endpoint documentation in code
- Implementation guides in `/tmp/`

---

## ✨ Summary

The MCP Connect Analytics Dashboard provides:

✅ **Comprehensive Cost Tracking** - Know exactly what your LLM usage costs
✅ **Performance Insights** - Identify bottlenecks and optimize workflows
✅ **Flexible Date Filtering** - Analyze any time period
✅ **Multiple Export Formats** - CSV for analysis, PDF for reports
✅ **Professional Reporting** - Share insights with stakeholders
✅ **Real-time Data** - See up-to-date analytics

**Start tracking your LLM costs today:** http://localhost:3000/analytics.html
