import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunExportMessage, RunExportSession } from '../../services/interfaces/IFlowEditorActions';

/** Follow the active tab in this popup or side panel's window. */
export function useActiveRunExportSession(enabled: boolean) {
  const [session, setSession] = useState<RunExportSession | null>(null);
  const refreshSource = useRef<(tabId: number) => void>();
  const onSessionChanged = useCallback((tabId: number) => refreshSource.current?.(tabId), []);

  useEffect(() => {
    if (!enabled) {
      setSession(null);
      return;
    }

    let requestId = 0;
    let sourceTabId: number | undefined;
    let disposed = false;

    const update = () => {
      const id = ++requestId;
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const queryFailed = Boolean(chrome.runtime.lastError);
        if (disposed || id !== requestId) return;
        sourceTabId = queryFailed ? undefined : tabs?.[0]?.id;
        if (sourceTabId === undefined) {
          setSession(null);
          return;
        }
        const message: RunExportMessage = { type: 'get-run-export-session', tabId: sourceTabId };
        chrome.runtime.sendMessage(message, (source: RunExportSession | null) => {
          const requestFailed = Boolean(chrome.runtime.lastError);
          if (!disposed && id === requestId) setSession(requestFailed ? null : source ?? null);
        });
      });
    };

    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (change.url || change.status === 'complete')) update();
    };
    const onRemoved = (tabId: number) => {
      if (tabId === sourceTabId) update();
    };
    refreshSource.current = tabId => {
      if (tabId === sourceTabId) update();
    };

    chrome.tabs.onActivated?.addListener(update);
    chrome.tabs.onUpdated?.addListener(onUpdated);
    chrome.tabs.onRemoved?.addListener(onRemoved);
    update();

    return () => {
      disposed = true;
      chrome.tabs.onActivated?.removeListener(update);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
      chrome.tabs.onRemoved?.removeListener(onRemoved);
      refreshSource.current = undefined;
    };
  }, [enabled]);

  return { session, onSessionChanged };
}
