import { ICommandBarItemProps } from '@fluentui/react/lib/CommandBar';
import { MessageBarType } from '@fluentui/react/lib/MessageBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderModal } from '../../components/shared/LoaderModal';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import { PublishConfirmDialog, SaveConfirmDialog } from './components/ConfirmDialogs';
import { FlowEditorHeader, groupStartStyles, primaryCommandStyles } from './components/FlowEditorHeader';
import { EditorView, isEditorView, ViewSwitch } from './components/ViewSwitch';
import { FlowDiagramView } from './FlowDiagramView';
import { downloadText, jsonFileName } from './browserActions';
import { strategyFor } from './flowPersistence';
import { applyServerText, isTextDirty } from './editorSync';
import { FlowAnalysisPanel } from './FlowAnalysisPanel';
import { FlowComparisonPanel } from './FlowComparisonPanel';
import { findActionRange, findPointerRange, JsonRange } from './flowJsonLocator';
import { FlowValidationResult } from './FlowValidationResult';
import { monaco } from './monacoSetup';
import { readPreference, rememberSaveConfirmed, shouldConfirmSave, writePreference } from './savePreferences';
import { SolutionAnalysisPanel } from './SolutionAnalysisPanel';
import { useFlowEditor } from './useFlowEditor';
import { StatusMessages } from './useStatusMessages';

type IEditor = monaco.editor.IStandaloneCodeEditor;

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

const editorPaneClass = (view: EditorView) =>
  mergeStyles({
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 0,
    // Hidden rather than unmounted in Diagram view: the model, undo history and
    // scroll position survive switching back.
    display: view === 'diagram' ? 'none' : 'block',
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
  const [editor, setEditor] = useState<IEditor | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'save' | 'publish'>(null);
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [solutionPanelOpen, setSolutionPanelOpen] = useState(false);
  /** Editor text captured when a panel opens, so panels analyse what you see. */
  const [panelText, setPanelText] = useState('');
  const [view, setViewState] = useState<EditorView>(() => {
    const stored = readPreference(VIEW_PREFERENCE_KEY);
    return isEditorView(stored) ? stored : 'json';
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
    if (viewRef.current !== 'json' && editor) setLiveText(editor.getValue());
  }, [recomputeDirty, editor]);

  const setView = useCallback(
    (next: EditorView) => {
      setViewState(next);
      writePreference(VIEW_PREFERENCE_KEY, next);
      if (next !== 'json') setLiveText(editor?.getValue() || savedTextRef.current);
    },
    [editor]
  );

  // The diagram needs text before the editor has mounted (Diagram view on load).
  useEffect(() => {
    if (view !== 'json') setLiveText(editor?.getValue() || savedText);
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
  const performSave = useCallback(async () => {
    if (!editor) return;
    const sent = editor.getValue();
    const result = await saveDraft(sent);
    if (result.ok) applyServerText(editor, sent, result.serverText);
    recomputeDirty();
  }, [editor, saveDraft, recomputeDirty]);

  onMessageSaveRef.current = (sent, serverText) => {
    if (editor) applyServerText(editor, sent, serverText);
    recomputeDirty();
  };

  const performPublish = useCallback(async () => {
    if (!editor) return;
    const sent = editor.getValue();
    const result = await publish(sent);
    if (result.ok) applyServerText(editor, sent, result.serverText);
    recomputeDirty();
  }, [editor, publish, recomputeDirty]);

  const requestSave = useCallback(() => {
    if (!editor || busy || dialog) return;
    if (shouldConfirmSave()) setDialog('save');
    else performSave();
  }, [editor, busy, dialog, performSave]);

  // Ctrl/Cmd+S: Monaco handles it while the editor has focus (addCommand in
  // onMount); this listener covers focus anywhere else on the page.
  const requestSaveRef = useRef(requestSave);
  requestSaveRef.current = requestSave;

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
      revealRange(range);
      return true;
    },
    [editor, revealRange]
  );

  const revealOperation = useCallback(
    (operationName: string) => {
      const range = editor && findActionRange(editor.getValue(), operationName);
      if (!range) return false;
      revealRange(range);
      return true;
    },
    [editor, revealRange]
  );

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

  const noFlow = !editor || !savedText;
  const items: ICommandBarItemProps[] = useMemo(
    () => [
      {
        key: 'save',
        text: busy === 'saving' ? 'Saving…' : 'Save',
        title: 'Save draft (Ctrl+S)',
        iconProps: { iconName: 'Save' },
        disabled: noFlow || !!busy,
        buttonStyles: primaryCommandStyles,
        onClick: () => requestSave(),
      },
      {
        key: 'publish',
        text: busy === 'publishing' ? 'Publishing…' : 'Publish',
        title: 'Save and publish this flow',
        iconProps: { iconName: 'PublishContent' },
        disabled: noFlow || !!busy,
        onClick: () => setDialog('publish'),
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noFlow, busy, editor, savedText, requestSave, validate]
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
      downloadJson,
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

      <div className={workspaceClass}>
        {!!savedText && (
          <div className={editorPaneClass(view)}>
            <Editor
              defaultValue={savedText}
              language="json"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              onMount={handleMount}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 14,
                wordWrap: 'on',
                automaticLayout: true,
              }}
            />
          </div>
        )}
        {!!savedText && view !== 'json' && (
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
        isOpen={dialog === 'save'}
        flowName={flowName}
        environmentLabel={environmentLabel}
        saveMethodLabel={saveMethodLabel}
        onCancel={() => setDialog(null)}
        onConfirm={(dontAskAgain) => {
          rememberSaveConfirmed(dontAskAgain);
          setDialog(null);
          performSave();
        }}
      />
      <PublishConfirmDialog
        isOpen={dialog === 'publish'}
        flowName={flowName}
        environmentLabel={environmentLabel}
        saveMethodLabel={saveMethodLabel}
        isDirty={isDirty}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          performPublish();
        }}
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
          revealRange(range);
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
      <SolutionAnalysisPanel isOpen={solutionPanelOpen} onDismiss={() => setSolutionPanelOpen(false)} />
    </div>
  );
};

export default FlowEditorPage;
