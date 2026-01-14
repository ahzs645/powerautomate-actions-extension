import React, { useState, useCallback } from 'react';
import {
  Panel,
  PanelType,
  Stack,
  Text,
  DetailsList,
  DetailsListLayoutMode,
  SelectionMode,
  IColumn,
  MessageBar,
  MessageBarType,
  PrimaryButton,
  ProgressIndicator,
  mergeStyles,
  Icon,
  Pivot,
  PivotItem,
} from '@fluentui/react';
import {
  SolutionAnalyzer,
  SolutionAnalysisResult,
  SolutionFlow,
  SolutionConnection,
  SolutionEnvironmentVariable,
  SolutionDependency,
} from '../../services/SolutionAnalyzer';

interface SolutionAnalysisPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: '#fff',
  marginBottom: '12px',
});

const metricStyles = (color: string) =>
  mergeStyles({
    padding: '12px 16px',
    borderRadius: '8px',
    backgroundColor: color,
    color: '#fff',
    textAlign: 'center',
    minWidth: '100px',
  });

const uploadAreaStyles = mergeStyles({
  border: '2px dashed #0078d4',
  borderRadius: '8px',
  padding: '32px',
  textAlign: 'center',
  backgroundColor: '#f0f6ff',
  cursor: 'pointer',
  transition: 'all 0.2s',
  ':hover': {
    backgroundColor: '#deecf9',
    borderColor: '#106ebe',
  },
});

