import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Stack } from '@fluentui/react/lib/Stack';
import { Text } from '@fluentui/react/lib/Text';
import { DefaultButton, PrimaryButton, IconButton } from '@fluentui/react/lib/Button';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { FlowAction, FlowTrigger } from '../../services/FlowAnalyzer';
import { buildDiagram, renderDiagramSvg, inlineDiagramImages, diagramCanvasColor } from './FlowDiagram';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import { findActionRange, JsonRange } from './flowJsonLocator';

export interface FlowDiagramTabProps {
  actions: FlowAction[];
  trigger: FlowTrigger | null;
  /** Raw JSON text, used to map a selected node back to real editor lines. */
  flowDefinition: string;
  flowName: string;
  /** Selection is shared with the other tabs, so the panel owns it. */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Panel search text; matching cards are highlighted and the rest dimmed. */
  searchText?: string;
  /** Provided by the host page to jump the Monaco editor to the selection. */
  onRevealRange?: (range: JsonRange) => void;
  /**
   * 'panel' keeps the canvas to a fixed height (inside a side panel); 'fill' stretches
   * it to the host's height (the editor page's Diagram / Split view).
   */
  layout?: 'panel' | 'fill';
  /** The details sidebar; the Split view hides it because the JSON is already beside it. */
  showDetails?: boolean;
}

const TRIGGER_KEY = '__trigger__';
const CONTAINER_TYPES = ['If', 'Switch', 'Scope', 'Foreach', 'Until', 'Do_until'];

const rootStyles = (fill: boolean) =>
  mergeStyles(
    { display: 'flex', flexDirection: 'column', gap: 12 },
    fill && { height: '100%', minHeight: 0, padding: 12, boxSizing: 'border-box' }
  );

const layoutStyles = (fill: boolean) =>
  mergeStyles(
    { display: 'flex', gap: '12px', alignItems: 'stretch' },
    fill && { flex: '1 1 auto', minHeight: 0 }
  );

const canvasStyles = (fill: boolean, background: string) =>
  mergeStyles(
    {
      flex: '1 1 auto',
      minWidth: 0,
      border: '1px solid var(--color-stroke)',
      borderRadius: 'var(--radius-sm)',
      // Same colour as the SVG's own canvas, so the area the drawing does not
      // cover blends in (it used to show a lighter band in dark mode).
      backgroundColor: background,
      overflow: 'auto',
      cursor: 'grab',
      ':active': { cursor: 'grabbing' },
      ':focus-visible': { outline: '2px solid var(--color-brand)', outlineOffset: '1px' },
      selectors: { '> svg': { display: 'block' } },
    },
    fill ? { minHeight: 0 } : { minHeight: '420px', maxHeight: '620px' }
  );

const sidebarStyles = (fill: boolean) =>
  mergeStyles(
    {
      flex: '0 0 320px',
      border: '1px solid var(--color-stroke)',
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'var(--color-bg-card)',
      color: 'var(--color-fg)',
      padding: '12px',
      overflow: 'auto',
    },
    fill ? { minHeight: 0 } : { minHeight: '420px', maxHeight: '620px' }
  );

const helpStyles = mergeStyles({
  margin: 0,
  fontSize: 'var(--font-size-sm)',
  lineHeight: 'var(--line-height-sm)',
  color: 'var(--color-fg-secondary)',
  flex: '0 0 auto',
});

const codeStyles = mergeStyles({
  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  fontSize: '11px',
  // A string: merge-styles turns a bare number into "1.5px", which stacked every
  // line of the definition on top of the previous one.
  lineHeight: '1.5',
  backgroundColor: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-stroke)',
  borderRadius: '2px',
  padding: '8px',
  margin: 0,
  whiteSpace: 'pre',
  overflowX: 'auto',
  maxHeight: '260px',
});

const fieldLabelStyles = mergeStyles({
  fontSize: '11px',
  color: 'var(--color-fg-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: '2px',
});

