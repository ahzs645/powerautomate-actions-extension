import {
  CommandBar,
  ICommandBarItemProps
} from '@fluentui/react/lib/CommandBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import Editor from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import './monacoSetup';
import { useMemo, useState } from 'react';
import { LoaderModal } from '../../components/shared/LoaderModal';
import { StatusMessages } from './useStatusMessages';
import { findActionRange, findPointerRange, JsonRange } from './flowJsonLocator';
import { FlowValidationResult } from './FlowValidationResult';
import { FlowAnalysisPanel } from './FlowAnalysisPanel';
import { FlowComparisonPanel } from './FlowComparisonPanel';
import { SolutionAnalysisPanel } from './SolutionAnalysisPanel';
import { useFlowEditor } from './useFlowEditor';
import { useResolvedTheme } from '../../theme/useResolvedTheme';

const editorContainerClassName = mergeStyles({
  flex: 1,
});

export const FlowEditorPage: React.FC = () => {
  const resolvedTheme = useResolvedTheme();
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor>(
    null as any
  );
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [solutionPanelOpen, setSolutionPanelOpen] = useState(false);

  const {
    name,
    savedText: definition,
    isLoading,
    saveDraft,
    publish,
    validate,
    messages,
    dismissMessage,
    validation,
    validationPaneIsOpen,
    setValidationPaneIsOpen,
  } = useFlowEditor();

  const revealRange = (range: JsonRange) => {
    if (!editor) return;
    const selection = new monaco.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
    editor.revealRangeInCenter(selection);
    editor.setSelection(selection);
    editor.focus();
  };

  const refreshToken = () => {
    chrome.runtime.sendMessage({ type: 'refresh' });
  };

  const downloadJson = () => {
    const json = editor?.getValue() || definition;
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'flow'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commandBarItems = useMemo(
    () =>
      [
        {
          key: 'name',
          text: name || 'Loading...',
        },
        {
          key: 'save',
          text: 'Save',
          iconProps: {
            iconName: 'Save',
          },
          disabled: !editor || !definition,
          onClick: async () => {
            const saved = await saveDraft(editor.getValue());

            if (saved.ok) {
              editor.setValue(saved.serverText);
            }
          },
        },
        {
          key: 'publish',
          text: 'Publish',
          iconProps: {
            iconName: 'PublishContent',
          },
          disabled: !editor || !definition,
          onClick: async () => {
            const saved = await publish(editor.getValue());

            if (saved.ok) {
              editor.setValue(saved.serverText);
            }
          },
        },
        {
          key: 'validate',
          text: 'Validate',
          iconProps: {
            iconName: 'ComplianceAudit',
          },
          disabled: !editor || !definition,
          onClick: () => validate(editor.getValue()),
        },
        {
          key: 'analyze',
          text: 'Analyze',
          iconProps: {
            iconName: 'BarChart4',
          },
          disabled: !editor || !definition,
          onClick: () => setAnalysisPanelOpen(true),
        },
        {
          key: 'compare',
          text: 'Compare',
          iconProps: {
            iconName: 'BranchCompare',
          },
          disabled: !editor || !definition,
          onClick: () => setComparisonPanelOpen(true),
        },
        {
          key: 'solution',
          text: 'Solution',
          iconProps: {
            iconName: 'Package',
          },
          onClick: () => setSolutionPanelOpen(true),
        },
        {
          key: 'download',
          text: 'Download JSON',
          iconProps: {
            iconName: 'Download',
          },
          disabled: !editor || !definition,
          onClick: downloadJson,
        },
        {
          key: 'refresh',
          text: 'Refresh Token',
          iconProps: {
            iconName: 'Refresh',
          },
          onClick: refreshToken,
        },
      ] as ICommandBarItemProps[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, editor, definition, saveDraft, publish, validate]
  );

  return (
    <>
      {isLoading && <LoaderModal />}
      <StatusMessages messages={messages} onDismiss={dismissMessage} />
      <FlowValidationResult
        report={validation}
        isOpen={validationPaneIsOpen}
        onClose={() => setValidationPaneIsOpen(false)}
        onRevealPointer={(pointer) => {
          const range = editor && findPointerRange(editor.getValue(), pointer);
          if (!range) return;
          setValidationPaneIsOpen(false);
          revealRange(range);
        }}
        onRevealOperation={(operation) => {
          const range = editor && findActionRange(editor.getValue(), operation);
          if (!range) return;
          setValidationPaneIsOpen(false);
          revealRange(range);
        }}
      />
      <FlowAnalysisPanel
        isOpen={analysisPanelOpen}
        onDismiss={() => setAnalysisPanelOpen(false)}
        flowDefinition={editor?.getValue() || definition}
        flowName={name}
        onRevealRange={(range) => {
          if (!editor) return;
          // Close the panel so the selection is actually visible in the editor.
          setAnalysisPanelOpen(false);
          const selection = new monaco.Range(
            range.startLine,
            range.startColumn,
            range.endLine,
            range.endColumn
          );
          editor.revealRangeInCenter(selection);
          editor.setSelection(selection);
          editor.focus();
        }}
      />
      <FlowComparisonPanel
        isOpen={comparisonPanelOpen}
        onDismiss={() => setComparisonPanelOpen(false)}
        currentFlowDefinition={editor?.getValue() || definition}
        flowName={name}
      />
      <SolutionAnalysisPanel
        isOpen={solutionPanelOpen}
        onDismiss={() => setSolutionPanelOpen(false)}
      />
      <CommandBar items={commandBarItems} />
      {!!definition && (
        <div className={editorContainerClassName}>
          <Editor
            defaultValue={definition}
            language="json"
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
            onMount={(editor) => setEditor(editor)}
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
    </>
  );
};

export default FlowEditorPage;