export const SolutionAnalysisPanel: React.FC<SolutionAnalysisPanelProps> = ({
  isOpen,
  onDismiss,
}) => {
  const [analysisResult, setAnalysisResult] = useState<SolutionAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      setError('Please upload a .zip solution file');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const analyzer = new SolutionAnalyzer();
      const result = await analyzer.analyzeSolution(file);
      setAnalysisResult(result);
    } catch (err) {
      console.error('Error analyzing solution:', err);
      setError(`Failed to analyze solution: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      setError('Please upload a .zip solution file');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const analyzer = new SolutionAnalyzer();
      const result = await analyzer.analyzeSolution(file);
      setAnalysisResult(result);
    } catch (err) {
      console.error('Error analyzing solution:', err);
      setError(`Failed to analyze solution: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setAnalysisResult(null);
    setError(null);
  }, []);

  const flowColumns: IColumn[] = [
    {
      key: 'name',
      name: 'Flow Name',
      fieldName: 'displayName',
      minWidth: 200,
      maxWidth: 300,
      isResizable: true,
    },
    {
      key: 'actions',
      name: 'Actions',
      minWidth: 80,
      maxWidth: 100,
      onRender: (item: SolutionFlow) => (
        <Text>{item.analysis?.actionCount || '-'}</Text>
      ),
    },
    {
      key: 'complexity',
      name: 'Complexity',
      minWidth: 80,
      maxWidth: 100,
      onRender: (item: SolutionFlow) => (
        <Text>{item.analysis?.complexity || '-'}</Text>
      ),
    },
    {
      key: 'rating',
      name: 'Rating',
      minWidth: 80,
      maxWidth: 100,
      onRender: (item: SolutionFlow) => (
        <Text
          styles={{
            root: {
              color: getRatingColor(item.analysis?.overallRating || 0),
              fontWeight: 600,
            },
          }}
        >
          {item.analysis ? `${item.analysis.overallRating}%` : '-'}
        </Text>
      ),
    },
    {
      key: 'issues',
      name: 'Issues',
      minWidth: 80,
      maxWidth: 100,
      onRender: (item: SolutionFlow) => {
        const failCount = item.exceptionAnalysis?.issues.filter((i) => i.level === 'fail').length || 0;
        return (
          <Text styles={{ root: { color: failCount > 0 ? '#d13438' : '#107c10' } }}>
            {failCount > 0 ? failCount : 'None'}
          </Text>
        );
      },
    },
  ];

  const connectionColumns: IColumn[] = [
    {
      key: 'displayName',
      name: 'Connection',
      fieldName: 'displayName',
      minWidth: 150,
      maxWidth: 250,
      isResizable: true,
    },
    {
      key: 'connectorId',
      name: 'Connector ID',
      fieldName: 'connectorId',
      minWidth: 200,
      maxWidth: 400,
      isResizable: true,
    },
    {
      key: 'customizable',
      name: 'Customizable',
      minWidth: 100,
      maxWidth: 120,
      onRender: (item: SolutionConnection) => (
        <Icon
          iconName={item.isCustomizable ? 'CheckMark' : 'Cancel'}
          styles={{ root: { color: item.isCustomizable ? '#107c10' : '#605e5c' } }}
        />
      ),
    },
  ];

  const envVarColumns: IColumn[] = [
    {
      key: 'displayName',
      name: 'Variable',
      fieldName: 'displayName',
      minWidth: 150,
      maxWidth: 250,
      isResizable: true,
    },
    {
      key: 'type',
      name: 'Type',
      fieldName: 'type',
      minWidth: 100,
      maxWidth: 150,
    },
    {
      key: 'defaultValue',
      name: 'Default Value',
      fieldName: 'defaultValue',
      minWidth: 150,
      maxWidth: 250,
      isResizable: true,
      onRender: (item: SolutionEnvironmentVariable) => (
        <Text styles={{ root: { fontFamily: 'Consolas, monospace', fontSize: 12 } }}>
          {item.defaultValue || '-'}
        </Text>
      ),
    },
  ];

  const dependencyColumns: IColumn[] = [
    {
      key: 'displayName',
      name: 'Missing Dependency',
      fieldName: 'displayName',
      minWidth: 200,
      maxWidth: 300,
      isResizable: true,
    },
    {
      key: 'type',
      name: 'Type',
      fieldName: 'type',
      minWidth: 100,
      maxWidth: 150,
    },
    {
      key: 'dependentComponent',
      name: 'Required By',
      fieldName: 'dependentComponent',
      minWidth: 150,
      maxWidth: 250,
      isResizable: true,
    },
  ];

  return (
    <Panel
      isOpen={isOpen}
      onDismiss={onDismiss}
      type={PanelType.large}
      headerText="Solution Analysis"
      closeButtonAriaLabel="Close"
    >
      <Stack tokens={{ childrenGap: 16, padding: 16 }}>
        {/* Upload Area */}
        {!analysisResult && !isAnalyzing && (
          <>
            <MessageBar messageBarType={MessageBarType.info}>
              Upload a Power Automate solution package (.zip) to analyze all flows within the solution.
            </MessageBar>

            <div
              className={uploadAreaStyles}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => document.getElementById('solution-file-input')?.click()}
            >
              <Icon
                iconName="CloudUpload"
                styles={{ root: { fontSize: 48, color: '#0078d4', marginBottom: 12 } }}
              />
              <Text variant="large" block styles={{ root: { marginBottom: 8 } }}>
                Drag & drop a solution .zip file here
              </Text>
              <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
                or click to browse
              </Text>
              <input
                id="solution-file-input"
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>
          </>
        )}

        {/* Loading */}
        {isAnalyzing && (
          <div className={cardStyles}>
            <ProgressIndicator label="Analyzing solution..." description="This may take a moment for large solutions" />
          </div>
        )}

        {/* Error */}
        {error && (
          <MessageBar messageBarType={MessageBarType.error} onDismiss={() => setError(null)}>
            {error}
          </MessageBar>
        )}

        {/* Results */}
        {analysisResult && (
          <>
            {/* Solution Header */}
            <div className={cardStyles} style={{ background: 'linear-gradient(135deg, #0078d4, #106ebe)' }}>
              <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
                <Stack>
                  <Text variant="xLarge" styles={{ root: { color: '#fff', fontWeight: 600 } }}>
                    {analysisResult.name}
                  </Text>
                  <Text styles={{ root: { color: 'rgba(255,255,255,0.9)' } }}>
                    Version {analysisResult.version} | Publisher: {analysisResult.publisher}
                  </Text>
                </Stack>
                <PrimaryButton
                  iconProps={{ iconName: 'Clear' }}
                  text="Clear"
                  onClick={handleClear}
                  styles={{ root: { backgroundColor: 'rgba(255,255,255,0.2)' } }}
                />
              </Stack>
            </div>

            {/* Aggregate Metrics */}
            <Stack horizontal tokens={{ childrenGap: 12 }} wrap>
              <div className={metricStyles('#0078d4')}>
                <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                  {analysisResult.aggregateMetrics.totalFlows}
                </Text>
                <Text variant="small" styles={{ root: { color: '#fff' } }}>
                  Flows
                </Text>
              </div>
              <div className={metricStyles('#107c10')}>
                <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                  {analysisResult.aggregateMetrics.totalActions}
                </Text>
                <Text variant="small" styles={{ root: { color: '#fff' } }}>
                  Total Actions
                </Text>
              </div>
              <div className={metricStyles('#ff8c00')}>
                <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                  {analysisResult.aggregateMetrics.averageComplexity}
                </Text>
                <Text variant="small" styles={{ root: { color: '#fff' } }}>
                  Avg Complexity
                </Text>
              </div>
              <div className={metricStyles(getRatingColor(analysisResult.aggregateMetrics.averageRating))}>
                <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                  {analysisResult.aggregateMetrics.averageRating}%
                </Text>
                <Text variant="small" styles={{ root: { color: '#fff' } }}>
                  Avg Rating
                </Text>
              </div>
              <div className={metricStyles('#8764b8')}>
                <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                  {analysisResult.aggregateMetrics.totalConnections}
                </Text>
                <Text variant="small" styles={{ root: { color: '#fff' } }}>
                  Connections
                </Text>
              </div>
              {analysisResult.aggregateMetrics.flowsWithIssues > 0 && (
                <div className={metricStyles('#d13438')}>
                  <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                    {analysisResult.aggregateMetrics.flowsWithIssues}
                  </Text>
                  <Text variant="small" styles={{ root: { color: '#fff' } }}>
                    Flows with Issues
                  </Text>
                </div>
              )}
            </Stack>

            {/* Tabs */}
            <Pivot>
              <PivotItem headerText={`Flows (${analysisResult.flows.length})`} itemIcon="Flow">
                <div className={cardStyles}>
                  {analysisResult.flows.length > 0 ? (
                    <DetailsList
                      items={analysisResult.flows}
                      columns={flowColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible={true}
                      compact
                    />
                  ) : (
                    <MessageBar>No flows found in this solution.</MessageBar>
                  )}
                </div>
              </PivotItem>

              <PivotItem headerText={`Connections (${analysisResult.connections.length})`} itemIcon="PlugConnected">
                <div className={cardStyles}>
                  {analysisResult.connections.length > 0 ? (
                    <DetailsList
                      items={analysisResult.connections}
                      columns={connectionColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible={true}
                      compact
                    />
                  ) : (
                    <MessageBar>No connection references found in this solution.</MessageBar>
                  )}
                </div>
              </PivotItem>

              <PivotItem headerText={`Environment Variables (${analysisResult.environmentVariables.length})`} itemIcon="Variable">
                <div className={cardStyles}>
                  {analysisResult.environmentVariables.length > 0 ? (
                    <DetailsList
                      items={analysisResult.environmentVariables}
                      columns={envVarColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible={true}
                      compact
                    />
                  ) : (
                    <MessageBar>No environment variables found in this solution.</MessageBar>
                  )}
                </div>
              </PivotItem>

              {analysisResult.missingDependencies.length > 0 && (
                <PivotItem headerText={`Missing Dependencies (${analysisResult.missingDependencies.length})`} itemIcon="Warning">
                  <div className={cardStyles}>
                    <MessageBar messageBarType={MessageBarType.warning} styles={{ root: { marginBottom: 12 } }}>
                      This solution has missing dependencies that need to be resolved before import.
                    </MessageBar>
                    <DetailsList
                      items={analysisResult.missingDependencies}
                      columns={dependencyColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible={true}
                      compact
                    />
                  </div>
                </PivotItem>
              )}
            </Pivot>
          </>
        )}
      </Stack>
    </Panel>
  );
};

function getRatingColor(rating: number): string {
  if (rating >= 70) return '#107c10';
  if (rating >= 40) return '#ff8c00';
  return '#d13438';
}

export default SolutionAnalysisPanel;