const fieldValueStyles = mergeStyles({
  fontSize: '13px',
  color: 'var(--color-fg)',
  wordBreak: 'break-word',
  marginBottom: '10px',
});

export const FlowDiagramTab: React.FC<FlowDiagramTabProps> = ({
  actions,
  trigger,
  flowDefinition,
  flowName,
  selectedKey,
  onSelect,
  searchText,
  onRevealRange,
  layout = 'panel',
  showDetails = true,
}) => {
  const fill = layout === 'fill';
  const resolvedTheme = useResolvedTheme();
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const draggedRef = useRef(false);

  const containers = useMemo(
    () =>
      actions
        .filter(
          a =>
            CONTAINER_TYPES.indexOf(a.Type) >= 0 &&
            actions.some(child => (child.parent || '').split('/')[0] === a.Name)
        )
        .map(a => a.Name),
    [actions]
  );

  const diagram = useMemo(() => {
    if (!actions || actions.length === 0) return null;
    try {
      return buildDiagram(actions, trigger, { collapsed });
    } catch (error) {
      console.error('Diagram layout error:', error);
      return null;
    }
  }, [actions, trigger, collapsed]);

  // On screen the diagram is interactive and painted with the page's tokens; the
  // export drops the hit targets and uses plain colours so the file stands alone.
  const interactiveSvg = useMemo(
    () => (diagram ? renderDiagramSvg(diagram, { interactive: true, theme: resolvedTheme }) : ''),
    [diagram, resolvedTheme]
  );

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.innerHTML = interactiveSvg;
  }, [interactiveSvg]);

  // Zoom is applied to the rendered size only; the viewBox keeps intrinsic units.
  useEffect(() => {
    const svg = canvasRef.current?.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', String(svg.viewBox.baseVal.width * zoom));
    svg.setAttribute('height', String(svg.viewBox.baseVal.height * zoom));
  }, [interactiveSvg, zoom]);

  // Selection and search are applied as attributes rather than by re-rendering,
  // so scroll position and zoom survive.
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;

    const term = (searchText || '').trim().toLowerCase();
    const matches = new Set(
      term
        ? actions
            .filter(
              a =>
                a.Name.toLowerCase().includes(term) ||
                a.Type.toLowerCase().includes(term) ||
                (a.connector || '').toLowerCase().includes(term)
            )
            .map(a => a.Name)
        : []
    );

    root.querySelectorAll('[data-node], [data-frame]').forEach(el => {
      const key = el.getAttribute('data-node') || el.getAttribute('data-frame');
      if (!key) return;

      if (key === selectedKey) el.setAttribute('data-selected', 'true');
      else el.removeAttribute('data-selected');

      if (!el.hasAttribute('data-node')) return;
      if (term && matches.has(key)) {
        el.setAttribute('data-match', 'true');
        el.removeAttribute('data-dimmed');
      } else if (term && key !== TRIGGER_KEY) {
        el.removeAttribute('data-match');
        el.setAttribute('data-dimmed', 'true');
      } else {
        el.removeAttribute('data-match');
        el.removeAttribute('data-dimmed');
      }
    });
  }, [selectedKey, interactiveSvg, searchText, actions]);

  // Selection can arrive from another tab, so bring it into view.
  useEffect(() => {
    if (!selectedKey || !canvasRef.current) return;
    // CSS.escape is not in every host (older WebViews, jsdom), so fall back.
    const escaped =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(selectedKey)
        : selectedKey.replace(/["\\]/g, '\\$&');
    const el = canvasRef.current.querySelector(`[data-node="${escaped}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (draggedRef.current) return; // the click was the end of a pan

      const target = event.target as Element | null;

      const toggle = target?.closest?.('[data-toggle]');
      if (toggle) {
        toggleCollapse(toggle.getAttribute('data-toggle')!);
        return;
      }

      const hit = target?.closest?.('[data-node], [data-frame]');
      onSelect(hit ? hit.getAttribute('data-node') || hit.getAttribute('data-frame') : null);
    },
    [onSelect, toggleCollapse]
  );

  const handleCanvasKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onSelect(null);
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;

      const hit = (event.target as Element | null)?.closest?.('[data-node], [data-frame]');
      if (!hit) return;
      event.preventDefault();
      onSelect(hit.getAttribute('data-node') || hit.getAttribute('data-frame'));
    },
    [onSelect]
  );

  // --- drag to pan ----------------------------------------------------------
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    const container = canvasRef.current;
    if (!container || event.button !== 0) return;
    draggedRef.current = false;
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: container.scrollLeft,
      top: container.scrollTop,
    };
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    const container = canvasRef.current;
    const pan = panRef.current;
    if (!container || !pan) return;

    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    // Below this the gesture is still a click, not a drag.
    if (!draggedRef.current && Math.abs(dx) + Math.abs(dy) < 5) return;

    draggedRef.current = true;
    container.scrollLeft = pan.left - dx;
    container.scrollTop = pan.top - dy;
  }, []);

  const endPan = useCallback(() => {
    panRef.current = null;
    // Cleared after the click event has had a chance to read it.
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  }, []);

  const fitToWidth = useCallback(() => {
    const container = canvasRef.current;
    const svg = container?.querySelector('svg');
    if (!container || !svg) return;
    const natural = svg.viewBox.baseVal.width;
    if (natural) setZoom(Math.min(1, (container.clientWidth - 24) / natural));
  }, []);

  const allCollapsed = containers.length > 0 && containers.every(c => collapsed.has(c));

  const downloadSvg = useCallback(async () => {
    if (!diagram) return;
    // Static export: no hit targets, no hover styling, no CSS variables.
    const clean = renderDiagramSvg(diagram, { interactive: false });
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

  if (!diagram) return <Text>No actions to display in the diagram.</Text>;

  return (
    <div className={rootStyles(fill)}>
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
        {containers.length > 0 && (
          <DefaultButton
            iconProps={{ iconName: allCollapsed ? 'ExploreContent' : 'CollapseContent' }}
            text={allCollapsed ? 'Expand all' : 'Collapse all'}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(containers))}
          />
        )}
        <Text variant="small" styles={{ root: { color: 'var(--color-fg-secondary)' } }}>
          {Math.round(zoom * 100)}%
        </Text>
      </Stack>

      <div className={layoutStyles(fill)}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={canvasStyles(fill, diagramCanvasColor(resolvedTheme))}
          ref={canvasRef}
          onClick={handleCanvasClick}
          onKeyDown={handleCanvasKeyDown}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          role="application"
          aria-label="Flow diagram"
          tabIndex={-1}
        />

        {selectedKey && showDetails && (
          <div className={sidebarStyles(fill)}>
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
                onClick={() => onSelect(null)}
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
                <Text
                  variant="small"
                  styles={{ root: { color: 'var(--color-fg-secondary)', display: 'block', marginBottom: 4 } }}
                >
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

      <p className={helpStyles}>
        {showDetails
          ? 'Click a card to inspect it, the chevron on a scope to collapse it, or drag to pan.'
          : 'Click a card to show its JSON in the editor, the chevron on a scope to collapse it, or drag to pan.'}{' '}
        Dashed connectors run after something other than plain success; the dots above a card
        show which statuses: green succeeded, red failed, orange timed out, grey skipped.
      </p>
    </div>
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
  // A Switch case is parented as "Switch_name/case_name"; show them separately.
  const [container, caseName] = (action.parent || '').split('/');

  return (
    <div style={{ marginTop: 10 }}>
      <Field label="Type" value={action.Type} />
      <Field label="Connector" value={action.connector?.replace(/^shared_/, '')} />
      <Field label="Tier" value={action.tier} />
      {/* Scopes and Terminate are structural: the analyzer marks them -1 ("adds nothing"). */}
      <Field label="Complexity" value={action.Complexity >= 0 ? action.Complexity : null} />
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
      <Field label="Nested in" value={container?.replace(/_/g, ' ')} />
      <Field label="Branch" value={caseName?.replace(/_/g, ' ') || action.branch} />
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
