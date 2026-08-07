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
import { ExceptionAnalyzer, ExceptionAnalysisResult } from '../../services/ExceptionAnalyzer';
import { ReportGenerator } from '../../services/ReportGenerator';
import { FlowDiagramTab } from './FlowDiagramTab';
import { JsonRange } from './flowJsonLocator';
import { ExceptionAnalysisTab } from './ExceptionAnalysisTab';
import { ApiActionsTab } from './ApiActionsTab';
import { InputAnalysisTab } from './InputAnalysisTab';

interface FlowAnalysisPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
  flowDefinition: string;
  flowName: string;
  /** Supplied by the host page so the diagram can jump the editor to a selection. */
  onRevealRange?: (range: JsonRange) => void;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: '#fff',
  marginBottom: '12px',
});

const metricCardStyles = (color: string) => mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  textAlign: 'center',
  backgroundColor: color,
  color: 'white',
  minWidth: '120px',
});

const getRatingBarColor = (rating: number): string => {
  if (rating >= 70) return '#107c10';
  if (rating >= 40) return '#ff8c00';
  return '#d13438';
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
  // Shared by the diagram and the Actions table so they stay in step.
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

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
    { key: 'complexity', name: 'Complexity', fieldName: 'Complexity', minWidth: 80, maxWidth: 100 },
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
        <Text style={{ color: item.used ? '#107c10' : '#d13438' }}>
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
        <Text style={{ color: item.named ? '#107c10' : '#ff8c00' }}>
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

    return (
      <Stack tokens={{ childrenGap: 16 }}>
        {/* Metrics Row */}
        <Stack horizontal tokens={{ childrenGap: 12 }} wrap>
          <div className={metricCardStyles(FlowAnalyzer.getComplexityColor(analysisResult.complexity))}>
            <Text variant="small" block>Complexity</Text>
            <Text variant="xxLarge" block>{analysisResult.complexity}</Text>
          </div>
          <div className={metricCardStyles(FlowAnalyzer.getActionCountColor(analysisResult.actionCount))}>
            <Text variant="small" block>Actions</Text>
            <Text variant="xxLarge" block>{analysisResult.actionCount}</Text>
          </div>
          <div className={metricCardStyles(FlowAnalyzer.getVariableCountColor(analysisResult.variableCount))}>
            <Text variant="small" block>Variables</Text>
            <Text variant="xxLarge" block>{analysisResult.variableCount}</Text>
          </div>
          <div className={metricCardStyles(analysisResult.exceptionCount > 0 ? '#107c10' : '#ff8c00')}>
            <Text variant="small" block>Exception Handlers</Text>
            <Text variant="xxLarge" block>{analysisResult.exceptionCount}</Text>
          </div>
        </Stack>

        {/* Overall Rating */}
        <div className={cardStyles}>
          <Text variant="large" block style={{ marginBottom: 8 }}>Overall Rating</Text>
          <ProgressIndicator
            percentComplete={analysisResult.overallRating / 100}
            barHeight={20}
            styles={{
              progressBar: {
                backgroundColor: getRatingBarColor(analysisResult.overallRating),
              },
            }}
          />
          <Text variant="xxLarge" style={{ color: getRatingBarColor(analysisResult.overallRating) }}>
            {analysisResult.overallRating}%
          </Text>

          <Stack horizontal tokens={{ childrenGap: 24 }} style={{ marginTop: 12 }}>
            <Text>
              Main Scope: {analysisResult.hasMainScope ? '✓' : '✗'}
            </Text>
            <Text>
              Exception Scope: {analysisResult.hasExceptionScope ? '✓' : '✗'}
            </Text>
            <Text>
              Variable Naming: {analysisResult.variableNamingScore}%
            </Text>
            <Text>
              Composes: {analysisResult.composesCount}
            </Text>
          </Stack>
        </div>

        {/* Trigger Info */}
        <div className={cardStyles}>
          <Text variant="large" block style={{ marginBottom: 8 }}>Trigger</Text>
          <Stack tokens={{ childrenGap: 4 }}>
            <Text><strong>Name:</strong> {analysisResult.trigger.name}</Text>
            <Text><strong>Type:</strong> {analysisResult.trigger.type}</Text>
            <Text><strong>Connector:</strong> {analysisResult.trigger.connector}</Text>
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
              <Text key={`err-${i}`} style={{ color: '#d13438' }} block>
                Error: {err}
              </Text>
            ))}
            {analysisResult.warnings.map((warn, i) => (
              <Text key={`warn-${i}`} style={{ color: '#ff8c00' }} block>
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
          // Picking a row here selects the same node on the Diagram tab.
          onActiveItemChanged={(item?: FlowAction) => {
            if (item) setSelectedAction(item.Name);
          }}
          onRenderRow={(props, defaultRender) => {
            if (!props || !defaultRender) return null;
            const isSelected = (props.item as FlowAction).Name === selectedAction;
            return defaultRender({
              ...props,
              styles: isSelected
                ? { root: { backgroundColor: '#eff6fc', borderLeft: '3px solid #0078d4' } }
                : undefined,
            });
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

  const renderDiagram = () => {
    if (!analysisResult) return null;
    return (
      <FlowDiagramTab
        actions={analysisResult.actions}
        trigger={analysisResult.trigger}
        flowDefinition={flowDefinition}
        flowName={flowName}
        selectedKey={selectedAction}
        onSelect={setSelectedAction}
        searchText={searchText}
        onRevealRange={onRevealRange}
      />
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
              <PivotItem headerText="Diagram" itemKey="diagram" />
              <PivotItem headerText="Exceptions" itemKey="exceptions" />
              <PivotItem headerText={`Actions (${analysisResult.actionCount})`} itemKey="actions" />
              <PivotItem headerText="API Actions" itemKey="apiActions" />
              <PivotItem headerText="Inputs" itemKey="inputs" />
              <PivotItem headerText={`Variables (${analysisResult.variableCount})`} itemKey="variables" />
              <PivotItem headerText={`Connections (${analysisResult.connections.length})`} itemKey="connections" />
            </Pivot>

            {selectedTab === 'overview' && renderOverview()}
            {selectedTab === 'diagram' && renderDiagram()}
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
