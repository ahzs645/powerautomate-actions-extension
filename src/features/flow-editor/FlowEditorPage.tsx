import {
  CommandBar,
  ICommandBarItemProps
} from '@fluentui/react/lib/CommandBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import Editor from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useMemo, useState } from 'react';
import { LoaderModal } from '../../components/shared/LoaderModal';
import { Messages } from '../../components/shared/Messages';
import { FlowValidationResult } from './FlowValidationResult';
import { FlowAnalysisPanel } from './FlowAnalysisPanel';
import { FlowComparisonPanel } from './FlowComparisonPanel';
import { SolutionAnalysisPanel } from './SolutionAnalysisPanel';
import { useFlowEditor } from './useFlowEditor';

const editorContainerClassName = mergeStyles({
  flex: 1,
});

export const FlowEditorPage: React.FC = () => {
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor>(
    null as any
  );
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [solutionPanelOpen, setSolutionPanelOpen] = useState(false);

  const {
    name,
    environment,
    definition,
    isLoading,
    saveDefinition,
    validate,
    messages,
    onDismissed,
    validationResult,
    validationPaneIsOpen,
    setValidationPaneIsOpen,
  } = useFlowEditor();

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
            const savedDefinition = await saveDefinition(name, environment, editor.getValue());

            if (savedDefinition) {
              editor.setValue(savedDefinition);
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
    [name, editor, definition, saveDefinition, validate, environment]
  );

  return (
    <>
      {isLoading && <LoaderModal />}
      <Messages items={messages} onDismissed={onDismissed} />
      <FlowValidationResult
        errors={validationResult.errors}
        warnings={validationResult.warnings}
        isOpen={validationPaneIsOpen}
        onClose={() => setValidationPaneIsOpen(false)}
        flowDefinition={editor?.getValue() || definition}
      />
      <FlowAnalysisPanel
        isOpen={analysisPanelOpen}
        onDismiss={() => setAnalysisPanelOpen(false)}
        flowDefinition={editor?.getValue() || definition}
        flowName={name}
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
