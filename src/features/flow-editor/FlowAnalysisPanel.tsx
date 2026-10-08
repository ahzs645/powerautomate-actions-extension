import { useState, useMemo } from 'react';
import { Stack } from '@fluentui/react/lib/Stack';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Text } from '@fluentui/react/lib/Text';
import { DetailsList, DetailsListLayoutMode, SelectionMode, IColumn } from '@fluentui/react/lib/DetailsList';
import { Pivot, PivotItem } from '@fluentui/react/lib/Pivot';
import { SearchBox } from '@fluentui/react/lib/SearchBox';
import { DefaultButton } from '@fluentui/react/lib/Button';
import { ProgressIndicator } from '@fluentui/react/lib/ProgressIndicator';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { FlowAnalyzer, FlowAnalysisResult, FlowVariable, FlowAction } from '../../services/FlowAnalyzer';
import { defaultRatingThresholds } from '../../config/AnalysisConfig';
import { MetricCard, MetricRow, MetricTone, toneFromRating } from './components/MetricCard';
import { ExceptionAnalyzer, ExceptionAnalysisResult } from '../../services/ExceptionAnalyzer';
import { ReportGenerator } from '../../services/ReportGenerator';
import { findActionRange, JsonRange } from './flowJsonLocator';
import { ExceptionAnalysisTab } from './ExceptionAnalysisTab';
import { ApiActionsTab } from './ApiActionsTab';
import { InputAnalysisTab } from './InputAnalysisTab';

interface FlowAnalysisPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
  flowDefinition: string;
  flowName: string;
  /** Supplied by the host page so a selected action can be shown in the editor. */
  onRevealRange?: (range: JsonRange) => void;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-sm)',
  backgroundColor: 'var(--color-bg-card)',
  color: 'var(--color-fg)',
  marginBottom: '12px',
});

const breakdownStyles = mergeStyles({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-fg)',
  selectors: {
    'th, td': { textAlign: 'left', padding: '4px 8px 4px 0', verticalAlign: 'top' },
    th: { color: 'var(--color-fg-secondary)', fontWeight: 600 },
    'td:last-child, th:last-child': { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
    'tr + tr td': { borderTop: '1px solid var(--color-stroke-subtle)' },
  },
});

const ratingTone = (rating: number): MetricTone =>
  rating >= 70 ? 'success' : rating >= 40 ? 'warning' : 'danger';

const TONE_COLOR: Record<MetricTone, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  accent: 'var(--color-accent)',
  neutral: 'var(--color-fg-secondary)',
};

