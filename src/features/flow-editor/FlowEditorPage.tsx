import { ICommandBarItemProps } from '@fluentui/react/lib/CommandBar';
import { MessageBarType } from '@fluentui/react/lib/MessageBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderModal } from '../../components/shared/LoaderModal';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import { PublishConfirmDialog, SaveConfirmDialog } from './components/ConfirmDialogs';
import { FlowEditorHeader, groupStartStyles, primaryCommandStyles } from './components/FlowEditorHeader';
import { applyServerText, isTextDirty } from './editorSync';
import { FlowAnalysisPanel } from './FlowAnalysisPanel';
import { FlowComparisonPanel } from './FlowComparisonPanel';
import { findActionRange, findPointerRange, JsonRange } from './flowJsonLocator';
import { FlowValidationResult } from './FlowValidationResult';
import { monaco } from './monacoSetup';
import { rememberSaveConfirmed, shouldConfirmSave } from './savePreferences';
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

const editorPaneClass = mergeStyles({ flex: '1 1 0', minWidth: 0, minHeight: 0 });

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

  const {
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
  } = useFlowEditor();

  const environmentLabel = environment?.displayName || environment?.id || 'this environment';
  const flowName = name || 'Loading…';

  // --- Dirty tracking -------------------------------------------------------
  const savedTextRef = useRef(savedText);
  savedTextRef.current = savedText;

  const recomputeDirty = useCallback(() => {
    setIsDirty(isTextDirty(editor?.getModel() ?? null, savedTextRef.current));
  }, [editor]);

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
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'flow'}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
        ariaDescription: 'Keyboard shortcut Control S',
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
    ],
    [noFlow, downloadJson, reconnect]
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
        isDirty={isDirty}
        items={items}
        overflowItems={overflowItems}
      />
      <StatusMessages messages={messages} onDismiss={dismissMessage} />

      <div className={workspaceClass}>
        {!!savedText && (
          <div className={editorPaneClass}>
            <Editor
              defaultValue={savedText}
              language="json"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              onMount={handleMount}
              onChange={recomputeDirty}
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
      </div>

      <SaveConfirmDialog
        isOpen={dialog === 'save'}
        flowName={flowName}
        environmentLabel={environmentLabel}
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
        flowName={name}
      />
      <SolutionAnalysisPanel isOpen={solutionPanelOpen} onDismiss={() => setSolutionPanelOpen(false)} />
    </div>
  );
};

export default FlowEditorPage;
