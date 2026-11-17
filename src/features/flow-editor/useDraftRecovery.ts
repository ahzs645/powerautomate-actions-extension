import { useEffect, useRef, useState } from 'react';
import { applyServerText, SyncableEditor } from './editorSync';

const RECOVERY_WRITE_INTERVAL = 300;
let nextRevision = 0;

function newRevision() {
  return window.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}:${++nextRevision}`;
}

interface RecoveryEditor extends SyncableEditor {
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  updateOptions(options: { readOnly: boolean }): void;
}

interface RecoveryDraft {
  revision: string;
  text: string;
  baseline: string;
}

interface RecoveryStore {
  read(key: string): Promise<unknown>;
  write(key: string, draft: RecoveryDraft): Promise<void>;
  remove(key: string): Promise<void>;
}

function recoveryStore(): RecoveryStore {
  const session = typeof chrome === 'undefined' ? undefined : chrome.storage?.session;
  if (session) {
    return {
      read: async (key) => (await session.get(key))[key],
      write: (key, draft) => session.set({ [key]: draft }),
      remove: (key) => session.remove(key),
    };
  }
  // A per-tab session also supports reloads when running outside the extension.
  return {
    read: async (key) => JSON.parse(window.sessionStorage.getItem(key) ?? 'null'),
    write: async (key, draft) => window.sessionStorage.setItem(key, JSON.stringify(draft)),
    remove: async (key) => window.sessionStorage.removeItem(key),
  };
}

function asDraft(value: unknown): RecoveryDraft | null {
  const draft = value as Partial<RecoveryDraft> | null;
  return typeof draft?.revision === 'string' &&
    typeof draft.text === 'string' &&
    typeof draft.baseline === 'string'
    ? { revision: draft.revision, text: draft.text, baseline: draft.baseline }
    : null;
}

export function flowRecoveryKey(envId: string, flowId: string): string {
  return `paToolkit.flowEditor.recovery:${encodeURIComponent(envId.toLowerCase())}:${encodeURIComponent(flowId.toLowerCase())}`;
}

interface RecoveryState {
  key: string;
  editor: RecoveryEditor;
  draft: RecoveryDraft | null;
  unavailable: boolean;
}

interface RecoveryActions {
  restore(): void;
  discard(): void;
  onSaved(sent: string, serverText: string): void;
}

export interface DraftRecovery extends RecoveryActions {
  awaitingChoice: boolean;
  hasDraft: boolean;
  baselineChanged: boolean;
  unavailable: boolean;
}

/** Recover unsaved Monaco text within this browser session, scoped to the loaded flow. */
export function useDraftRecovery({ envId, flowId, savedText, editor }: {
  envId: string | null;
  flowId: string | null;
  savedText: string;
  editor: RecoveryEditor | null;
}): DraftRecovery {
  const key = envId && flowId && savedText ? flowRecoveryKey(envId, flowId) : null;
  const savedTextRef = useRef(savedText);
  savedTextRef.current = savedText;
  const actions = useRef<RecoveryActions>();
  const [result, setResult] = useState<RecoveryState | null>(null);

  useEffect(() => {
    if (!key || !editor) return;
    const scope = { key, editor };
    const store = recoveryStore();
    let disposed = false;
    let ready = false;
    let unavailable = false;
    let baseline = savedTextRef.current;
    let draftBaseline = baseline;
    let candidate: RecoveryDraft | null = null;
    let ownedRevision: string | undefined;
    let lastQueued: RecoveryDraft | null | undefined;
    let queue: Promise<void> | undefined;
    let timer: number | undefined;

    function notify() {
      if (!disposed) setResult({ ...scope, draft: candidate, unavailable });
    }

    function enqueue(operation: () => Promise<void>, onFailure?: () => void) {
      // Web Locks coordinate with other editor tabs. The local queue also keeps
      // operations ordered when locks are unavailable, such as in tests.
      const run = async () => navigator.locks ? navigator.locks.request(scope.key, operation) : operation();
      const previous = queue;
      const request = previous ? previous.then(run) : run();
      const settled = request.then(() => {
        if (!unavailable) return;
        unavailable = false;
        notify();
      }, () => {
        onFailure?.();
        unavailable = true;
        notify();
      });
      queue = settled;
      void settled.then(() => { if (queue === settled) queue = undefined; });
    }

    async function removeIfCurrent(revision: string | undefined) {
      if (!revision) return;
      const current = asDraft(await store.read(scope.key));
      if (current?.revision === revision) await store.remove(scope.key);
    }

    function capture() {
      const model = scope.editor.getModel();
      if (!ready || candidate || !model) return;
      const text = model.getValue();
      if (text === baseline) {
        draftBaseline = baseline;
        if (lastQueued === null || (lastQueued === undefined && !ownedRevision)) return;
      }
      if (lastQueued && text === lastQueued.text && draftBaseline === lastQueued.baseline) return;

      const draft = text === baseline ? null : {
        revision: newRevision(),
        text,
        baseline: draftBaseline,
      };
      lastQueued = draft;
      enqueue(async () => {
        if (!draft) {
          await removeIfCurrent(ownedRevision);
          ownedRevision = undefined;
          return;
        }
        await store.write(scope.key, draft);
        ownedRevision = draft.revision;
      }, () => {
        if (lastQueued === draft) lastQueued = undefined;
      });
    }

    function flush() {
      window.clearTimeout(timer);
      timer = undefined;
      capture();
    }

    const subscription = editor.onDidChangeModelContent(() => {
      if (timer !== undefined || !ready || candidate) return;
      capture();
      timer = window.setTimeout(flush, RECOVERY_WRITE_INTERVAL);
    });
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);

    actions.current = {
      restore() {
        const draft = candidate;
        const model = editor.getModel();
        if (!draft || !model) return;
        candidate = null;
        draftBaseline = draft.baseline;
        // The page may keep editing locked until a choice is made.
        editor.updateOptions({ readOnly: false });
        applyServerText(editor, model.getValue(), draft.text);
        flush();
        notify();
      },
      discard() {
        const draft = candidate;
        if (!draft) return;
        enqueue(async () => {
          await removeIfCurrent(draft.revision);
          if (candidate !== draft) return;
          candidate = null;
          flush();
          notify();
        });
      },
      onSaved(_sent, serverText) {
        baseline = serverText;
        draftBaseline = serverText;
        flush();
      },
    };

    void store.read(key).then((raw) => {
      if (disposed) return;
      const draft = asDraft(raw);
      if (draft?.text === baseline) {
        // A previous save may have completed just as the editor was closed.
        enqueue(() => removeIfCurrent(draft.revision));
      } else {
        candidate = draft;
      }
      ready = true;
      capture();
      notify();
    }, () => {
      if (disposed) return;
      ready = true;
      unavailable = true;
      capture();
      notify();
    });

    return () => {
      disposed = true;
      actions.current = undefined;
      subscription.dispose();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key, editor]);

  const active = result?.key === key && result.editor === editor ? result : null;
  return {
    awaitingChoice: !!key && (!active || !!active.draft),
    hasDraft: !!active?.draft,
    baselineChanged: !!active?.draft && active.draft.baseline !== savedText,
    unavailable: !!active?.unavailable,
    restore: () => actions.current?.restore(),
    discard: () => actions.current?.discard(),
    onSaved: (sent, serverText) => actions.current?.onSaved(sent, serverText),
  };
}
