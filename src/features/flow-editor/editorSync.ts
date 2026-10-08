// Keeping the Monaco model in step with the server without losing the user's work.

/** The slice of Monaco's editor API used here, so this stays testable without Monaco. */
export interface SyncableModel {
  getValue(): string;
  getValueLength(): number;
  getFullModelRange(): unknown;
}

export interface SyncableEditor {
  getModel(): SyncableModel | null;
  pushUndoStop(): boolean;
  executeEdits(
    source: string,
    edits: Array<{ range: any; text: string; forceMoveMarkers?: boolean }>
  ): boolean;
  saveViewState(): unknown;
  restoreViewState(state: any): void;
}

/** Cheap first: a length mismatch is dirty without building the full string. */
export function isTextDirty(model: SyncableModel | null, savedText: string): boolean {
  if (!model) return false;
  if (model.getValueLength() !== savedText.length) return true;
  return model.getValue() !== savedText;
}

export type ApplyResult = 'unchanged' | 'replaced' | 'kept-local-edits';

/**
 * Show the server's version of the text after a save.
 *
 * `setValue` would wipe the undo stack, so the replacement is applied as a single
 * edit between undo stops: Ctrl+Z still walks back through the user's own edits.
 * Nothing happens when the server returned exactly what was sent, and when the
 * user kept typing while the save was in flight their text is left alone.
 */
export function applyServerText(editor: SyncableEditor, sentText: string, serverText: string): ApplyResult {
  const model = editor.getModel();
  if (!model) return 'unchanged';
  const current = model.getValue();
  if (current !== sentText) return 'kept-local-edits';
  if (serverText === current) return 'unchanged';

  const viewState = editor.saveViewState();
  editor.pushUndoStop();
  editor.executeEdits('server-normalized', [
    { range: model.getFullModelRange(), text: serverText, forceMoveMarkers: true },
  ]);
  editor.pushUndoStop();
  if (viewState) editor.restoreViewState(viewState);
  return 'replaced';
}
