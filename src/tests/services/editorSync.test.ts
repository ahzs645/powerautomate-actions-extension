import { applyServerText, isTextDirty, SyncableEditor } from '../../features/flow-editor/editorSync';
import {
  rememberSaveConfirmed,
  resetSaveConfirmation,
  shouldConfirmSave,
} from '../../features/flow-editor/savePreferences';

/** A minimal stand-in for Monaco with an undo stack, to prove setValue is not used. */
function fakeEditor(initial: string) {
  let value = initial;
  const undoStops: number[] = [];
  const editor: SyncableEditor & { setValue: jest.Mock; edits: string[] } = {
    edits: [],
    setValue: jest.fn(),
    getModel: () => ({
      getValue: () => value,
      getValueLength: () => value.length,
      getFullModelRange: () => ({ full: true }),
    }),
    pushUndoStop: () => {
      undoStops.push(editor.edits.length);
      return true;
    },
    executeEdits: (_source, edits) => {
      value = edits[0].text;
      editor.edits.push(value);
      return true;
    },
    saveViewState: () => ({ scrollTop: 10 }),
    restoreViewState: jest.fn(),
  };
  return { editor, undoStops, current: () => value };
}

describe('applyServerText', () => {
  it('replaces through an undoable edit, never setValue', () => {
    const { editor, undoStops, current } = fakeEditor('{"a":1}');
    expect(applyServerText(editor, '{"a":1}', '{\n  "a": 1\n}')).toBe('replaced');
    expect(current()).toBe('{\n  "a": 1\n}');
    expect(editor.setValue).not.toHaveBeenCalled();
    expect(undoStops).toEqual([0, 1]);
    expect(editor.restoreViewState).toHaveBeenCalledWith({ scrollTop: 10 });
  });

  it('does nothing when the server returned what was sent', () => {
    const { editor } = fakeEditor('same');
    expect(applyServerText(editor, 'same', 'same')).toBe('unchanged');
    expect(editor.edits).toEqual([]);
  });

  it('keeps edits typed while the save was in flight', () => {
    const { editor, current } = fakeEditor('typed more');
    expect(applyServerText(editor, 'sent', 'server')).toBe('kept-local-edits');
    expect(current()).toBe('typed more');
  });
});

describe('isTextDirty', () => {
  it('compares against the last saved text', () => {
    const { editor } = fakeEditor('abc');
    expect(isTextDirty(editor.getModel(), 'abc')).toBe(false);
    expect(isTextDirty(editor.getModel(), 'abd')).toBe(true);
    expect(isTextDirty(editor.getModel(), 'abcd')).toBe(true);
    expect(isTextDirty(null, 'x')).toBe(false);
  });
});

describe('save confirmation preference', () => {
  beforeEach(() => {
    resetSaveConfirmation();
  });

  it('asks once per session', () => {
    expect(shouldConfirmSave()).toBe(true);
    rememberSaveConfirmed(false);
    expect(shouldConfirmSave()).toBe(false);
    window.sessionStorage.clear();
    expect(shouldConfirmSave()).toBe(true);
  });

  it('remembers "Don\'t ask again" across sessions', () => {
    rememberSaveConfirmed(true);
    window.sessionStorage.clear();
    expect(shouldConfirmSave()).toBe(false);
  });
});
