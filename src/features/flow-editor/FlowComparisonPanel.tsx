import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  DefaultButton,
  PrimaryButton,
  TextField,
  mergeStyles,
  Icon,
  Link,
  Spinner,
  SpinnerSize,
} from '@fluentui/react';
import {
  FlowBaseline,
  FlowComparisonService,
  FlowComparisonResult,
  FlowDifference,
} from '../../services/FlowComparisonService';
import { MetricCard, MetricRow } from './components/MetricCard';

interface FlowComparisonPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** Text currently in the editor. */
  currentFlowDefinition: string;
  /** Text as last loaded from / saved to the server. */
  serverFlowDefinition: string;
  flowName: string;
  envId: string;
  flowId: string;
  /** Show a JSON pointer location in the editor. */
  onRevealPointer?: (pointer: string) => void;
  /** Injected in tests; defaults to chrome.storage / localStorage. */
  service?: FlowComparisonService;
}

type Comparison = { against: 'baseline' | 'server'; result: FlowComparisonResult; caption: string };

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-sm)',
  backgroundColor: 'var(--color-bg-card)',
  color: 'var(--color-fg)',
});

const statusStyles = mergeStyles({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-stroke)',
  backgroundColor: 'var(--color-bg-subtle)',
  color: 'var(--color-fg)',
});

const monoStyles = { root: { fontFamily: 'var(--font-family-mono)', fontSize: 12 } };

function pointerFor(path: Array<string | number>): string {
  return '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function parse(text: string, what: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      error: `The ${what} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix it, then compare again.`,
    };
  }
}

