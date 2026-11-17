import { ICommandBarItemProps } from '@fluentui/react/lib/CommandBar';
import { MessageBarType } from '@fluentui/react/lib/MessageBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderModal } from '../../components/shared/LoaderModal';
import { useApiProviderContext } from '../../services/ApiProvider';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import RecentRunsPanel, { recentRunHistoryUrl } from '../run-history/RecentRunsPanel';
import type { RecentStep } from '../run-history/runHistoryApi';
import { dynamicRunLinkExpression } from '../run-history/runPayload';
import { PublishConfirmDialog, SaveConfirmDialog } from './components/ConfirmDialogs';
import { DraftRecoveryBanner } from './components/DraftRecoveryBanner';
import { FlowEditorHeader, groupStartStyles, primaryCommandStyles } from './components/FlowEditorHeader';
import { EditorView, isEditorView, ViewSwitch } from './components/ViewSwitch';
import { FlowDiagramView } from './FlowDiagramView';
import { ConnectionsPanel } from './ConnectionsPanel';
import { ConnectionAvailabilityPanel } from './ConnectionAvailabilityPanel';
import { FlowNavigationPanel, NavigationMode } from './FlowNavigationPanel';
import { SolutionImportPanel } from './SolutionImportPanel';
import { workflowNavigation } from './workflowNavigation';
import { copyText, downloadText, jsonFileName } from './browserActions';
import { parseEditorText, strategyFor } from './flowPersistence';
import { ConnectionChange, describeConnectionChanges, getConnectionIssues } from './flowConnections';
import { applyServerText, isTextDirty } from './editorSync';
import { FlowAnalysisPanel } from './FlowAnalysisPanel';
import { FlowComparisonPanel } from './FlowComparisonPanel';
import { ManagedSolutionExportPanel } from './ManagedSolutionExportPanel';
import { findActionRange, findPointerRange, JsonRange } from './flowJsonLocator';
import { FlowValidationResult } from './FlowValidationResult';
import { monaco } from './monacoSetup';
import { readPreference, rememberSaveConfirmed, shouldConfirmSave, writePreference } from './savePreferences';
import { SolutionAnalysisPanel } from './SolutionAnalysisPanel';
import { useFlowEditor } from './useFlowEditor';
import { useDefinitionView } from './useDefinitionView';
import { useDraftRecovery } from './useDraftRecovery';
import { StatusMessages } from './useStatusMessages';

type IEditor = monaco.editor.IStandaloneCodeEditor;
type WriteDialog = { kind: 'save' | 'publish'; text: string; baseline: string; connectionChanges: ConnectionChange[] };

const pageClass = mergeStyles({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--color-bg)',
});

const workspaceClass = mergeStyles({
  flex: 1,
  minHeight: 0,
  display: 'flex',
});

const VIEW_PREFERENCE_KEY = 'paToolkit.flowEditor.view';
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 14,
  wordWrap: 'on',
  automaticLayout: true,
};

const editorPaneClass = (view: EditorView) =>
  mergeStyles({
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 0,
    // Hidden rather than unmounted in Diagram view: the model, undo history and
    // scroll position survive switching back.
    display: view === 'diagram' || view === 'definition' ? 'none' : 'block',
  });

const diagramPaneClass = (view: EditorView) =>
  mergeStyles({
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 0,
    borderLeft: view === 'split' ? '1px solid var(--color-stroke)' : 'none',
  });

