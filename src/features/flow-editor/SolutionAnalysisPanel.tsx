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
  FlowDependencyGraph,
  MissingChildFlow,
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
  const [flowDependencyGraph, setFlowDependencyGraph] = useState<FlowDependencyGraph | null>(null);
  const [missingChildFlows, setMissingChildFlows] = useState<MissingChildFlow[]>([]);

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

      // Extract flow dependencies
      const depGraph = analyzer.extractFlowDependencies(result.flows);
      setFlowDependencyGraph(depGraph);

      // Detect missing child flows
      const missingFlows = analyzer.detectMissingChildFlows(result.flows);
      setMissingChildFlows(missingFlows);
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

      // Extract flow dependencies
      const depGraph = analyzer.extractFlowDependencies(result.flows);
      setFlowDependencyGraph(depGraph);

      // Detect missing child flows
      const missingFlows = analyzer.detectMissingChildFlows(result.flows);
      setMissingChildFlows(missingFlows);
    } catch (err) {
      console.error('Error analyzing solution:', err);
      setError(`Failed to analyze solution: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setAnalysisResult(null);
    setFlowDependencyGraph(null);
    setMissingChildFlows([]);
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

  const missingChildFlowColumns: IColumn[] = [
    {
      key: 'flowId',
      name: 'Flow ID',
      fieldName: 'flowId',
      minWidth: 150,
      maxWidth: 250,
      isResizable: true,
      onRender: (item: MissingChildFlow) => (
        <Text styles={{ root: { fontFamily: 'Consolas, monospace', fontSize: 11 } }}>
          {item.flowDisplayName || item.flowId}
        </Text>
      ),
    },
    {
      key: 'referencedBy',
      name: 'Referenced By',
      minWidth: 150,
      maxWidth: 300,
      isResizable: true,
      onRender: (item: MissingChildFlow) => (
        <Text>{item.referencedBy.join(', ')}</Text>
      ),
    },
    {
      key: 'actionNames',
      name: 'Action Names',
      minWidth: 150,
      maxWidth: 250,
      onRender: (item: MissingChildFlow) => (
        <Text styles={{ root: { fontFamily: 'Consolas, monospace', fontSize: 11 } }}>
          {item.actionNames.join(', ')}
        </Text>
      ),
    },
  ];

  // Generate SVG for flow dependency diagram
  const generateFlowDependencySvg = useCallback(() => {
    if (!flowDependencyGraph || flowDependencyGraph.nodes.length === 0) {
      return '<p style="color: #666; padding: 20px;">No flow dependencies found.</p>';
    }

    const nodeWidth = 180;
    const nodeHeight = 50;
    const horizontalGap = 100;
    const verticalGap = 80;
    const padding = 40;

    // Simple layout: arrange nodes in rows based on dependency depth
    const nodePositions = new Map<string, { x: number; y: number }>();
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();

    // Calculate in-degree for each node
    flowDependencyGraph.nodes.forEach(node => {
      inDegree.set(node.id, 0);
    });
    flowDependencyGraph.edges.forEach(edge => {
      const current = inDegree.get(edge.targetFlowName) || 0;
      inDegree.set(edge.targetFlowName, current + 1);
    });

    // Find root nodes (no incoming edges)
    const rootNodes = flowDependencyGraph.nodes.filter(
      node => (inDegree.get(node.id) || 0) === 0
    );

    // Position nodes using BFS
    let row = 0;
    let queue = rootNodes.length > 0 ? rootNodes.map(n => n.id) : [flowDependencyGraph.nodes[0]?.id];

    while (queue.length > 0) {
      const nextQueue: string[] = [];
      let col = 0;

      queue.forEach(nodeId => {
        if (!visited.has(nodeId)) {
          visited.add(nodeId);
          nodePositions.set(nodeId, {
            x: padding + col * (nodeWidth + horizontalGap),
            y: padding + row * (nodeHeight + verticalGap),
          });
          col++;

          // Add children to next queue
          flowDependencyGraph.edges
            .filter(e => e.sourceFlowName === nodeId)
            .forEach(e => {
              if (!visited.has(e.targetFlowName)) {
                nextQueue.push(e.targetFlowName);
              }
            });
        }
      });

      queue = nextQueue;
      row++;
    }

    // Position any unvisited nodes
    flowDependencyGraph.nodes.forEach(node => {
      if (!visited.has(node.id)) {
        nodePositions.set(node.id, {
          x: padding + visited.size * (nodeWidth + horizontalGap) / 3,
          y: padding + row * (nodeHeight + verticalGap),
        });
        visited.add(node.id);
      }
    });

    // Calculate SVG dimensions
    const allPositions = Array.from(nodePositions.values());
    const maxX = Math.max(...allPositions.map(p => p.x)) + nodeWidth + padding * 2;
    const maxY = Math.max(...allPositions.map(p => p.y)) + nodeHeight + padding * 2;

    // Build SVG
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px;">`;
    svg += `<rect width="100%" height="100%" fill="#fafafa" />`;

    // Arrow marker
    svg += `
      <defs>
        <marker id="arrowhead-dep" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#0078d4" />
        </marker>
      </defs>
    `;

    // Draw edges
    flowDependencyGraph.edges.forEach(edge => {
      const sourcePos = nodePositions.get(edge.sourceFlowName);
      const targetPos = nodePositions.get(edge.targetFlowName);
      if (sourcePos && targetPos) {
        const startX = sourcePos.x + nodeWidth / 2;
        const startY = sourcePos.y + nodeHeight;
        const endX = targetPos.x + nodeWidth / 2;
        const endY = targetPos.y;
        const color = edge.isInternal ? '#0078d4' : '#d13438';

        if (Math.abs(startX - endX) < 5) {
          svg += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY - 5}"
            stroke="${color}" stroke-width="2" marker-end="url(#arrowhead-dep)" />`;
        } else {
          const midY = (startY + endY) / 2;
          svg += `<path d="M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY - 5}"
            stroke="${color}" stroke-width="2" fill="none" marker-end="url(#arrowhead-dep)" />`;
        }
      }
    });

    // Draw nodes
    flowDependencyGraph.nodes.forEach(node => {
      const pos = nodePositions.get(node.id);
      if (!pos) return;

      const fill = node.isInSolution ? '#0078d4' : '#d13438';
      const displayName = node.displayName.length > 20
        ? node.displayName.substring(0, 17) + '...'
        : node.displayName;

      svg += `
        <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}"
          rx="6" ry="6" fill="${fill}" stroke="${node.isInSolution ? '#005a9e' : '#a4262c'}" stroke-width="2" />
        <text x="${pos.x + nodeWidth / 2}" y="${pos.y + 20}" text-anchor="middle" fill="white" font-weight="bold">
          ${displayName}
        </text>
        <text x="${pos.x + nodeWidth / 2}" y="${pos.y + 36}" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="10">
          ${node.isInSolution ? `${node.actionCount} actions | ${node.rating}%` : 'External'}
        </text>
      `;
    });

    svg += '</svg>';
    return svg;
  }, [flowDependencyGraph]);

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

              {/* Flow Dependencies Tab */}
              <PivotItem headerText="Flow Dependencies" itemIcon="BranchMerge">
                <div className={cardStyles}>
                  {flowDependencyGraph && flowDependencyGraph.edges.length > 0 ? (
                    <>
                      <Stack horizontal tokens={{ childrenGap: 8 }} styles={{ root: { marginBottom: 12 } }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 16, height: 16, backgroundColor: '#0078d4', borderRadius: 3 }} />
                          <Text>Internal Flow</Text>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 16, height: 16, backgroundColor: '#d13438', borderRadius: 3 }} />
                          <Text>External/Missing Flow</Text>
                        </div>
                      </Stack>
                      <div
                        style={{ overflow: 'auto', border: '1px solid #edebe9', borderRadius: 4, backgroundColor: '#fafafa' }}
                        dangerouslySetInnerHTML={{ __html: generateFlowDependencySvg() }}
                      />
                    </>
                  ) : (
                    <MessageBar>
                      No child flow calls (Workflow actions) found in this solution. Flows in this solution do not call other flows.
                    </MessageBar>
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

              {/* Enhanced Missing Dependencies Tab */}
              {(analysisResult.missingDependencies.length > 0 || missingChildFlows.length > 0) && (
                <PivotItem
                  headerText={`Missing Dependencies (${analysisResult.missingDependencies.length + missingChildFlows.length})`}
                  itemIcon="Warning"
                >
                  <div className={cardStyles}>
                    <MessageBar messageBarType={MessageBarType.warning} styles={{ root: { marginBottom: 12 } }}>
                      This solution has missing dependencies that need to be resolved before import.
                    </MessageBar>

                    {/* Solution XML Dependencies */}
                    {analysisResult.missingDependencies.length > 0 && (
                      <>
                        <Text variant="medium" styles={{ root: { fontWeight: 600, marginBottom: 8, display: 'block' } }}>
                          Solution Dependencies
                        </Text>
                        <DetailsList
                          items={analysisResult.missingDependencies}
                          columns={dependencyColumns}
                          layoutMode={DetailsListLayoutMode.justified}
                          selectionMode={SelectionMode.none}
                          isHeaderVisible={true}
                          compact
                        />
                      </>
                    )}

                    {/* Missing Child Flows */}
                    {missingChildFlows.length > 0 && (
                      <>
                        <MessageBar
                          messageBarType={MessageBarType.warning}
                          styles={{ root: { marginTop: 16, marginBottom: 12 } }}
                        >
                          <Icon iconName="Flow" styles={{ root: { marginRight: 8 } }} />
                          {missingChildFlows.length} child flow(s) referenced but not included in solution
                        </MessageBar>
                        <Text variant="medium" styles={{ root: { fontWeight: 600, marginBottom: 8, display: 'block' } }}>
                          Missing Child Flows
                        </Text>
                        <DetailsList
                          items={missingChildFlows}
                          columns={missingChildFlowColumns}
                          layoutMode={DetailsListLayoutMode.justified}
                          selectionMode={SelectionMode.none}
                          isHeaderVisible={true}
                          compact
                        />
                      </>
                    )}
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
