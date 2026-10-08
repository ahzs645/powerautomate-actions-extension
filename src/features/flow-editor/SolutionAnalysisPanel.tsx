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
  FlowDependencyGraph,
  MissingChildFlow,
} from '../../services/SolutionAnalyzer';
import { MetricCard, MetricRow } from './components/MetricCard';

interface SolutionAnalysisPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const escapeXml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: 'var(--color-bg-card)',
  color: 'var(--color-fg)',
  marginBottom: '12px',
});

/** Dependency graph colours: internal flows use the brand colour, missing ones danger. */
const GRAPH = {
  internal: 'var(--color-brand, #0078d4)',
  internalStroke: 'var(--color-brand-hover, #005a9e)',
  external: 'var(--color-danger, #d13438)',
  externalStroke: 'var(--color-danger, #a4262c)',
  nodeText: 'var(--color-brand-text, #ffffff)',
};

const uploadAreaStyles = mergeStyles({
  border: '2px dashed var(--color-brand)',
  borderRadius: '8px',
  padding: '32px',
  textAlign: 'center',
  backgroundColor: 'var(--color-info-bg)',
  cursor: 'pointer',
  transition: 'all 0.2s',
  ':hover': {
    backgroundColor: 'var(--color-info-bg)',
    borderColor: 'var(--color-brand)',
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
              color: item.analysis ? getRatingColor(item.analysis.overallRating) : 'var(--color-fg)',
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
          <Text styles={{ root: { color: failCount > 0 ? 'var(--color-danger)' : 'var(--color-success)' } }}>
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
          styles={{ root: { color: item.isCustomizable ? 'var(--color-success)' : 'var(--color-fg-secondary)' } }}
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
      return '<p style="color: var(--color-fg-secondary); padding: 20px;">No flow dependencies found.</p>';
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
      const currentRow = row;
      let col = 0;

      queue.forEach(nodeId => {
        if (!visited.has(nodeId)) {
          visited.add(nodeId);
          nodePositions.set(nodeId, {
            x: padding + col * (nodeWidth + horizontalGap),
            y: padding + currentRow * (nodeHeight + verticalGap),
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
    svg += `<rect width="100%" height="100%" fill="var(--color-bg-subtle)" />`;

    // Arrow marker
    svg += `
      <defs>
        <marker id="arrowhead-dep" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="${GRAPH.internal}" />
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
        const color = edge.isInternal ? GRAPH.internal : GRAPH.external;

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

      const fill = node.isInSolution ? GRAPH.internal : GRAPH.external;
      // Flow names come from an uploaded solution zip; escape them so a
      // crafted name can't inject markup into the dangerouslySetInnerHTML SVG.
      const displayName = escapeXml(node.displayName.length > 20
        ? node.displayName.substring(0, 17) + '...'
        : node.displayName);

      svg += `
        <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}"
          rx="6" ry="6" fill="${fill}" stroke="${node.isInSolution ? GRAPH.internalStroke : GRAPH.externalStroke}" stroke-width="2" />
        <text x="${pos.x + nodeWidth / 2}" y="${pos.y + 20}" text-anchor="middle" fill="${GRAPH.nodeText}" font-weight="bold">
          ${displayName}
        </text>
        <text x="${pos.x + nodeWidth / 2}" y="${pos.y + 36}" text-anchor="middle" fill="${GRAPH.nodeText}" font-size="10">
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
                styles={{ root: { fontSize: 48, color: 'var(--color-brand)', marginBottom: 12 } }}
              />
              <Text variant="large" block styles={{ root: { marginBottom: 8 } }}>
                Drag & drop a solution .zip file here
              </Text>
              <Text variant="small" styles={{ root: { color: 'var(--color-fg-secondary)' } }}>
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
            <div className={cardStyles} style={{ borderLeft: '4px solid var(--color-brand)' }}>
              <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
                <Stack>
                  <Text variant="xLarge" styles={{ root: { color: 'var(--color-fg)', fontWeight: 600 } }}>
                    {analysisResult.name}
                  </Text>
                  <Text styles={{ root: { color: 'var(--color-fg-secondary)' } }}>
                    Version {analysisResult.version} | Publisher: {analysisResult.publisher}
                  </Text>
                </Stack>
                <PrimaryButton iconProps={{ iconName: 'Clear' }} text="Clear" onClick={handleClear} />
              </Stack>
            </div>

            {/* Aggregate Metrics */}
            <MetricRow label="Solution metrics">
              <MetricCard label="Flows" value={analysisResult.aggregateMetrics.totalFlows} tone="info" />
              <MetricCard label="Total actions" value={analysisResult.aggregateMetrics.totalActions} tone="neutral" />
              <MetricCard label="Avg complexity" value={analysisResult.aggregateMetrics.averageComplexity} tone="neutral" />
              <MetricCard
                label="Avg rating"
                value={`${analysisResult.aggregateMetrics.averageRating}%`}
                tone={ratingTone(analysisResult.aggregateMetrics.averageRating)}
                hint="Green ≥ 70%, amber ≥ 40%"
              />
              <MetricCard label="Connections" value={analysisResult.aggregateMetrics.totalConnections} tone="accent" />
              {analysisResult.aggregateMetrics.flowsWithIssues > 0 && (
                <MetricCard label="Flows with issues" value={analysisResult.aggregateMetrics.flowsWithIssues} tone="danger" />
              )}
            </MetricRow>

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
                          <div style={{ width: 16, height: 16, backgroundColor: GRAPH.internal, borderRadius: 3 }} />
                          <Text>Internal Flow</Text>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 16, height: 16, backgroundColor: GRAPH.external, borderRadius: 3 }} />
                          <Text>External/Missing Flow</Text>
                        </div>
                      </Stack>
                      <div
                        style={{ overflow: 'auto', border: '1px solid var(--color-stroke)', borderRadius: 4, backgroundColor: 'var(--color-bg-subtle)' }}
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

/** Text colour for a rating; amber text uses the body colour (orange text fails contrast). */
function getRatingColor(rating: number): string {
  if (rating >= 70) return 'var(--color-success)';
  if (rating >= 40) return 'var(--color-fg)';
  return 'var(--color-danger)';
}

function ratingTone(rating: number): 'success' | 'warning' | 'danger' {
  return rating >= 70 ? 'success' : rating >= 40 ? 'warning' : 'danger';
}

export default SolutionAnalysisPanel;