export const FlowComparisonPanel: React.FC<FlowComparisonPanelProps> = ({
  isOpen,
  onDismiss,
  currentFlowDefinition,
  serverFlowDefinition,
  flowName,
  envId,
  flowId,
  onRevealPointer,
  service,
}) => {
  const comparisonService = useMemo(() => service || new FlowComparisonService(), [service]);
  const [baseline, setBaseline] = useState<FlowBaseline | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [label, setLabel] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setComparison(null);
    setError(null);
    setNotice(null);
    setLoadingBaseline(true);
    comparisonService
      .getBaseline(envId, flowId)
      .then((stored) => !cancelled && setBaseline(stored))
      .catch((err) => !cancelled && setError(`Could not read the saved baseline: ${err?.message || err}`))
      .finally(() => !cancelled && setLoadingBaseline(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, envId, flowId, comparisonService]);

  const savedAtText = baseline ? FlowComparisonService.formatSavedAt(baseline.savedAt) : '';

  const handleStore = useCallback(async () => {
    setError(null);
    setNotice(null);
    const parsed = parse(currentFlowDefinition, 'editor text');
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    try {
      const stored = await comparisonService.saveBaseline(envId, flowId, parsed.value, { flowName, label });
      setBaseline(stored);
      setComparison(null);
      setLabel('');
      setNotice(`Baseline saved ${FlowComparisonService.formatSavedAt(stored.savedAt)}.`);
    } catch (err) {
      setError(`Could not save the baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentFlowDefinition, comparisonService, envId, flowId, flowName, label]);

  const handleCompareBaseline = useCallback(() => {
    if (!baseline) return;
    setError(null);
    setNotice(null);
    const parsed = parse(currentFlowDefinition, 'editor text');
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    try {
      setComparison({
        against: 'baseline',
        result: comparisonService.compareWithBaseline(baseline, parsed.value),
        caption: `Editor compared with the baseline saved ${savedAtText}${baseline.label ? ` ("${baseline.label}")` : ''}.`,
      });
    } catch (err) {
      setError(`Comparison failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [baseline, currentFlowDefinition, comparisonService, savedAtText]);

  const handleCompareServer = useCallback(() => {
    setError(null);
    setNotice(null);
    const current = parse(currentFlowDefinition, 'editor text');
    const server = parse(serverFlowDefinition, 'server version');
    if (!current.ok || !server.ok) {
      setError((!current.ok && current.error) || (!server.ok && server.error) || 'Comparison failed.');
      return;
    }
    try {
      setComparison({
        against: 'server',
        result: comparisonService.compare(server.value, current.value),
        caption: 'Editor compared with the last version loaded from or saved to the server.',
      });
    } catch (err) {
      setError(`Comparison failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentFlowDefinition, serverFlowDefinition, comparisonService]);

  const handleClear = useCallback(async () => {
    setError(null);
    try {
      await comparisonService.clearBaseline(envId, flowId);
      setBaseline(null);
      if (comparison?.against === 'baseline') setComparison(null);
      setNotice('Baseline cleared.');
    } catch (err) {
      setError(`Could not clear the baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [comparisonService, envId, flowId, comparison]);

  const columns: IColumn[] = useMemo(
    () => [
      {
        key: 'kind',
        name: 'Change',
        minWidth: 80,
        maxWidth: 110,
        onRender: (item: FlowDifference) => (
          <Text
            styles={{
              root: { color: FlowComparisonService.getDifferenceColor(item.kind), fontWeight: 600 },
            }}
          >
            {FlowComparisonService.getDifferenceLabel(item.kind)}
          </Text>
        ),
      },
      {
        key: 'path',
        name: 'Path',
        fieldName: 'pathString',
        minWidth: 200,
        maxWidth: 400,
        isResizable: true,
        isMultiline: true,
        onRender: (item: FlowDifference) =>
          onRevealPointer && item.path.length > 0 ? (
            <Link
              styles={monoStyles}
              title="Show this location in the editor"
              onClick={() => onRevealPointer(pointerFor(item.path))}
            >
              {item.pathString}
            </Link>
          ) : (
            <Text styles={monoStyles}>{item.pathString || 'root'}</Text>
          ),
      },
      {
        key: 'lhs',
        name: comparison?.against === 'server' ? 'Server' : 'Baseline',
        minWidth: 150,
        maxWidth: 250,
        isResizable: true,
        onRender: (item: FlowDifference) => (
          <Text styles={{ root: { color: 'var(--color-fg-secondary)', fontSize: 12, fontFamily: 'var(--font-family-mono)' } }}>
            {item.lhs !== undefined ? truncateValue(item.lhs) : '—'}
          </Text>
        ),
      },
      {
        key: 'rhs',
        name: 'Editor',
        minWidth: 150,
        maxWidth: 250,
        isResizable: true,
        onRender: (item: FlowDifference) => (
          <Text styles={{ root: { color: 'var(--color-fg)', fontSize: 12, fontFamily: 'var(--font-family-mono)' } }}>
            {item.rhs !== undefined ? truncateValue(item.rhs) : '—'}
          </Text>
        ),
      },
    ],
    [onRevealPointer, comparison?.against]
  );

  const result = comparison?.result;

  return (
    <Panel
      isOpen={isOpen}
      onDismiss={onDismiss}
      type={PanelType.large}
      headerText={`Compare: ${flowName}`}
      closeButtonAriaLabel="Close"
    >
      <Stack tokens={{ childrenGap: 16 }} styles={{ root: { paddingTop: 12 } }}>
        {/* Which baseline is active */}
        <div className={statusStyles} role="status">
          {loadingBaseline ? (
            <Spinner size={SpinnerSize.small} label="Looking for a saved baseline…" />
          ) : baseline ? (
            <>
              <Icon iconName="History" styles={{ root: { fontSize: 18, color: 'var(--color-brand)', marginTop: 2 } }} />
              <div>
                <Text block styles={{ root: { fontWeight: 600 } }}>
                  Baseline saved {savedAtText}
                  {baseline.label ? ` — ${baseline.label}` : ''}
                </Text>
                <Text block variant="small" styles={{ root: { color: 'var(--color-fg-secondary)' } }}>
                  Kept for this flow only, in this browser.
                </Text>
              </div>
            </>
          ) : (
            <>
              <Icon iconName="Info" styles={{ root: { fontSize: 18, color: 'var(--color-brand)', marginTop: 2 } }} />
              <div>
                <Text block styles={{ root: { fontWeight: 600 } }}>
                  No baseline saved for this flow
                </Text>
                <Text block variant="small" styles={{ root: { color: 'var(--color-fg-secondary)' } }}>
                  Compare with the server version to see your unsaved edits, or save the editor text as a
                  baseline before you start changing things.
                </Text>
              </div>
            </>
          )}
        </div>

        {error && (
          <MessageBar messageBarType={MessageBarType.error} isMultiline onDismiss={() => setError(null)}>
            {error}
          </MessageBar>
        )}
        {notice && !error && (
          <MessageBar messageBarType={MessageBarType.success} onDismiss={() => setNotice(null)}>
            {notice}
          </MessageBar>
        )}

        {/* Actions */}
        <Stack horizontal wrap tokens={{ childrenGap: 8 }} verticalAlign="end">
          {baseline ? (
            <PrimaryButton iconProps={{ iconName: 'BranchCompare' }} text="Compare with baseline" onClick={handleCompareBaseline} />
          ) : null}
          {baseline ? (
            <DefaultButton iconProps={{ iconName: 'Cloud' }} text="Compare with server version" onClick={handleCompareServer} />
          ) : (
            <PrimaryButton iconProps={{ iconName: 'Cloud' }} text="Compare with server version" onClick={handleCompareServer} />
          )}
          {baseline && (
            <DefaultButton iconProps={{ iconName: 'Delete' }} text="Clear baseline" onClick={handleClear} />
          )}
        </Stack>

        <Stack horizontal wrap tokens={{ childrenGap: 8 }} verticalAlign="end">
          <TextField
            label={baseline ? 'Replace the baseline with the editor text' : 'Save the editor text as a baseline'}
            placeholder="Label (optional), e.g. Before refactor"
            value={label}
            onChange={(_, value) => setLabel(value || '')}
            styles={{ root: { width: 320 } }}
          />
          <DefaultButton
            iconProps={{ iconName: 'Save' }}
            text={baseline ? 'Replace baseline' : 'Save as baseline'}
            onClick={handleStore}
          />
        </Stack>

        {/* Results */}
        {comparison && result && (
          <Stack tokens={{ childrenGap: 12 }}>
            <Text variant="small" styles={{ root: { color: 'var(--color-fg-secondary)' } }}>
              {comparison.caption}
            </Text>
            <MetricRow label="Comparison summary">
              <MetricCard label="Added" value={result.newItems.length} tone={result.newItems.length ? 'success' : 'neutral'} />
              <MetricCard label="Removed" value={result.deletedItems.length} tone={result.deletedItems.length ? 'danger' : 'neutral'} />
              <MetricCard label="Changed" value={result.editedItems.length} tone={result.editedItems.length ? 'warning' : 'neutral'} />
              <MetricCard label="Array changes" value={result.arrayChanges.length} tone={result.arrayChanges.length ? 'info' : 'neutral'} />
            </MetricRow>

            <div className={cardStyles}>
              <Stack horizontal tokens={{ childrenGap: 24 }} wrap>
                <Text>
                  <strong>Actions:</strong> +{result.summary.actionsAdded} / −{result.summary.actionsRemoved} / ~
                  {result.summary.actionsModified}
                </Text>
                <Text>
                  <strong>Variables:</strong> {result.summary.variablesChanged}
                </Text>
                <Text>
                  <strong>Connections:</strong> {result.summary.connectionsChanged}
                </Text>
                <Text>
                  <strong>Other:</strong> {result.summary.otherChanges}
                </Text>
              </Stack>
            </div>

            {!result.hasDifferences ? (
              <MessageBar messageBarType={MessageBarType.success}>
                No differences: the editor matches the {comparison.against === 'server' ? 'server version' : 'baseline'}.
              </MessageBar>
            ) : (
              <div className={cardStyles}>
                <Text variant="mediumPlus" block styles={{ root: { fontWeight: 600, marginBottom: 8 } }}>
                  All differences ({result.totalDifferences})
                </Text>
                <DetailsList
                  items={result.differences}
                  columns={columns}
                  layoutMode={DetailsListLayoutMode.justified}
                  selectionMode={SelectionMode.none}
                  isHeaderVisible
                  compact
                />
              </div>
            )}
          </Stack>
        )}
      </Stack>
    </Panel>
  );
};

function truncateValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.length > 50) {
    return str.substring(0, 47) + '...';
  }
  return str;
}

export default FlowComparisonPanel;
