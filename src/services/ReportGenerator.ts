// ReportGenerator - Generates self-contained HTML reports for flow analysis
// Ported from AutoReview extension

import { FlowAnalysisResult, FlowAnalyzer } from './FlowAnalyzer';
import { ExceptionAnalysisResult, ExceptionAnalyzer } from './ExceptionAnalyzer';

export class ReportGenerator {
  /**
   * Generate a self-contained HTML report
   */
  generateHtmlReport(
    analysisResult: FlowAnalysisResult,
    exceptionResult?: ExceptionAnalysisResult
  ): string {
    const date = new Date().toLocaleDateString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow Analysis Report - ${this.escapeHtml(analysisResult.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      color: #323130;
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #0078d4, #106ebe);
      color: white;
      padding: 32px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header .meta { opacity: 0.9; font-size: 14px; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .card h2 {
      font-size: 18px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #f0f0f0;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric {
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      color: white;
    }
    .metric-value { font-size: 36px; font-weight: 700; }
    .metric-label { font-size: 12px; text-transform: uppercase; opacity: 0.9; }
    .metric.green { background: #107c10; }
    .metric.orange { background: #ff8c00; }
    .metric.red { background: #d13438; }
    .metric.blue { background: #0078d4; }
    .progress-container {
      background: #f0f0f0;
      border-radius: 4px;
      height: 24px;
      overflow: hidden;
      margin: 12px 0;
    }
    .progress-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .rating-value {
      font-size: 48px;
      font-weight: 700;
      margin-top: 8px;
    }
    .check-item {
      display: flex;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .check-item:last-child { border-bottom: none; }
    .check-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;
      font-weight: bold;
      font-size: 14px;
    }
    .check-icon.pass { background: #dff6dd; color: #107c10; }
    .check-icon.fail { background: #fde7e9; color: #d13438; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #f0f0f0;
    }
    th {
      background: #fafafa;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      color: #605e5c;
    }
    tr:hover { background: #fafafa; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge.fail { background: #fde7e9; color: #d13438; }
    .badge.warning { background: #fff4ce; color: #8a6914; }
    .badge.info { background: #deecf9; color: #0078d4; }
    .badge.yes { background: #dff6dd; color: #107c10; }
    .badge.no { background: #f0f0f0; color: #605e5c; }
    .footer {
      text-align: center;
      padding: 24px;
      color: #605e5c;
      font-size: 12px;
    }
    @media print {
      body { background: white; padding: 0; }
      .card { box-shadow: none; border: 1px solid #e0e0e0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${this.escapeHtml(analysisResult.name)}</h1>
      <div class="meta">
        <span>Generated: ${date}</span>
        ${analysisResult.id ? ` | Flow ID: ${this.escapeHtml(analysisResult.id)}` : ''}
      </div>
    </div>

    <!-- Metrics -->
    <div class="metrics">
      <div class="metric ${this.getColorClass(FlowAnalyzer.getComplexityColor(analysisResult.complexity))}">
        <div class="metric-value">${analysisResult.complexity}</div>
        <div class="metric-label">Complexity</div>
      </div>
      <div class="metric ${this.getColorClass(FlowAnalyzer.getActionCountColor(analysisResult.actionCount))}">
        <div class="metric-value">${analysisResult.actionCount}</div>
        <div class="metric-label">Actions</div>
      </div>
      <div class="metric ${this.getColorClass(FlowAnalyzer.getVariableCountColor(analysisResult.variableCount))}">
        <div class="metric-value">${analysisResult.variableCount}</div>
        <div class="metric-label">Variables</div>
      </div>
      <div class="metric ${analysisResult.exceptionCount > 0 ? 'green' : 'orange'}">
        <div class="metric-value">${analysisResult.exceptionCount}</div>
        <div class="metric-label">Exception Handlers</div>
      </div>
    </div>

    <!-- Overall Rating -->
    <div class="card">
      <h2>Overall Quality Rating</h2>
      <div class="progress-container">
        <div class="progress-bar" style="width: ${analysisResult.overallRating}%; background: ${this.getRatingColor(analysisResult.overallRating)};"></div>
      </div>
      <div class="rating-value" style="color: ${this.getRatingColor(analysisResult.overallRating)}">
        ${analysisResult.overallRating}%
      </div>
      <div style="margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
        <div class="check-item">
          <div class="check-icon ${analysisResult.hasMainScope ? 'pass' : 'fail'}">${analysisResult.hasMainScope ? '✓' : '✗'}</div>
          <span>Main Scope</span>
        </div>
        <div class="check-item">
          <div class="check-icon ${analysisResult.hasExceptionScope ? 'pass' : 'fail'}">${analysisResult.hasExceptionScope ? '✓' : '✗'}</div>
          <span>Exception Scope</span>
        </div>
        <div class="check-item">
          <div class="check-icon ${analysisResult.variableNamingScore >= 80 ? 'pass' : 'fail'}">${analysisResult.variableNamingScore}%</div>
          <span>Naming Convention</span>
        </div>
      </div>
    </div>

    <!-- Trigger Details -->
    <div class="card">
      <h2>Trigger Information</h2>
      <table>
        <tr><td style="width: 150px;"><strong>Name</strong></td><td>${this.escapeHtml(analysisResult.trigger.name)}</td></tr>
        <tr><td><strong>Type</strong></td><td>${this.escapeHtml(analysisResult.trigger.type)}</td></tr>
        <tr><td><strong>Connector</strong></td><td>${this.escapeHtml(analysisResult.trigger.connector)}</td></tr>
        ${analysisResult.trigger.recurrence ? `<tr><td><strong>Recurrence</strong></td><td><code>${this.escapeHtml(analysisResult.trigger.recurrence)}</code></td></tr>` : ''}
        ${analysisResult.trigger.operationId ? `<tr><td><strong>Operation</strong></td><td>${this.escapeHtml(analysisResult.trigger.operationId)}</td></tr>` : ''}
      </table>
    </div>

    ${exceptionResult ? this.renderExceptionSection(exceptionResult) : ''}

    <!-- Actions Table -->
    <div class="card">
      <h2>Actions (${analysisResult.actionCount})</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Connector</th>
            <th>Complexity</th>
            <th>Nested</th>
            <th>Exception</th>
          </tr>
        </thead>
        <tbody>
          ${analysisResult.actions.slice(0, 50).map(action => `
            <tr>
              <td>${this.escapeHtml(action.Name)}</td>
              <td>${this.escapeHtml(action.Type)}</td>
              <td>${this.escapeHtml(action.connector)}</td>
              <td>${action.Complexity}</td>
              <td>${action.nested}</td>
              <td><span class="badge ${action.exception === 'Yes' ? 'yes' : 'no'}">${action.exception}</span></td>
            </tr>
          `).join('')}
          ${analysisResult.actions.length > 50 ? `<tr><td colspan="6" style="text-align: center; color: #605e5c;">... and ${analysisResult.actions.length - 50} more actions</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    <!-- Variables Table -->
    ${analysisResult.variables.length > 0 ? `
    <div class="card">
      <h2>Variables (${analysisResult.variableCount})</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Used</th>
            <th>Naming</th>
          </tr>
        </thead>
        <tbody>
          ${analysisResult.variables.map(v => `
            <tr>
              <td>${this.escapeHtml(v.Name)}</td>
              <td>${this.escapeHtml(v.Type)}</td>
              <td><span class="badge ${v.used ? 'yes' : 'warning'}">${v.used ? 'Yes' : 'No'}</span></td>
              <td><span class="badge ${v.named ? 'yes' : 'warning'}">${v.named ? 'Yes' : 'No'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- Connections Table -->
    ${analysisResult.connections.length > 0 ? `
    <div class="card">
      <h2>Connections (${analysisResult.connections.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>API</th>
            <th>Usage</th>
          </tr>
        </thead>
        <tbody>
          ${analysisResult.connections.map(c => `
            <tr>
              <td>${this.escapeHtml(c.conName)}</td>
              <td>${this.escapeHtml(c.appId)}</td>
              <td>${c.count}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <div class="footer">
      Generated by Power Automate Toolkit | ${date}
    </div>
  </div>
</body>
</html>`;
  }

  private renderExceptionSection(exceptionResult: ExceptionAnalysisResult): string {
    return `
    <div class="card">
      <h2>Exception Handling Analysis</h2>
      <div style="margin-bottom: 16px;">
        <div class="progress-container" style="height: 16px;">
          <div class="progress-bar" style="width: ${exceptionResult.score}%; background: ${ExceptionAnalyzer.getScoreColor(exceptionResult.score)};"></div>
        </div>
        <div style="font-size: 24px; font-weight: 700; color: ${ExceptionAnalyzer.getScoreColor(exceptionResult.score)}; margin-top: 8px;">
          Exception Score: ${exceptionResult.score}%
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 16px;">
        <div class="check-item">
          <div class="check-icon ${exceptionResult.hasMainScope ? 'pass' : 'fail'}">${exceptionResult.hasMainScope ? '✓' : '✗'}</div>
          <span>Main Scope: ${exceptionResult.mainScopeName || 'Missing'}</span>
        </div>
        <div class="check-item">
          <div class="check-icon ${exceptionResult.hasExceptionScope ? 'pass' : 'fail'}">${exceptionResult.hasExceptionScope ? '✓' : '✗'}</div>
          <span>Exception Scope: ${exceptionResult.exceptionScopeName || 'Missing'}</span>
        </div>
        <div class="check-item">
          <div class="check-icon ${exceptionResult.hasTerminateInException ? 'pass' : 'fail'}">${exceptionResult.hasTerminateInException ? '✓' : '✗'}</div>
          <span>Terminate in Exception</span>
        </div>
      </div>

      ${exceptionResult.issues.length > 0 ? `
      <h3 style="font-size: 14px; margin: 16px 0 8px;">Issues (${exceptionResult.issues.length})</h3>
      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>Area</th>
            <th>Item</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${exceptionResult.issues.map(issue => `
            <tr>
              <td><span class="badge ${issue.level}">${issue.level.toUpperCase()}</span></td>
              <td>${this.escapeHtml(issue.area)}</td>
              <td>${this.escapeHtml(issue.value)}</td>
              <td>${this.escapeHtml(issue.reason)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : '<p style="color: #107c10;">No issues found!</p>'}
    </div>
    `;
  }

  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getColorClass(color: string): string {
    switch (color) {
      case 'green': return 'green';
      case 'orange': return 'orange';
      case 'red': return 'red';
      default: return 'blue';
    }
  }

  private getRatingColor(rating: number): string {
    if (rating >= 70) return '#107c10';
    if (rating >= 40) return '#ff8c00';
    return '#d13438';
  }

  /**
   * Download the report as an HTML file
   */
  downloadReport(
    analysisResult: FlowAnalysisResult,
    exceptionResult?: ExceptionAnalysisResult,
    filename?: string
  ): void {
    const html = this.generateHtmlReport(analysisResult, exceptionResult);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename || `${analysisResult.name}-report.html`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

export default ReportGenerator;