export const FlowAnalysisPanel: React.FC<FlowAnalysisPanelProps> = ({
  isOpen,
  onDismiss,
  flowDefinition,
  flowName,
  onRevealRange,
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedTab, setSelectedTab] = useState('overview');

  const analysisResult = useMemo<FlowAnalysisResult | null>(() => {
    if (!flowDefinition || !isOpen) return null;

    try {
      const analyzer = new FlowAnalyzer();
      const parsed = JSON.parse(flowDefinition);
      return analyzer.analyze(parsed, flowName);
    } catch (error) {
      console.error('Analysis error:', error);
      return null;
    }
  }, [flowDefinition, flowName, isOpen]);

  // Exception analysis
  const exceptionResult = useMemo<ExceptionAnalysisResult | null>(() => {
    if (!analysisResult) return null;

    try {
      const exceptionAnalyzer = new ExceptionAnalyzer();
      return exceptionAnalyzer.analyze(analysisResult);
    } catch (error) {
      console.error('Exception analysis error:', error);
      return null;
    }
  }, [analysisResult]);

  const filteredActions = useMemo(() => {
    if (!analysisResult) return [];
    if (!searchText) return analysisResult.actions;

    const search = searchText.toLowerCase();
    return analysisResult.actions.filter(
      action =>
        action.Name.toLowerCase().includes(search) ||
        action.Type.toLowerCase().includes(search) ||
        action.connector.toLowerCase().includes(search)
    );
  }, [analysisResult, searchText]);

  const filteredVariables = useMemo(() => {
    if (!analysisResult) return [];
    if (!searchText) return analysisResult.variables;

    const search = searchText.toLowerCase();
    return analysisResult.variables.filter(
      v =>
        v.Name.toLowerCase().includes(search) ||
        v.Type.toLowerCase().includes(search)
    );
  }, [analysisResult, searchText]);

  const actionColumns: IColumn[] = [
    { key: 'name', name: 'Name', fieldName: 'Name', minWidth: 150, maxWidth: 250, isResizable: true },
    { key: 'type', name: 'Type', fieldName: 'Type', minWidth: 100, maxWidth: 150, isResizable: true },
    { key: 'connector', name: 'Connector', fieldName: 'connector', minWidth: 100, maxWidth: 200, isResizable: true },
    {
      key: 'complexity',
      name: 'Complexity',
      fieldName: 'Complexity',
      minWidth: 80,
      maxWidth: 100,
      // Scopes and Terminate are structural (-1 in the analyzer): nothing to show.
      onRender: (item: FlowAction) =>
        item.Complexity >= 0 ? item.Complexity : <span title="Structural - adds no complexity">—</span>,
    },
    { key: 'nested', name: 'Nested', fieldName: 'nested', minWidth: 60, maxWidth: 80 },
    { key: 'exception', name: 'Exception', fieldName: 'exception', minWidth: 80, maxWidth: 100 },
  ];

  const variableColumns: IColumn[] = [
    { key: 'name', name: 'Name', fieldName: 'Name', minWidth: 150, maxWidth: 250, isResizable: true },
    { key: 'type', name: 'Type', fieldName: 'Type', minWidth: 80, maxWidth: 120 },
    { key: 'value', name: 'Value', fieldName: 'value', minWidth: 150, maxWidth: 300, isResizable: true },
    {
      key: 'used',
      name: 'Used',
      fieldName: 'used',
      minWidth: 60,
      maxWidth: 80,
      onRender: (item: FlowVariable) => (
        <Text style={{ color: item.used ? 'var(--color-success)' : 'var(--color-danger)' }}>
          {item.used ? 'Yes' : 'No'}
        </Text>
      ),
    },
    {
      key: 'named',
      name: 'Named',
      fieldName: 'named',
      minWidth: 60,
      maxWidth: 80,
      onRender: (item: FlowVariable) => (
        <Text style={{ color: item.named ? 'var(--color-success)' : 'var(--color-fg)', fontWeight: item.named ? 400 : 600 }}>
          {item.named ? 'Yes' : 'No'}
        </Text>
      ),
    },
  ];

  const connectionColumns: IColumn[] = [
    { key: 'name', name: 'Name', fieldName: 'conName', minWidth: 150, maxWidth: 250, isResizable: true },
    { key: 'appId', name: 'API', fieldName: 'appId', minWidth: 150, maxWidth: 300, isResizable: true },
    { key: 'count', name: 'Usage Count', fieldName: 'count', minWidth: 80, maxWidth: 100 },
  ];

  const exportToCsv = (data: any[], filename: string) => {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row =>
        headers.map(header => {
          const value = String(row[header] || '');
          return `"${value.replace(/"/g, '""')}"`;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  };

  const exportHtmlReport = () => {
    if (!analysisResult) return;

    const reportGenerator = new ReportGenerator();
    reportGenerator.downloadReport(
      analysisResult,
      exceptionResult || undefined,
      `${flowName}-report.html`
    );
  };

  const renderOverview = () => {
    if (!analysisResult) return null;
    const t = defaultRatingThresholds;
    const tone = ratingTone(analysisResult.overallRating);
    const breakdown = analysisResult.ratingBreakdown || [];
    const missed = breakdown.filter((f) => f.points < f.max).sort((a, b) => b.max - b.points - (a.max - a.points));

    return (
      <Stack tokens={{ childrenGap: 16 }}>
        {/* Each card is coloured by its own threshold, shown underneath */}
        <MetricRow label="Flow metrics">
          <MetricCard
            label="Complexity"
            value={analysisResult.complexity}
            tone={toneFromRating(FlowAnalyzer.getComplexityColor(analysisResult.complexity))}
            hint={`Green ≤ ${t.complexityAmber}, red > ${t.complexityRed}`}
          />
          <MetricCard
            label="Actions"
            value={analysisResult.actionCount}
            tone={toneFromRating(FlowAnalyzer.getActionCountColor(analysisResult.actionCount))}
            hint={`Green ≤ ${t.actionsAmber}, red > ${t.actionsRed}`}
          />
          <MetricCard
            label="Variables"
            value={analysisResult.variableCount}
            tone={toneFromRating(FlowAnalyzer.getVariableCountColor(analysisResult.variableCount))}
            hint={`Green ≤ ${t.variablesAmber}, red > ${t.variablesRed}`}
          />
          <MetricCard
            label="Exception handlers"
            value={analysisResult.exceptionCount}
            tone={analysisResult.exceptionCount > 0 ? 'success' : 'warning'}
            hint="Actions that run after a failure"
          />
          <MetricCard
            label="Overall rating"
            value={`${analysisResult.overallRating}%`}
            tone={tone}
            hint="Green ≥ 70%, amber ≥ 40%"
          />
        </MetricRow>

        {/* Overall Rating, explained */}
        <div className={cardStyles}>
          <Text variant="large" block style={{ marginBottom: 4 }}>Overall rating</Text>
          <Text block style={{ color: 'var(--color-fg-secondary)', marginBottom: 8 }}>
            The share of best-practice points this flow earns. Each line below is scored on its own;
            the rating is the points earned out of the points available.
          </Text>
          <ProgressIndicator
            percentComplete={analysisResult.overallRating / 100}
            barHeight={8}
            ariaValueText={`${analysisResult.overallRating}%`}
            styles={{ progressBar: { backgroundColor: TONE_COLOR[tone] } }}
          />
          {missed.length > 0 && (
            <Text block style={{ margin: '8px 0' }}>
              <strong>Biggest gains:</strong>{' '}
              {missed
                .slice(0, 3)
                .map((f) => `${f.label.toLowerCase()} (+${f.max - f.points})`)
                .join(', ')}
              .
            </Text>
          )}
          {breakdown.length > 0 && (
            <table className={breakdownStyles}>
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Result</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((factor) => (
                  <tr key={factor.key}>
                    <td>{factor.label}</td>
                    <td style={{ color: 'var(--color-fg-secondary)' }}>{factor.detail}</td>
                    <td>
                      {factor.points} / {factor.max}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Trigger Info */}
        <div className={cardStyles}>
          <Text variant="large" block style={{ marginBottom: 8 }}>Trigger</Text>
          <Stack tokens={{ childrenGap: 4 }}>
            <Text><strong>Name:</strong> {analysisResult.trigger.name || '—'}</Text>
            <Text><strong>Type:</strong> {analysisResult.trigger.type || '—'}</Text>
            <Text><strong>Connector:</strong> {analysisResult.trigger.connector || '—'}</Text>
            {analysisResult.trigger.recurrence && (
              <Text><strong>Recurrence:</strong> {analysisResult.trigger.recurrence}</Text>
            )}
          </Stack>
        </div>

        {/* Errors & Warnings */}
        {(analysisResult.errors.length > 0 || analysisResult.warnings.length > 0) && (
          <div className={cardStyles}>
            <Text variant="large" block style={{ marginBottom: 8 }}>Issues</Text>
            {analysisResult.errors.map((err, i) => (
              <Text key={`err-${i}`} style={{ color: 'var(--color-danger)' }} block>
                Error: {err}
              </Text>
            ))}
            {analysisResult.warnings.map((warn, i) => (
              <Text key={`warn-${i}`} block>
                Warning: {warn}
              </Text>
            ))}
          </div>
        )}
      </Stack>
    );
  };

  const renderActions = () => {
    if (!analysisResult) return null;

    return (
      <Stack tokens={{ childrenGap: 12 }}>
        <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center">
          <SearchBox
            placeholder="Filter actions..."
            value={searchText}
            onChange={(_, value) => setSearchText(value || '')}
            styles={{ root: { width: 300 } }}
          />
          <DefaultButton
            iconProps={{ iconName: 'Download' }}
            text="Export CSV"
            onClick={() => exportToCsv(analysisResult.actions, `${flowName}-actions`)}
          />
        </Stack>
        <DetailsList
          items={filteredActions}
          columns={actionColumns}
          layoutMode={DetailsListLayoutMode.justified}
          selectionMode={SelectionMode.none}
          isHeaderVisible={true}
          // Double-click or Enter on a row shows that action in the editor.
          onItemInvoked={(item?: FlowAction) => {
            const range = item && onRevealRange && findActionRange(flowDefinition, item.Name);
            if (range) onRevealRange!(range);
          }}
        />
      </Stack>
    );
  };

  const renderVariables = () => {
    if (!analysisResult) return null;

    return (
      <Stack tokens={{ childrenGap: 12 }}>
        <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center">
          <SearchBox
            placeholder="Filter variables..."
            value={searchText}
            onChange={(_, value) => setSearchText(value || '')}
            styles={{ root: { width: 300 } }}
          />
          <DefaultButton
            iconProps={{ iconName: 'Download' }}
            text="Export CSV"
            onClick={() => exportToCsv(analysisResult.variables, `${flowName}-variables`)}
          />
        </Stack>
        <DetailsList
          items={filteredVariables}
          columns={variableColumns}
          layoutMode={DetailsListLayoutMode.justified}
          selectionMode={SelectionMode.none}
          isHeaderVisible={true}
        />
      </Stack>
    );
  };

  const renderConnections = () => {
    if (!analysisResult) return null;

    return (
      <Stack tokens={{ childrenGap: 12 }}>
        <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center">
          <DefaultButton
            iconProps={{ iconName: 'Download' }}
            text="Export CSV"
            onClick={() => exportToCsv(analysisResult.connections, `${flowName}-connections`)}
          />
        </Stack>
        <DetailsList
          items={analysisResult.connections}
          columns={connectionColumns}
          layoutMode={DetailsListLayoutMode.justified}
          selectionMode={SelectionMode.none}
          isHeaderVisible={true}
        />
      </Stack>
    );
  };

  return (
    <Panel
      isOpen={isOpen}
      onDismiss={onDismiss}
      type={PanelType.large}
      headerText={`Flow Analysis: ${flowName}`}
      closeButtonAriaLabel="Close"
      onRenderFooterContent={() => (
        <Stack horizontal tokens={{ childrenGap: 12 }}>
          <DefaultButton
            iconProps={{ iconName: 'FileHTML' }}
            text="Export HTML Report"
            onClick={exportHtmlReport}
            disabled={!analysisResult}
          />
          <DefaultButton text="Close" onClick={onDismiss} />
        </Stack>
      )}
      isFooterAtBottom={true}
    >
      <Stack tokens={{ childrenGap: 16, padding: 16 }}>
        {!analysisResult ? (
          <Text>Unable to analyze flow definition.</Text>
        ) : (
          <>
            <Pivot
              selectedKey={selectedTab}
              onLinkClick={(item) => {
                setSelectedTab(item?.props.itemKey || 'overview');
                setSearchText('');
              }}
              styles={{ root: { marginBottom: 8 } }}
            >
              <PivotItem headerText="Overview" itemKey="overview" />
              <PivotItem headerText="Exceptions" itemKey="exceptions" />
              <PivotItem headerText={`Actions (${analysisResult.actionCount})`} itemKey="actions" />
              <PivotItem headerText="API Actions" itemKey="apiActions" />
              <PivotItem headerText="Inputs" itemKey="inputs" />
              <PivotItem headerText={`Variables (${analysisResult.variableCount})`} itemKey="variables" />
              <PivotItem headerText={`Connections (${analysisResult.connections.length})`} itemKey="connections" />
            </Pivot>

            {selectedTab === 'overview' && renderOverview()}
            {selectedTab === 'exceptions' && exceptionResult && (
              <ExceptionAnalysisTab exceptionResult={exceptionResult} />
            )}
            {selectedTab === 'actions' && renderActions()}
            {selectedTab === 'apiActions' && (
              <ApiActionsTab
                actions={analysisResult.actions}
                onExportCsv={(data, filename) => exportToCsv(data, `${flowName}-${filename}`)}
              />
            )}
            {selectedTab === 'inputs' && (
              <InputAnalysisTab
                actions={analysisResult.actions}
                onExportCsv={(data, filename) => exportToCsv(data, `${flowName}-${filename}`)}
              />
            )}
            {selectedTab === 'variables' && renderVariables()}
            {selectedTab === 'connections' && renderConnections()}
          </>
        )}
      </Stack>
    </Panel>
  );
};

export default FlowAnalysisPanel;
