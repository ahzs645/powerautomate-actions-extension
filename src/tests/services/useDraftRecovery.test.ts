import { act, renderHook, waitFor } from '@testing-library/react';
import { flowRecoveryKey, useDraftRecovery } from '../../features/flow-editor/useDraftRecovery';

function makeEditor(initialText: string) {
  let text = initialText;
  let listener: (() => void) | undefined;
  const change = (next: string) => {
    text = next;
    listener?.();
  };
  const editor = {
    getModel: () => ({
      getValue: () => text,
      getValueLength: () => text.length,
      getFullModelRange: () => ({}),
    }),
    onDidChangeModelContent: (next: () => void) => {
      listener = next;
      return { dispose: () => { listener = undefined; } };
    },
    executeEdits: (_source: string, edits: Array<{ text: string }>) => {
      change(edits[0].text);
      return true;
    },
    pushUndoStop: jest.fn(() => true),
    saveViewState: () => null,
    restoreViewState: () => undefined,
    updateOptions: jest.fn(),
  };
  return { editor, change, read: () => text };
}

const key = flowRecoveryKey('env', 'flow');
const readDraft = () => JSON.parse(window.sessionStorage.getItem(key) ?? 'null');

beforeEach(() => window.sessionStorage.clear());

test('offers only a matching flow draft and warns if the loaded version changed', async () => {
  const first = makeEditor('loaded');
  const { result: initial, unmount } = renderHook(() => useDraftRecovery({ envId: 'env', flowId: 'flow', savedText: 'loaded', editor: first.editor }));
  await waitFor(() => expect(initial.current.awaitingChoice).toBe(false));
  act(() => first.change('incomplete JSON {'));
  await waitFor(() => expect(readDraft()).toMatchObject({ text: 'incomplete JSON {', baseline: 'loaded' }));
  unmount();

  const next = makeEditor('updated');
  const { result: reopened, rerender } = renderHook(({ flowId }) => useDraftRecovery({ envId: 'env', flowId, savedText: 'updated', editor: next.editor }), {
    initialProps: { flowId: 'different-flow' },
  });
  await waitFor(() => expect(reopened.current.awaitingChoice).toBe(false));
  expect(reopened.current.hasDraft).toBe(false);

  rerender({ flowId: 'flow' });
  await waitFor(() => expect(reopened.current.hasDraft).toBe(true));
  expect(reopened.current.baselineChanged).toBe(true);
  expect(next.read()).toBe('updated');

  act(() => reopened.current.restore());
  expect(next.read()).toBe('incomplete JSON {');
  expect(next.editor.pushUndoStop).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(readDraft()).toMatchObject({ text: 'incomplete JSON {', baseline: 'loaded' }));
});

test('retains edits made during a save and removes recovery when text returns to the saved version', async () => {
  const { editor, change } = makeEditor('loaded');
  const { result } = renderHook(() => useDraftRecovery({ envId: 'env', flowId: 'flow', savedText: 'loaded', editor }));
  await waitFor(() => expect(result.current.awaitingChoice).toBe(false));

  act(() => change('sent'));
  await waitFor(() => expect(readDraft()).toMatchObject({ text: 'sent' }));
  act(() => {
    change('edits while saving');
    result.current.onSaved('sent', 'saved');
  });
  await waitFor(() => expect(readDraft()).toMatchObject({ text: 'edits while saving', baseline: 'saved' }));

  act(() => change('saved'));
  await waitFor(() => expect(readDraft()).toBeNull());
});

test('keeps the loaded version and clears only the recovery revision shown', async () => {
  const initial = { revision: 'initial', text: 'discard this', baseline: 'loaded' };
  window.sessionStorage.setItem(key, JSON.stringify(initial));
  const { editor, read } = makeEditor('loaded');
  const { result, unmount } = renderHook(() => useDraftRecovery({ envId: 'env', flowId: 'flow', savedText: 'loaded', editor }));
  await waitFor(() => expect(result.current.hasDraft).toBe(true));

  const newer = { revision: 'newer', text: 'newer work', baseline: 'loaded' };
  window.sessionStorage.setItem(key, JSON.stringify(newer));
  act(() => result.current.discard());
  await waitFor(() => expect(result.current.hasDraft).toBe(false));
  expect(read()).toBe('loaded');
  expect(readDraft()).toEqual(newer);
  unmount();

  const { result: reopened } = renderHook(() => useDraftRecovery({ envId: 'env', flowId: 'flow', savedText: 'loaded', editor }));
  await waitFor(() => expect(reopened.current.hasDraft).toBe(true));
  act(() => reopened.current.discard());
  await waitFor(() => expect(readDraft()).toBeNull());
});

test('allows editing and reports an unavailable recovery store', async () => {
  const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('session storage unavailable');
  });
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('session storage unavailable');
  });
  try {
    const { editor, change, read: readEditor } = makeEditor('loaded');
    const { result, unmount } = renderHook(() => useDraftRecovery({ envId: 'env', flowId: 'flow', savedText: 'loaded', editor }));
    await waitFor(() => expect(result.current.awaitingChoice).toBe(false));
    expect(result.current.unavailable).toBe(true);
    await act(async () => change('unsaved'));
    expect(readEditor()).toBe('unsaved');
    unmount();
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
