import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Stack } from '@fluentui/react/lib/Stack';
import { Text } from '@fluentui/react/lib/Text';
import { DefaultButton, PrimaryButton, IconButton } from '@fluentui/react/lib/Button';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { FlowAction, FlowTrigger } from '../../services/FlowAnalyzer';
import { buildDiagram, renderDiagramSvg, inlineDiagramImages } from './FlowDiagram';
import { findActionRange, JsonRange } from './flowJsonLocator';

export interface FlowDiagramTabProps {
  actions: FlowAction[];
  trigger: FlowTrigger | null;
  /** Raw JSON text, used to map a selected node back to real editor lines. */
  flowDefinition: string;
  flowName: string;
  /** Provided by the host page to jump the Monaco editor to the selection. */
  onRevealRange?: (range: JsonRange) => void;
}

const TRIGGER_KEY = '__trigger__';

const layoutStyles = mergeStyles({
  display: 'flex',
  gap: '12px',
  alignItems: 'stretch',
});

const canvasStyles = mergeStyles({
  flex: '1 1 auto',
  minWidth: 0,
  border: '1px solid #edebe9',
  borderRadius: '4px',
  backgroundColor: '#fff',
  overflow: 'auto',
  minHeight: '420px',
  maxHeight: '620px',
});

const sidebarStyles = mergeStyles({
  flex: '0 0 320px',
  border: '1px solid #edebe9',
  borderRadius: '4px',
  backgroundColor: '#fff',
  padding: '12px',
  overflow: 'auto',
  minHeight: '420px',
  maxHeight: '620px',
});

const codeStyles = mergeStyles({
  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  fontSize: '11px',
  lineHeight: 1.5,
  backgroundColor: '#faf9f8',
  border: '1px solid #edebe9',
  borderRadius: '2px',
  padding: '8px',
  margin: 0,
  whiteSpace: 'pre',
  overflowX: 'auto',
  maxHeight: '260px',
});

const fieldLabelStyles = mergeStyles({
  fontSize: '11px',
  color: '#605e5c',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: '2px',
});

const fieldValueStyles = mergeStyles({
  fontSize: '13px',
  color: '#323130',
  wordBreak: 'break-word',
  marginBottom: '10px',
});

