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
import { ExceptionAnalyzer, ExceptionAnalysisResult } from '../../services/ExceptionAnalyzer';
import { ReportGenerator } from '../../services/ReportGenerator';
import { ExceptionAnalysisTab } from './ExceptionAnalysisTab';
import { ApiActionsTab } from './ApiActionsTab';
import { InputAnalysisTab } from './InputAnalysisTab';

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

  // Render diagram when tab is selected using pure SVG (no external dependencies)
  useEffect(() => {
    if (selectedTab === 'diagram' && diagramRef.current && analysisResult) {
      const svg = generateFlowSvg(analysisResult.actions, analysisResult.trigger);
      diagramRef.current.innerHTML = svg;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, analysisResult]);

  // Generate SVG diagram from actions - proper flow hierarchy
  const generateFlowSvg = (actions: FlowAnalysisResult['actions'], trigger: FlowAnalysisResult['trigger']) => {
    if (!actions || actions.length === 0) {
      return '<p style="color: #666; padding: 20px;">No actions to display in diagram.</p>';
    }

    const nodeWidth = 160;
    const nodeHeight = 40;
    const horizontalGap = 40;
    const verticalGap = 60;
    const branchGap = 200;
    const padding = 30;

    // Build action map
    const actionMap = new Map<string, FlowAnalysisResult['actions'][0]>();
    actions.forEach(a => actionMap.set(a.Name, a));

    // Build dependency graph - find children of each action
    const children = new Map<string, string[]>();
    const parents = new Map<string, string[]>();

    children.set('__trigger__', []);

    actions.forEach(action => {
      if (!children.has(action.Name)) {
        children.set(action.Name, []);
      }

      const runAfterList = action.runAfter ? action.runAfter.split(', ').filter(Boolean) : [];
      parents.set(action.Name, runAfterList);

      if (runAfterList.length === 0 && !action.parent) {
        // Root level action with no dependencies - connects to trigger
        children.get('__trigger__')!.push(action.Name);
      } else {
        runAfterList.forEach(parentName => {
          if (!children.has(parentName)) {
            children.set(parentName, []);
          }
          children.get(parentName)!.push(action.Name);
        });
      }
    });

    // Calculate rows using topological sort
    const rows: string[][] = [];
    const visited = new Set<string>();
    const rowAssignment = new Map<string, number>();

    // Start with trigger
    rows.push(['__trigger__']);
    rowAssignment.set('__trigger__', 0);
    visited.add('__trigger__');

    // BFS to assign rows
    let currentRow = 0;
    while (currentRow < rows.length) {
      const nextRowNodes: string[] = [];

      for (const nodeName of rows[currentRow]) {
        const nodeChildren = children.get(nodeName) || [];

        for (const childName of nodeChildren) {
          if (visited.has(childName)) continue;

          // Check if all parents are visited
          const childParents = parents.get(childName) || [];
          const allParentsVisited = childParents.length === 0 ||
            childParents.every(p => visited.has(p));

          if (allParentsVisited) {
            visited.add(childName);
            nextRowNodes.push(childName);
            rowAssignment.set(childName, currentRow + 1);
          }
        }
      }

      if (nextRowNodes.length > 0) {
        rows.push(nextRowNodes);
      }
      currentRow++;
    }

    // Add any unvisited actions (orphans or complex dependencies)
    actions.forEach(action => {
      if (!visited.has(action.Name)) {
        const lastRow = rows.length - 1;
        rows[lastRow].push(action.Name);
        rowAssignment.set(action.Name, lastRow);
        visited.add(action.Name);
      }
    });

    // Calculate positions
    const positions = new Map<string, { x: number; y: number }>();

    rows.forEach((row, rowIdx) => {
      const startX = padding + (row.length > 1 ? 0 : (branchGap - nodeWidth) / 2);

      row.forEach((nodeName, colIdx) => {
        const x = startX + colIdx * (nodeWidth + horizontalGap);
        const y = padding + rowIdx * (nodeHeight + verticalGap);
        positions.set(nodeName, { x, y });
      });
    });

    // Calculate SVG dimensions
    const allPositions = Array.from(positions.values());
    const maxX = Math.max(...allPositions.map(p => p.x)) + nodeWidth + padding * 2;
    const maxY = Math.max(...allPositions.map(p => p.y)) + nodeHeight + padding * 2 + 20;

    // Build SVG
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 10px;">`;

    // Background
    svg += `<rect width="100%" height="100%" fill="#fafafa" />`;

    // Defs for markers
    svg += `
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#666" />
        </marker>
        <marker id="arrowhead-red" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#cc4747" />
        </marker>
      </defs>
    `;

    // Draw connections
    const drawnConnections = new Set<string>();

    actions.forEach(action => {
      const pos = positions.get(action.Name);
      if (!pos) return;

      const runAfterList = action.runAfter ? action.runAfter.split(', ').filter(Boolean) : [];

      if (runAfterList.length === 0 && !action.parent) {
        // Connect from trigger
        const triggerPos = positions.get('__trigger__');
        if (triggerPos) {
          drawConnection(svg, triggerPos, pos, nodeWidth, nodeHeight, false);
        }
      }

      runAfterList.forEach(parentName => {
        const parentPos = positions.get(parentName);
        if (parentPos) {
          const connKey = `${parentName}->${action.Name}`;
          if (!drawnConnections.has(connKey)) {
            drawnConnections.add(connKey);
            // Check if this is an error path
            const isErrorPath = action.exception === 'Yes';
            drawConnection(svg, parentPos, pos, nodeWidth, nodeHeight, isErrorPath);
          }
        }
      });
    });

    function drawConnection(svgRef: string, from: {x: number, y: number}, to: {x: number, y: number}, w: number, h: number, isError: boolean) {
      const startX = from.x + w / 2;
      const startY = from.y + h;
      const endX = to.x + w / 2;
      const endY = to.y;

      const midY = startY + (endY - startY) / 2;
      const marker = isError ? 'url(#arrowhead-red)' : 'url(#arrowhead)';
      const color = isError ? '#cc4747' : '#999';

      if (Math.abs(startX - endX) < 5) {
        // Straight line
        svg += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY - 5}"
          stroke="${color}" stroke-width="1.5" marker-end="${marker}" />`;
      } else {
        // Curved path
        svg += `<path d="M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY - 5}"
          stroke="${color}" stroke-width="1.5" fill="none" marker-end="${marker}" />`;
      }
    }

    // Draw trigger node
    const triggerPos = positions.get('__trigger__')!;
    svg += `
      <rect x="${triggerPos.x}" y="${triggerPos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="20" ry="20" fill="#569AE5" stroke="#4080c0" stroke-width="2" />
      <text x="${triggerPos.x + nodeWidth / 2}" y="${triggerPos.y + nodeHeight / 2 + 4}" text-anchor="middle" fill="white" font-weight="bold">
        ${escapeXml(truncateText(trigger?.name || 'Trigger', 18))}
      </text>
    `;

    // Draw action nodes
    actions.forEach(action => {
      const pos = positions.get(action.Name);
      if (!pos) return;

      const { fill, stroke, shape, textColor } = getNodeStyle(action.Type);
      const displayName = truncateText(action.Name, 20);

      if (shape === 'diamond') {
        // Diamond for conditions
        const cx = pos.x + nodeWidth / 2;
        const cy = pos.y + nodeHeight / 2;
        svg += `
          <polygon points="${cx},${pos.y - 5} ${pos.x + nodeWidth + 10},${cy} ${cx},${pos.y + nodeHeight + 5} ${pos.x - 10},${cy}"
            fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${cx}" y="${cy + 3}" text-anchor="middle" fill="${textColor}" font-weight="bold" font-size="9">
            ${escapeXml(displayName)}
          </text>
        `;
      } else if (shape === 'hexagon') {
        // Hexagon for loops
        const cx = pos.x + nodeWidth / 2;
        const offset = 12;
        svg += `
          <polygon points="${pos.x + offset},${pos.y} ${pos.x + nodeWidth - offset},${pos.y} ${pos.x + nodeWidth},${pos.y + nodeHeight / 2} ${pos.x + nodeWidth - offset},${pos.y + nodeHeight} ${pos.x + offset},${pos.y + nodeHeight} ${pos.x},${pos.y + nodeHeight / 2}"
            fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${cx}" y="${pos.y + nodeHeight / 2 + 3}" text-anchor="middle" fill="${textColor}" font-weight="bold" font-size="9">
            ${escapeXml(displayName)}
          </text>
        `;
      } else if (shape === 'parallelogram') {
        // Parallelogram for scopes
        const skew = 10;
        svg += `
          <polygon points="${pos.x + skew},${pos.y} ${pos.x + nodeWidth + skew},${pos.y} ${pos.x + nodeWidth - skew},${pos.y + nodeHeight} ${pos.x - skew},${pos.y + nodeHeight}"
            fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${pos.x + nodeWidth / 2}" y="${pos.y + nodeHeight / 2 + 3}" text-anchor="middle" fill="${textColor}" font-weight="bold" font-size="9">
            ${escapeXml(displayName)}
          </text>
        `;
      } else {
        // Rectangle (default)
        const rx = shape === 'rounded' ? 15 : 4;
        svg += `
          <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${pos.x + nodeWidth / 2}" y="${pos.y + nodeHeight / 2 + 3}" text-anchor="middle" fill="${textColor}" font-weight="bold" font-size="9">
            ${escapeXml(displayName)}
          </text>
        `;
      }

      // Add type label below
      svg += `
        <text x="${pos.x + nodeWidth / 2}" y="${pos.y + nodeHeight + 12}" text-anchor="middle" fill="#888" font-size="8">
          ${escapeXml(action.Type)}
        </text>
      `;
    });

    svg += '</svg>';
    return svg;
  };

  const getNodeStyle = (actionType: string): { fill: string; stroke: string; shape: string; textColor: string } => {
    const styles: Record<string, { fill: string; stroke: string; shape: string; textColor: string }> = {
      'If': { fill: '#2596be', stroke: '#1a7a9e', shape: 'diamond', textColor: 'white' },
      'Switch': { fill: '#2596be', stroke: '#1a7a9e', shape: 'diamond', textColor: 'white' },
      'Foreach': { fill: '#00C1A0', stroke: '#009a80', shape: 'hexagon', textColor: 'white' },
      'Until': { fill: '#00C1A0', stroke: '#009a80', shape: 'hexagon', textColor: 'white' },
      'Do_until': { fill: '#00C1A0', stroke: '#009a80', shape: 'hexagon', textColor: 'white' },
      'Scope': { fill: '#808080', stroke: '#606060', shape: 'parallelogram', textColor: 'white' },
      'InitializeVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect', textColor: 'white' },
      'SetVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect', textColor: 'white' },
      'AppendToArrayVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect', textColor: 'white' },
      'AppendToStringVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect', textColor: 'white' },
      'IncrementVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect', textColor: 'white' },
      'DecrementVariable': { fill: '#9925be', stroke: '#7a1d9e', shape: 'rect', textColor: 'white' },
      'Terminate': { fill: '#cc4747', stroke: '#a63939', shape: 'rect', textColor: 'white' },
      'Compose': { fill: '#EBDAF9', stroke: '#c9b0e0', shape: 'rect', textColor: '#333' },
      'Http': { fill: '#ff8c00', stroke: '#cc7000', shape: 'rect', textColor: 'white' },
      'Response': { fill: '#569AE5', stroke: '#4080c0', shape: 'rounded', textColor: 'white' },
      'OpenApiConnection': { fill: '#0078d4', stroke: '#005a9e', shape: 'rect', textColor: 'white' },
      'ApiConnection': { fill: '#0078d4', stroke: '#005a9e', shape: 'rect', textColor: 'white' },
      'ParseJson': { fill: '#107c10', stroke: '#0b5c0b', shape: 'rect', textColor: 'white' },
      'Select': { fill: '#107c10', stroke: '#0b5c0b', shape: 'rect', textColor: 'white' },
      'Filter': { fill: '#107c10', stroke: '#0b5c0b', shape: 'rect', textColor: 'white' },
      'Join': { fill: '#107c10', stroke: '#0b5c0b', shape: 'rect', textColor: 'white' },
    };

    return styles[actionType] || { fill: '#569AE5', stroke: '#4080c0', shape: 'rect', textColor: 'white' };
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
