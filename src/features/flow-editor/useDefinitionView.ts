import { useCallback, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { definitionProjection } from './definitionProjection';
import { applyServerText } from './editorSync';

type Editor = monacoEditor.IStandaloneCodeEditor;

/** A view of the definition. The full Monaco model remains the working document. */
export function useDefinitionView(fullEditor: Editor | null) {
  const [initialValue, setInitialValue] = useState<string>();
  const range = useRef<{ start: number; end: number }>();
  const projectedEditor = useRef<Editor | null>(null);
  const syncing = useRef(false);

  const open = useCallback(() => {
    const source = fullEditor?.getValue();
    const projection = source && definitionProjection(source);
    if (!projection || !fullEditor) return false;
    fullEditor.pushUndoStop();
    range.current = projection;
    setInitialValue(projection.value);
    return true;
  }, [fullEditor]);

  const close = useCallback(() => {
    if (range.current) fullEditor?.pushUndoStop();
    range.current = undefined;
    projectedEditor.current = null;
    setInitialValue(undefined);
  }, [fullEditor]);

  const onMount = useCallback((mounted: Editor) => { projectedEditor.current = mounted; }, []);

  const onChange = useCallback((value: string | undefined) => {
    const current = range.current;
    const model = fullEditor?.getModel();
    if (!current || !fullEditor || !model || value === undefined || syncing.current) return;
    const start = model.getPositionAt(current.start);
    const end = model.getPositionAt(current.end);
    const text = value.replace(/\r\n|\r|\n/g, () => model.getEOL());
    const applied = fullEditor.executeEdits('definition-view', [{ range: {
      startLineNumber: start.lineNumber, startColumn: start.column,
      endLineNumber: end.lineNumber, endColumn: end.column,
    }, text }]);
    if (applied) range.current = { start: current.start, end: current.start + text.length };
  }, [fullEditor]);

  const sync = useCallback((serverText: string) => {
    if (!range.current) return;
    const projection = definitionProjection(serverText);
    if (!projection) return;
    range.current = projection;
    const target = projectedEditor.current;
    if (!target) {
      setInitialValue(projection.value);
      return;
    }
    syncing.current = true;
    try {
      applyServerText(target, target.getValue(), projection.value);
    } finally {
      syncing.current = false;
    }
  }, []);

  return { initialValue, open, close, onMount, onChange, sync };
}