export const FlowDiagramTab: React.FC<FlowDiagramTabProps> = ({
  actions,
  trigger,
  flowDefinition,
  flowName,
  onRevealRange,
}) => {
  const [zoom, setZoom] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const diagram = useMemo(() => {
    if (!actions || actions.length === 0) return null;
    try {
      return buildDiagram(actions, trigger);
    } catch (error) {
      console.error('Diagram layout error:', error);
      return null;
    }
  }, [actions, trigger]);

  // On screen the diagram is interactive and keeps the designer's insert
  // affordance; the export drops both so the file is clean, static artwork.
  const interactiveSvg = useMemo(
    () => (diagram ? renderDiagramSvg(diagram, { interactive: true, showInsertMarkers: true }) : ''),
    [diagram]
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    canvasRef.current.innerHTML = interactiveSvg;
  }, [interactiveSvg]);

  // Zoom is applied to the rendered size only; the viewBox keeps intrinsic units.
  useEffect(() => {
    const svg = canvasRef.current?.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', String(svg.viewBox.baseVal.width * zoom));
    svg.setAttribute('height', String(svg.viewBox.baseVal.height * zoom));
  }, [interactiveSvg, zoom]);

  // Applied as an attribute rather than by re-rendering, so scroll position holds.
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;

    root.querySelectorAll('[data-node], [data-frame]').forEach(el => {
      const key = el.getAttribute('data-node') || el.getAttribute('data-frame');
      if (key && key === selectedKey) el.setAttribute('data-selected', 'true');
      else el.removeAttribute('data-selected');
    });
  }, [selectedKey, interactiveSvg]);

  const selectedAction = useMemo(
    () => actions.find(a => a.Name === selectedKey) || null,
    [actions, selectedKey]
  );

  const selectedRange = useMemo<JsonRange | null>(() => {
    if (!selectedKey || !flowDefinition) return null;
    const name = selectedKey === TRIGGER_KEY ? trigger?.name : selectedKey;
    return name ? findActionRange(flowDefinition, name) : null;
  }, [selectedKey, flowDefinition, trigger]);

  const handleCanvasClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as Element | null;
    const hit = target?.closest?.('[data-node], [data-frame]');
    if (!hit) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey(hit.getAttribute('data-node') || hit.getAttribute('data-frame'));
  }, []);

  const handleCanvasKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setSelectedKey(null);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const hit = (event.target as Element | null)?.closest?.('[data-node], [data-frame]');
    if (!hit) return;
    event.preventDefault();
    setSelectedKey(hit.getAttribute('data-node') || hit.getAttribute('data-frame'));
  }, []);

  const fitToWidth = useCallback(() => {
    const container = canvasRef.current;
    const svg = container?.querySelector('svg');
    if (!container || !svg) return;
    const natural = svg.viewBox.baseVal.width;
    if (natural) setZoom(Math.min(1, (container.clientWidth - 24) / natural));
  }, []);

  const downloadSvg = useCallback(async () => {
    if (!diagram) return;
    // Static export: no hit targets, no hover styling, no insert markers.
    const clean = renderDiagramSvg(diagram, { interactive: false, showInsertMarkers: false });
    const svg = await inlineDiagramImages(clean);

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${flowName}-diagram.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [diagram, flowName]);

  const copyJson = useCallback(async () => {
    const text = selectedRange?.text || selectedAction?.object;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [selectedRange, selectedAction]);

  if (!diagram) {
    return <Text>No actions to display in the diagram.</Text>;
  }

  return (
    <Stack tokens={{ childrenGap: 12 }}>
      <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center" wrap>
        <DefaultButton iconProps={{ iconName: 'Download' }} text="Download SVG" onClick={downloadSvg} />
        <IconButton
          iconProps={{ iconName: 'ZoomOut' }}
          title="Zoom out"
          ariaLabel="Zoom out"
          onClick={() => setZoom(z => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
        />
        <IconButton
          iconProps={{ iconName: 'ZoomIn' }}
          title="Zoom in"
          ariaLabel="Zoom in"
          onClick={() => setZoom(z => Math.min(2.5, Math.round((z + 0.1) * 100) / 100))}
        />
        <DefaultButton iconProps={{ iconName: 'FitWidth' }} text="Fit" onClick={fitToWidth} />
        <DefaultButton text="100%" onClick={() => setZoom(1)} />
        <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
          {Math.round(zoom * 100)}%
        </Text>
      </Stack>

      <div className={layoutStyles}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={canvasStyles}
          ref={canvasRef}
          onClick={handleCanvasClick}
          onKeyDown={handleCanvasKeyDown}
          role="application"
          aria-label="Flow diagram"
        />

        {selectedKey && (
          <div className={sidebarStyles}>
            <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
              <Text variant="mediumPlus" styles={{ root: { fontWeight: 600 } }}>
                {selectedKey === TRIGGER_KEY
                  ? (trigger?.name || 'Trigger').replace(/_/g, ' ')
                  : selectedKey.replace(/_/g, ' ')}
              </Text>
              <IconButton
                iconProps={{ iconName: 'Cancel' }}
                title="Clear selection"
                ariaLabel="Clear selection"
                onClick={() => setSelectedKey(null)}
              />
            </Stack>

            {selectedKey === TRIGGER_KEY ? (
              <TriggerDetails trigger={trigger} />
            ) : (
              <ActionDetails action={selectedAction} />
            )}

            <div className={fieldLabelStyles}>Definition</div>
            {selectedRange ? (
              <>
                <Text variant="small" styles={{ root: { color: '#605e5c', display: 'block', marginBottom: 4 } }}>
                  Lines {selectedRange.startLine}–{selectedRange.endLine}
                </Text>
                <pre className={codeStyles}>{selectedRange.text}</pre>
              </>
            ) : (
              <MessageBar messageBarType={MessageBarType.info} isMultiline>
                Could not locate this action in the JSON text.
              </MessageBar>
            )}

            <Stack horizontal tokens={{ childrenGap: 8 }} styles={{ root: { marginTop: 10 } }} wrap>
              {onRevealRange && selectedRange && (
                <PrimaryButton
                  iconProps={{ iconName: 'GoToDefinition' }}
                  text="Show in editor"
                  onClick={() => onRevealRange(selectedRange)}
                />
              )}
              <DefaultButton
                iconProps={{ iconName: copied ? 'CheckMark' : 'Copy' }}
                text={copied ? 'Copied' : 'Copy JSON'}
                onClick={copyJson}
                disabled={!selectedRange && !selectedAction?.object}
              />
            </Stack>
          </div>
        )}
      </div>

      <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
        Select a card or a scope to inspect it. Dashed connectors run after something other
        than plain success; the dots above a card show which statuses: green succeeded, red
        failed, orange timed out, grey skipped.
      </Text>
    </Stack>
  );
};

const Field: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => {
  if (value === undefined || value === null || value === '' || value === 'No') return null;
  return (
    <>
      <div className={fieldLabelStyles}>{label}</div>
      <div className={fieldValueStyles}>{String(value)}</div>
    </>
  );
};

const ActionDetails: React.FC<{ action: FlowAction | null }> = ({ action }) => {
  if (!action) return null;

  const runAfter = Object.keys(action.runAfterDetail || {});

  return (
    <div style={{ marginTop: 10 }}>
      <Field label="Type" value={action.Type} />
      <Field label="Connector" value={action.connector?.replace(/^shared_/, '')} />
      <Field label="Tier" value={action.tier} />
      <Field label="Complexity" value={action.Complexity} />
      {runAfter.length > 0 && (
        <>
          <div className={fieldLabelStyles}>Runs after</div>
          <div className={fieldValueStyles}>
            {runAfter
              .map(name => `${name.replace(/_/g, ' ')} (${action.runAfterDetail[name].join(', ')})`)
              .join(' · ')}
          </div>
        </>
      )}
      <Field label="Nested in" value={action.parent?.replace(/_/g, ' ')} />
      <Field label="Branch" value={action.branch} />
      <Field label="Detail" value={action.detail} />
      <Field label="Filter" value={action.filter} />
      <Field label="Pagination" value={action.pagination} />
      <Field label="Secure inputs" value={action.secure} />
      <Field label="Retry policy" value={action.retry} />
      <Field label="Timeout" value={action.timeout} />
      <Field label="Notes" value={action.notes} />
    </div>
  );
};

const TriggerDetails: React.FC<{ trigger: FlowTrigger | null }> = ({ trigger }) => {
  if (!trigger) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <Field label="Type" value={trigger.type} />
      <Field label="Connector" value={trigger.connector?.replace(/^shared_/, '')} />
      <Field label="Recurrence" value={trigger.recurrence} />
      <Field label="Split on" value={trigger.splitOn} />
      <Field label="Operation" value={trigger.operationId} />
      <Field label="Method" value={trigger.method} />
      <Field label="Relative path" value={trigger.relativePath} />
      <Field label="Conditions" value={trigger.conditions} />
    </div>
  );
};

export default FlowDiagramTab;
