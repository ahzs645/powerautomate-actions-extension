import { useState, useMemo, useEffect, useRef } from 'react';
import { Stack } from '@fluentui/react/lib/Stack';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Text } from '@fluentui/react/lib/Text';
import { DetailsList, DetailsListLayoutMode, SelectionMode, IColumn } from '@fluentui/react/lib/DetailsList';
import { Pivot, PivotItem } from '@fluentui/react/lib/Pivot';
import { SearchBox } from '@fluentui/react/lib/SearchBox';
import { DefaultButton } from '@fluentui/react/lib/Button';
import { ProgressIndicator } from '@fluentui/react/lib/ProgressIndicator';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { FlowAnalyzer, FlowAnalysisResult, FlowVariable } from '../../services/FlowAnalyzer';

interface FlowAnalysisPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
  flowDefinition: string;
  flowName: string;
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

const diagramContainerStyles = mergeStyles({
  border: '1px solid #edebe9',
  borderRadius: '4px',
  padding: '16px',
  backgroundColor: '#fff',
  overflow: 'auto',
  minHeight: '400px',
  maxHeight: '600px',
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
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedTab, setSelectedTab] = useState('overview');
  const diagramRef = useRef<HTMLDivElement>(null);

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

  // Render diagram when tab is selected using pure SVG (no external dependencies)
  useEffect(() => {
    if (selectedTab === 'diagram' && diagramRef.current && analysisResult) {
      const svg = generateFlowSvg(analysisResult.actions, analysisResult.trigger);
      diagramRef.current.innerHTML = svg;
    }
  }, [selectedTab, analysisResult]);

  // Generate SVG diagram from actions
  const generateFlowSvg = (actions: FlowAnalysisResult['actions'], trigger: FlowAnalysisResult['trigger']) => {
    if (!actions || actions.length === 0) {
      return '<p style="color: #666; padding: 20px;">No actions to display in diagram.</p>';
    }

    const nodeWidth = 180;
    const nodeHeight = 50;
    const horizontalGap = 60;
    const verticalGap = 30;
    const startX = 50;
    const startY = 30;

    // Build a map of actions by name
    const actionMap = new Map<string, typeof actions[0]>();
    actions.forEach(a => actionMap.set(a.Name, a));

    // Group actions by nesting level
    const levels: Map<number, typeof actions> = new Map();
    actions.forEach(action => {
      const level = action.nested;
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level)!.push(action);
    });

    // Calculate positions
    const positions: Map<string, { x: number; y: number }> = new Map();
    let currentY = startY;

    // Add trigger node
    positions.set('__trigger__', { x: startX, y: currentY });
    currentY += nodeHeight + verticalGap;

    // Position nodes level by level
    const sortedLevels = Array.from(levels.keys()).sort((a, b) => a - b);
    sortedLevels.forEach(level => {
      const levelActions = levels.get(level)!;
      let currentX = startX + (level * horizontalGap);

      levelActions.forEach((action, idx) => {
        positions.set(action.Name, { x: currentX, y: currentY + (idx * (nodeHeight + verticalGap / 2)) });
      });

      currentY += levelActions.length * (nodeHeight + verticalGap / 2) + verticalGap;
    });

    // Calculate SVG dimensions
    const maxX = Math.max(...Array.from(positions.values()).map(p => p.x)) + nodeWidth + 50;
    const maxY = Math.max(...Array.from(positions.values()).map(p => p.y)) + nodeHeight + 50;

    // Build SVG
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px;">`;

    // Add styles
    svg += `
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
        </marker>
      </defs>
    `;

    // Draw connections first (so they're behind nodes)
    actions.forEach(action => {
      const pos = positions.get(action.Name);
      if (!pos) return;

      if (action.runAfter) {
        const parents = action.runAfter.split(', ').filter(Boolean);
        parents.forEach(parent => {
          const parentPos = positions.get(parent);
          if (parentPos) {
            const startXConn = parentPos.x + nodeWidth / 2;
            const startYConn = parentPos.y + nodeHeight;
            const endXConn = pos.x + nodeWidth / 2;
            const endYConn = pos.y;

            svg += `<path d="M ${startXConn} ${startYConn} C ${startXConn} ${startYConn + 20}, ${endXConn} ${endYConn - 20}, ${endXConn} ${endYConn}"
              stroke="#999" stroke-width="1.5" fill="none" marker-end="url(#arrowhead)" />`;
          }
        });
      } else if (action.nested === 0) {
        // Connect to trigger if it's a root action with no runAfter
        const triggerPos = positions.get('__trigger__');
        if (triggerPos) {
          const startXConn = triggerPos.x + nodeWidth / 2;
          const startYConn = triggerPos.y + nodeHeight;
          const endXConn = pos.x + nodeWidth / 2;
          const endYConn = pos.y;

          svg += `<path d="M ${startXConn} ${startYConn} C ${startXConn} ${startYConn + 20}, ${endXConn} ${endYConn - 20}, ${endXConn} ${endYConn}"
            stroke="#999" stroke-width="1.5" fill="none" marker-end="url(#arrowhead)" />`;
        }
      }
    });

    // Draw trigger node
    const triggerPos = positions.get('__trigger__')!;
    svg += `
      <rect x="${triggerPos.x}" y="${triggerPos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="25" ry="25" fill="#569AE5" stroke="#4080c0" stroke-width="2" />
      <text x="${triggerPos.x + nodeWidth / 2}" y="${triggerPos.y + nodeHeight / 2 + 4}" text-anchor="middle" fill="white" font-weight="bold">
        ${escapeXml(truncateText(trigger?.name || 'Trigger', 20))}
      </text>
    `;

    // Draw action nodes
    actions.forEach(action => {
      const pos = positions.get(action.Name);
      if (!pos) return;

      const { fill, stroke, shape } = getNodeStyle(action.Type);
      const displayName = truncateText(action.Name, 22);

      if (shape === 'diamond') {
        // Diamond for conditions
        const cx = pos.x + nodeWidth / 2;
        const cy = pos.y + nodeHeight / 2;
        const hw = nodeWidth / 2;
        const hh = nodeHeight / 2;
        svg += `
          <polygon points="${cx},${pos.y} ${pos.x + nodeWidth},${cy} ${cx},${pos.y + nodeHeight} ${pos.x},${cy}"
            fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="white" font-weight="bold" font-size="10">
            ${escapeXml(displayName)}
          </text>
        `;
      } else if (shape === 'hexagon') {
        // Hexagon for loops
        const cx = pos.x + nodeWidth / 2;
        const offset = 15;
        svg += `
          <polygon points="${pos.x + offset},${pos.y} ${pos.x + nodeWidth - offset},${pos.y} ${pos.x + nodeWidth},${pos.y + nodeHeight / 2} ${pos.x + nodeWidth - offset},${pos.y + nodeHeight} ${pos.x + offset},${pos.y + nodeHeight} ${pos.x},${pos.y + nodeHeight / 2}"
            fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${cx}" y="${pos.y + nodeHeight / 2 + 4}" text-anchor="middle" fill="white" font-weight="bold">
            ${escapeXml(displayName)}
          </text>
        `;
      } else {
        // Rectangle (default)
        svg += `
          <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="5" ry="5" fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${pos.x + nodeWidth / 2}" y="${pos.y + nodeHeight / 2 + 4}" text-anchor="middle" fill="white" font-weight="bold">
            ${escapeXml(displayName)}
          </text>
        `;
      }

      // Add type label
      svg += `
        <text x="${pos.x + nodeWidth / 2}" y="${pos.y + nodeHeight + 12}" text-anchor="middle" fill="#666" font-size="9">
          ${escapeXml(action.Type)}
        </text>
      `;
    });

    svg += '</svg>';
    return svg;
  };

  const getNodeStyle = (actionType: string): { fill: string; stroke: string; shape: string } => {
    const styles: Record<string, { fill: string; stroke: string; shape: string }> = {
      'If': { fill: '#2596be', stroke: '#1a7a9e', shape: 'diamond' },
      'Switch': { fill: '#2596be', stroke: '#1a7a9e', shape: 'diamond' },
      'Foreach': { fill: '#00C1A0', stroke: '#009a80', shape: 'hexagon' },
      'Until': { fill: '#00C1A0', stroke: '#009a80', shape: 'hexagon' },
      'Do_until': { fill: '#00C1A0', stroke: '#009a80', shape: 'hexagon' },
      'Scope': { fill: '#808080', stroke: '#606060', shape: 'rect' },
      'InitializeVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect' },
      'SetVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect' },
      'AppendToArrayVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect' },
      'AppendToStringVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect' },
      'IncrementVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect' },
      'DecrementVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect' },
      'Terminate': { fill: '#cc4747', stroke: '#a63939', shape: 'rect' },
      'Compose': { fill: '#EBDAF9', stroke: '#c9b0e0', shape: 'rect' },
      'Http': { fill: '#ff8c00', stroke: '#cc7000', shape: 'rect' },
      'Response': { fill: '#569AE5', stroke: '#4080c0', shape: 'rect' },
    };

    return styles[actionType] || { fill: '#569AE5', stroke: '#4080c0', shape: 'rect' };
  };

  const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 2) + '..';
  };

  const escapeXml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

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

  const downloadDiagramAsSvg = () => {
    if (!diagramRef.current) return;

    const svgElement = diagramRef.current.querySelector('svg');
    if (svgElement) {
      const svg = svgElement.outerHTML;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${flowName}-diagram.svg`;
      link.click();
    }
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
    return (
      <Stack tokens={{ childrenGap: 12 }}>
        <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center">
          <DefaultButton
            iconProps={{ iconName: 'Download' }}
            text="Download SVG"
            onClick={downloadDiagramAsSvg}
          />
        </Stack>
        <div className={diagramContainerStyles} ref={diagramRef}>
          <Text>Loading diagram...</Text>
        </div>
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
            >
              <PivotItem headerText="Overview" itemKey="overview" />
              <PivotItem headerText="Diagram" itemKey="diagram" />
              <PivotItem headerText={`Actions (${analysisResult.actionCount})`} itemKey="actions" />
              <PivotItem headerText={`Variables (${analysisResult.variableCount})`} itemKey="variables" />
              <PivotItem headerText={`Connections (${analysisResult.connections.length})`} itemKey="connections" />
            </Pivot>

            {selectedTab === 'overview' && renderOverview()}
            {selectedTab === 'diagram' && renderDiagram()}
            {selectedTab === 'actions' && renderActions()}
            {selectedTab === 'variables' && renderVariables()}
            {selectedTab === 'connections' && renderConnections()}
          </>
        )}
      </Stack>
    </Panel>
  );
};

export default FlowAnalysisPanel;