export const FlowEditorPage: React.FC = () => {
  const resolvedTheme = useResolvedTheme();
  const api = useApiProviderContext();
  const [editor, setEditor] = useState<IEditor | null>(null);
  const [portalUrl] = useState(() => new URLSearchParams(window.location.search).get('portalUrl') ?? undefined);
  const definitionView = useDefinitionView(editor);
  const [isDirty, setIsDirty] = useState(false);
  const [dialog, setDialog] = useState<WriteDialog | null>(null);
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [recentRunsOpen, setRecentRunsOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [solutionPanelOpen, setSolutionPanelOpen] = useState(false);
  const [managedExportOpen, setManagedExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [navigationMode, setNavigationMode] = useState<NavigationMode>();
  /** Editor text captured when a panel opens, so panels analyse what you see. */
  const [panelText, setPanelText] = useState('');
  const [view, setViewState] = useState<EditorView>(() => {
    const stored = readPreference(VIEW_PREFERENCE_KEY);
    return isEditorView(stored) && stored !== 'definition' ? stored : 'json';
  });
  /** Live editor text for the diagram; only tracked while the diagram is visible. */
  const [liveText, setLiveText] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Messages can start a save themselves (e.g. "Try saving through Dataverse");
  // they read the editor and hand the server text back through these.
  const editorRef = useRef<IEditor | null>(null);
  editorRef.current = editor;
  const onMessageSaveRef = useRef<(sent: string, serverText: string) => void>(() => undefined);

  const {
    envId,
    flowId,
    name,
    environment,
    savedText,
    busy,
    isLoading,
    saveDraft,
    publish,
    validate,
    messages,
    showMessage,
    dismissMessage,
    validation,
    validationPaneIsOpen,
    setValidationPaneIsOpen,
    workflowEntityId,
    saveMethod,
    copyDiagnostics,
  } = useFlowEditor({
    getText: () => editorRef.current?.getValue(),
    onSaved: (sent, serverText) => onMessageSaveRef.current(sent, serverText),
  });
  const recovery = useDraftRecovery({ envId, flowId, savedText, editor });
  const saveMethodLabel = strategyFor(saveMethod.effective).label;

  const environmentLabel = environment?.displayName || environment?.id || 'this environment';
  const flowName = name || 'Loading…';

  // --- Dirty tracking -------------------------------------------------------
  const savedTextRef = useRef(savedText);
  savedTextRef.current = savedText;

  const recomputeDirty = useCallback(() => {
    setIsDirty(isTextDirty(editor?.getModel() ?? null, savedTextRef.current));
  }, [editor]);

  const viewRef = useRef(view);
  viewRef.current = view;
  const handleEditorChange = useCallback(() => {
    recomputeDirty();
    if ((viewRef.current === 'diagram' || viewRef.current === 'split') && editor) setLiveText(editor.getValue());
  }, [recomputeDirty, editor]);

  const setView = useCallback(
    (next: EditorView) => {
      if (next === viewRef.current) return;
      if (next === 'definition') {
        if (recovery.awaitingChoice || !editor) return;
        const parsed = parseEditorText(editor.getValue(), name);
        if (!parsed.ok || !definitionView.open()) {
          showMessage(parsed.ok ? 'The definition could not be opened.' : parsed.error, MessageBarType.error);
          return;
        }
      } else {
        definitionView.close();
        writePreference(VIEW_PREFERENCE_KEY, next);
      }
      setViewState(next);
      if (next === 'diagram' || next === 'split') setLiveText(editor?.getValue() || savedTextRef.current);
    },
    [definitionView, editor, name, recovery.awaitingChoice, showMessage]
  );

  // The diagram needs text before the editor has mounted (Diagram view on load).
  useEffect(() => {
    if (view === 'diagram' || view === 'split') setLiveText(editor?.getValue() || savedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedText, editor]);

  useEffect(() => {
    recomputeDirty();
  }, [savedText, recomputeDirty]);

  useEffect(() => {
    document.title = `${isDirty ? '● ' : ''}${flowName} — Flow editor`;
  }, [isDirty, flowName]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome shows its own "Leave site?" text; returnValue just has to be set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // --- Save / publish -------------------------------------------------------
  const finishSave = (sent: string, serverText: string) => {
    if (editor && applyServerText(editor, sent, serverText) === 'replaced') definitionView.sync(serverText);
    recovery.onSaved(sent, serverText);
    recomputeDirty();
  };
  onMessageSaveRef.current = finishSave;

  const performWrite = useCallback(async (kind: WriteDialog['kind'], sent: string) => {
    const result = await (kind === 'save' ? saveDraft(sent) : publish(sent));
    if (result.ok) onMessageSaveRef.current(sent, result.serverText);
  }, [saveDraft, publish]);

  const requestWrite = useCallback((kind: WriteDialog['kind']) => {
    if (!editor || busy || dialog || recovery.awaitingChoice) return;
    const text = editor.getValue();
    const parsed = parseEditorText(text, name);
    const issue = parsed.ok ? getConnectionIssues(parsed.doc)[0] : parsed.error;
    if (!parsed.ok || issue) {
      showMessage(`Cannot ${kind}: ${issue}`, MessageBarType.error);
      return;
    }
    const baseline = savedTextRef.current;
    const previous = parseEditorText(baseline, name);
    const connectionChanges = previous.ok ? describeConnectionChanges(previous.doc, parsed.doc) : [];
    if (kind === 'publish' || connectionChanges.length || shouldConfirmSave()) {
      setDialog({ kind, text, baseline, connectionChanges });
    } else {
      void performWrite(kind, text);
    }
  }, [editor, busy, dialog, recovery.awaitingChoice, name, showMessage, performWrite]);

  const confirmWrite = (dontAskAgain?: boolean) => {
    if (!dialog) return;
    setDialog(null);
    if (editor?.getValue() !== dialog.text || savedTextRef.current !== dialog.baseline) {
      showMessage('The flow changed after this preview opened. Review the current version and try again.', MessageBarType.warning);
      return;
    }
    if (dialog.kind === 'save') rememberSaveConfirmed(!!dontAskAgain);
    void performWrite(dialog.kind, dialog.text);
  };

  // Ctrl/Cmd+S: Monaco handles it while the editor has focus (addCommand in
  // onMount); this listener covers focus anywhere else on the page.
  const requestSaveRef = useRef<() => void>(() => undefined);
  requestSaveRef.current = () => requestWrite('save');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      // Never let the browser's "Save page as" dialog open over the editor.
      event.preventDefault();
      if (editor?.hasTextFocus()) return;
      requestSaveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  const handleMount = useCallback((mounted: IEditor) => {
    mounted.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => requestSaveRef.current());
    setEditor(mounted);
    const range = findPointerRange(mounted.getValue(), '/connectionReferences');
    const fold = mounted.getAction('editor.fold');
    const original = mounted.getPosition();
    if (!range?.exact || range.endLine <= range.startLine || !fold || !original) return;
    // Standalone Monaco's built-in action reads the selection instead of arguments.
    const anchor = new monaco.Position(range.startLine, range.startColumn);
    mounted.setPosition(anchor);
    void fold.run().then(() => {
      const current = mounted.getPosition();
      if (current && anchor.equals(current)) mounted.setPosition(original);
    }, () => undefined);
  }, []);

  // --- Reveal ----------------------------------------------------------------
  const revealRange = useCallback(
    (range: JsonRange, opts: { focus?: boolean } = {}) => {
      if (!editor) return;
      const selection = new monaco.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
      editor.setSelection(selection);
      editor.revealRangeInCenterIfOutsideViewport(selection, monaco.editor.ScrollType.Smooth);
      if (opts.focus !== false) editor.focus();
    },
    [editor]
  );

  /** Diagram selection: in Split view it follows along in the JSON without moving focus. */
  const handleNodeSelect = useCallback(
    (key: string | null) => {
      setSelectedNode(key);
      if (!key || view !== 'split' || !editor) return;
      const text = editor.getValue();
      let range = findActionRange(text, key);
      if (!range && key === '__trigger__') {
        range = findPointerRange(text, '/definition/triggers');
      }
      if (range) revealRange(range, { focus: false });
    },
    [view, editor, revealRange]
  );

  /** "Show in editor" from the Diagram view opens the JSON beside it. */
  const showInEditor = useCallback(
    (range: JsonRange) => {
      if (view === 'diagram') setView('split');
      // Let the editor pane become visible and lay out before revealing.
      window.requestAnimationFrame(() => revealRange(range));
    },
    [view, setView, revealRange]
  );

  const revealPointer = useCallback(
    (pointer: string) => {
      const range = editor && findPointerRange(editor.getValue(), pointer);
      if (!range) return false;
      if (viewRef.current === 'definition' || viewRef.current === 'diagram') setView('json');
      window.requestAnimationFrame(() => revealRange(range));
      return true;
    },
    [editor, revealRange, setView]
  );

  const revealOperation = useCallback(
    (operationName: string) => {
      const range = editor && findActionRange(editor.getValue(), operationName);
      if (!range) return false;
      if (viewRef.current === 'definition' || viewRef.current === 'diagram') setView('json');
      window.requestAnimationFrame(() => revealRange(range));
      return true;
    },
    [editor, revealRange, setView]
  );

  const revealRunStep = (step: RecentStep) => {
    try {
      const { operations } = workflowNavigation(editor?.getValue() || savedText);
      const eligible = operations.filter(operation => operation.kind.toLowerCase() === step.kind);
      const matches = eligible.filter(operation => operation.name === step.name);
      const match = matches.length === 1 ? matches[0] : step.kind === 'trigger' && eligible.length === 1 ? eligible[0] : undefined;
      if (!match || !revealPointer(match.pointer)) return false;
      setRecentRunsOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  // --- Commands --------------------------------------------------------------
  const downloadJson = useCallback(() => {
    const json = editor?.getValue() || savedText;
    if (!json) return;
    downloadText(jsonFileName(name), json);
  }, [editor, savedText, name]);

  const reconnect = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'refresh' });
    showMessage(
      'Reloading the Power Automate tab to capture a fresh sign-in token. Try again in a few seconds.',
      MessageBarType.info
    );
  }, [showMessage]);

  const openWithText = (open: (value: boolean) => void) => () => {
    setPanelText(editor?.getValue() || savedText);
    open(true);
  };

  const openNavigation = (mode: NavigationMode) => () => {
    setPanelText(editor?.getValue() || savedText);
    setNavigationMode(mode);
  };

  const noFlow = !editor || !savedText;
  const runHistoryUrl = envId && flowId ? recentRunHistoryUrl({ envId, flowId }, portalUrl,
    api.endpoints?.legacyApiUrl ?? api.endpoints?.powerPlatformApiUrl ?? api.endpoints?.apiUrl) : undefined;
  const makerOrigin = runHistoryUrl ? new URL(runHistoryUrl).origin : undefined;
  const copyRunLink = useCallback(async () => {
    if (!makerOrigin) return;
    const copied = await copyText(dynamicRunLinkExpression(makerOrigin));
    showMessage(copied ? 'Dynamic run link expression copied.' : 'Clipboard access was unavailable.',
      copied ? MessageBarType.success : MessageBarType.error);
  }, [makerOrigin, showMessage]);
  const manageUrl = runHistoryUrl && envId
    ? new URL(`/environments/${encodeURIComponent(envId)}/${workflowEntityId ? 'solutions' : 'connections'}`, runHistoryUrl).href
    : undefined;
  const items: ICommandBarItemProps[] = useMemo(
    () => [
      {
        key: 'save',
        text: busy === 'saving' ? 'Saving…' : 'Save',
        title: 'Save draft (Ctrl+S)',
        iconProps: { iconName: 'Save' },
        disabled: noFlow || !!busy || recovery.awaitingChoice,
        buttonStyles: primaryCommandStyles,
        onClick: () => requestWrite('save'),
      },
      {
        key: 'publish',
        text: busy === 'publishing' ? 'Publishing…' : 'Publish',
        title: 'Save and publish this flow',
        iconProps: { iconName: 'PublishContent' },
        disabled: noFlow || !!busy || recovery.awaitingChoice,
        onClick: () => requestWrite('publish'),
      },
      {
        key: 'validate',
        text: 'Validate',
        title: 'Check the definition against the schema and the flow checker',
        iconProps: { iconName: 'ComplianceAudit' },
        disabled: noFlow || !!busy,
        buttonStyles: groupStartStyles,
        onClick: () => {
          if (editor) validate(editor.getValue());
        },
      },
      {
        key: 'analyze',
        text: 'Analyze',
        title: 'Complexity, exception handling, actions, variables and connections',
        iconProps: { iconName: 'BarChart4' },
        disabled: noFlow,
        onClick: openWithText(setAnalysisPanelOpen),
      },
      {
        key: 'compare',
        text: 'Compare',
        title: 'Compare the editor with a saved baseline or the server version',
        iconProps: { iconName: 'BranchCompare' },
        disabled: noFlow,
        onClick: openWithText(setComparisonPanelOpen),
      },
      {
        key: 'connections',
        text: 'Connections',
        title: 'Inspect connection references and the steps that use them',
        iconProps: { iconName: 'PlugConnected' },
        disabled: noFlow,
        onClick: openWithText(setConnectionsOpen),
      },
      {
        key: 'recent-runs',
        text: 'Recent runs',
        iconProps: { iconName: 'History' },
        disabled: noFlow,
        onClick: () => setRecentRunsOpen(true),
      },
      {
        key: 'find-action',
        text: 'Find action',
        iconProps: { iconName: 'Search' },
        disabled: noFlow,
        onClick: openNavigation('actions'),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noFlow, busy, editor, savedText, requestWrite, validate, recovery.awaitingChoice]
  );

  const overflowItems: ICommandBarItemProps[] = useMemo(
    () => [
      {
        key: 'download',
        text: 'Download JSON',
        iconProps: { iconName: 'Download' },
        disabled: noFlow,
        onClick: () => downloadJson(),
      },
      {
        key: 'export-managed',
        text: 'Export managed solution',
        title: 'Review recipient settings and download a managed Power Platform solution',
        iconProps: { iconName: 'Package' },
        disabled: noFlow,
        onClick: () => setManagedExportOpen(true),
      },
      {
        key: 'prepare-import',
        text: 'Prepare solution import',
        iconProps: { iconName: 'Import' },
        onClick: () => setImportOpen(true),
      },
      {
        key: 'where-used',
        text: 'Environment variables · Where used',
        iconProps: { iconName: 'Variable' },
        disabled: noFlow,
        onClick: openNavigation('settings'),
      },
      {
        key: 'copy-run-link',
        text: 'Copy dynamic run link',
        iconProps: { iconName: 'Link' },
        disabled: !makerOrigin,
        onClick: () => void copyRunLink(),
      },
      {
        key: 'check-availability',
        text: 'Check availability',
        iconProps: { iconName: 'Health' },
        onClick: () => setAvailabilityOpen(true),
      },
      {
        key: 'reconnect',
        text: 'Reconnect',
        title: 'Reload the Power Automate tab to capture a fresh sign-in token',
        secondaryText: 'Fresh sign-in token',
        iconProps: { iconName: 'PlugConnected' },
        onClick: () => reconnect(),
      },
      {
        key: 'solution',
        text: 'Analyze solution (.zip)',
        title: 'Analyze an exported solution package',
        iconProps: { iconName: 'Package' },
        onClick: () => setSolutionPanelOpen(true),
      },
      {
        key: 'saveMethod',
        text: 'Save method',
        title: 'Choose how Save and Publish write this environment\'s flows',
        iconProps: { iconName: 'CloudUpload' },
        subMenuProps: {
          items: [
            {
              key: 'save-flow',
              text: 'Flow service (default)',
              canCheck: true,
              checked: saveMethod.effective === 'flow',
              title: 'Save and publish through the Power Automate Flow service',
              onClick: () => {
                if (saveMethod.preference === 'flow') return;
                saveMethod.setPreference('flow');
                showMessage('Save and Publish go through the Flow service again for this environment.', MessageBarType.info);
              },
            },
            {
              key: 'save-dataverse',
              text: 'Dataverse — experimental',
              canCheck: true,
              checked: saveMethod.effective === 'dataverse',
              disabled: !saveMethod.dataverseAvailable,
              title: saveMethod.dataverseAvailable
                ? 'Save and publish this environment\'s solution flows through the Dataverse Web API. ' +
                  'Experimental: not yet verified on every tenant.'
                : saveMethod.dataverseUnavailableReason,
              ariaDescription: saveMethod.dataverseAvailable ? 'Experimental' : saveMethod.dataverseUnavailableReason,
              onClick: () => {
                saveMethod.setPreference('dataverse');
                showMessage(
                  'Save and Publish now go through Dataverse for this environment (experimental). ' +
                    'Switch back under More commands › Save method.',
                  MessageBarType.info
                );
              },
            },
          ],
        },
      },
      {
        key: 'diagnostics',
        text: 'Copy diagnostics',
        title: 'Copy recent request ids and status codes for a support request (no tokens or flow content)',
        iconProps: { iconName: 'Copy' },
        onClick: () => {
          copyDiagnostics();
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      noFlow,
      editor,
      savedText,
      downloadJson,
      makerOrigin,
      copyRunLink,
      reconnect,
      copyDiagnostics,
      saveMethod.effective,
      saveMethod.preference,
      saveMethod.dataverseAvailable,
      saveMethod.dataverseUnavailableReason,
      saveMethod.setPreference,
    ]
  );

  return (
    <div className={pageClass}>
      {isLoading && <LoaderModal />}
      <FlowEditorHeader
        flowName={flowName}
        environmentLabel={
          environment?.displayName ? `${environment.displayName}` : environment?.id ? `Environment ${environment.id}` : undefined
        }
        environmentTitle={environment ? `Environment id: ${environment.id}` : undefined}
        badges={
          workflowEntityId
            ? [
                {
                  key: 'solution',
                  text: 'Solution flow',
                  title: `This flow is part of a Dataverse solution (workflow id ${workflowEntityId}).`,
                },
              ]
            : undefined
        }
        isDirty={isDirty}
        items={items}
        overflowItems={overflowItems}
        farContent={<ViewSwitch value={view} onChange={setView} />}
      />
      <StatusMessages messages={messages} onDismiss={dismissMessage} />
      <DraftRecoveryBanner recovery={recovery} />

      <div className={workspaceClass}>
        {!!savedText && (
          <div className={editorPaneClass(view)}>
            <Editor
              defaultValue={savedText}
              path="flow-document.json"
              language="json"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              onMount={handleMount}
              onChange={handleEditorChange}
              options={{ ...editorOptions, ariaLabel: 'Full flow JSON', readOnly: recovery.awaitingChoice }}
            />
          </div>
        )}
        {view === 'definition' && definitionView.initialValue !== undefined && (
          <div className={editorPaneClass('json')}>
            <Editor
              defaultValue={definitionView.initialValue}
              path="flow-definition.json"
              language="json"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              onMount={(mounted) => {
                mounted.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => requestSaveRef.current());
                definitionView.onMount(mounted);
              }}
              onChange={definitionView.onChange}
              options={{ ...editorOptions, ariaLabel: 'Flow definition JSON' }}
            />
          </div>
        )}
        {!!savedText && (view === 'diagram' || view === 'split') && (
          <section className={diagramPaneClass(view)} aria-label="Flow diagram view">
            <FlowDiagramView
              text={liveText || savedText}
              flowName={name}
              mode={view}
              selectedKey={selectedNode}
              onSelect={handleNodeSelect}
              onRevealRange={showInEditor}
            />
          </section>
        )}
      </div>

      <SaveConfirmDialog
        isOpen={dialog?.kind === 'save'}
        flowName={flowName}
        environmentLabel={environmentLabel}
        saveMethodLabel={saveMethodLabel}
        connectionChanges={dialog?.kind === 'save' ? dialog.connectionChanges : undefined}
        onCancel={() => setDialog(null)}
        onConfirm={confirmWrite}
      />
      <PublishConfirmDialog
        isOpen={dialog?.kind === 'publish'}
        flowName={flowName}
        environmentLabel={environmentLabel}
        saveMethodLabel={saveMethodLabel}
        connectionChanges={dialog?.kind === 'publish' ? dialog.connectionChanges : undefined}
        isDirty={isDirty}
        onCancel={() => setDialog(null)}
        onConfirm={confirmWrite}
      />

      <FlowValidationResult
        report={validation}
        isOpen={validationPaneIsOpen}
        onClose={() => setValidationPaneIsOpen(false)}
        onRevealPointer={(pointer) => {
          setValidationPaneIsOpen(false);
          revealPointer(pointer);
        }}
        onRevealOperation={(operation) => {
          setValidationPaneIsOpen(false);
          revealOperation(operation);
        }}
      />
      <FlowAnalysisPanel
        isOpen={analysisPanelOpen}
        onDismiss={() => setAnalysisPanelOpen(false)}
        flowDefinition={panelText}
        flowName={name}
        onRevealRange={(range) => {
          // Close the panel so the selection is actually visible in the editor.
          setAnalysisPanelOpen(false);
          if (view === 'definition' || view === 'diagram') setView('json');
          window.requestAnimationFrame(() => revealRange(range));
        }}
      />
      <FlowComparisonPanel
        isOpen={comparisonPanelOpen}
        onDismiss={() => setComparisonPanelOpen(false)}
        currentFlowDefinition={panelText}
        serverFlowDefinition={savedText}
        flowName={name}
        envId={envId || ''}
        flowId={flowId || ''}
        onRevealPointer={(pointer) => {
          setComparisonPanelOpen(false);
          revealPointer(pointer);
        }}
      />
      <ConnectionsPanel
        isOpen={connectionsOpen}
        onDismiss={() => setConnectionsOpen(false)}
        text={panelText}
        manageUrl={manageUrl}
        isSolutionFlow={!!workflowEntityId}
        onReveal={(pointer) => {
          setConnectionsOpen(false);
          revealPointer(pointer);
        }}
      />
      {envId && flowId && <RecentRunsPanel api={api} envId={envId} flowId={flowId} portalUrl={portalUrl}
        isOpen={recentRunsOpen} onDismiss={() => setRecentRunsOpen(false)} onRevealStep={revealRunStep} onReconnect={reconnect} />}
      {managedExportOpen && envId && <ManagedSolutionExportPanel api={api} envId={envId} workflowId={workflowEntityId} flowName={name}
        isDirty={isDirty} onReconnect={reconnect} onDismiss={() => setManagedExportOpen(false)} />}
      {importOpen && envId && <SolutionImportPanel api={api} envId={envId} environmentLabel={environmentLabel} portalUrl={makerOrigin}
        onReconnect={reconnect} onDismiss={() => setImportOpen(false)} />}
      {availabilityOpen && envId && flowId && <ConnectionAvailabilityPanel api={api} envId={envId} flowId={flowId}
        onReconnect={reconnect} onDismiss={() => setAvailabilityOpen(false)} />}
      {navigationMode && <FlowNavigationPanel mode={navigationMode} text={panelText} onDismiss={() => setNavigationMode(undefined)}
        onReveal={pointer => { setNavigationMode(undefined); revealPointer(pointer); }} />}
      <SolutionAnalysisPanel isOpen={solutionPanelOpen} onDismiss={() => setSolutionPanelOpen(false)} />
    </div>
  );
};

export default FlowEditorPage;
