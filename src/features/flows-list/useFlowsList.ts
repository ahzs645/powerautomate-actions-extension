import { MessageBarType } from '@fluentui/react/lib/MessageBar';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStatusMessages } from '../flow-editor/useStatusMessages';
import { useApiProviderContext } from '../../services/ApiProvider';
import { getFlowUrl } from '../flow-editor/flowPersistence';
import {
  fetchEnvironmentName,
  FlowSummary,
  getFlowDefinition,
  listFlows,
  toFileName,
} from './flowsApi';

const DEBUG = true;

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[PA-Toolkit FlowsList]', ...args);
  }
}

function debugError(...args: any[]) {
  if (DEBUG) {
    console.error('[PA-Toolkit FlowsList Error]', ...args);
  }
}

/** Definitions are fetched one flow at a time; keep a few in flight without tripping throttling. */
const DOWNLOAD_CONCURRENCY = 4;

export interface BulkProgress {
  done: number;
  total: number;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Run tasks with a bounded number in flight, reporting progress as each settles. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
  onSettled?: (completed: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
      onSettled?.(++completed);
    }
  });

  await Promise.all(workers);
  return results;
}

export const useFlowsList = () => {
  const api = useApiProviderContext();
  const { messages, show: showMessage, dismiss: dismissMessage } = useStatusMessages();

  const envId = useMemo(
    () => new URLSearchParams(window.location.search).get('envId'),
    []
  );

  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const hasFetchedRef = useRef<boolean>(false);

  const [environmentName, setEnvironmentName] = useState<string | null>(null);

  const addMessage = useCallback(
    (msg: string, type: MessageBarType = MessageBarType.success) => {
      showMessage(msg, type);
    },
    [showMessage]
  );

  const loadFlows = useCallback(async () => {
    if (!envId || !api.isApiReady) {
      return;
    }

    try {
      setIsLoading(true);
      debugLog('Listing flows for environment:', envId);
      const result = await listFlows(api, envId, api.isPowerPlatformApi);
      setFlows(result);
      debugLog('Flows listed:', result.length);
      addMessage(
        result.length === 1 ? 'Found 1 flow.' : `Found ${result.length} flows.`,
        result.length ? MessageBarType.success : MessageBarType.warning
      );
    } catch (error) {
      debugError('Failed to list flows:', error);
      setFlows([]);
      addMessage(
        `Error listing flows: ${error instanceof Error ? error.message : String(error)}`,
        MessageBarType.error
      );
    } finally {
      setIsLoading(false);
    }
    // api is rebuilt on every render; depend on the fields that actually matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId, api.isApiReady, api.isPowerPlatformApi, addMessage]);

  useEffect(() => {
    if (hasFetchedRef.current || !envId || !api.isApiReady) {
      return;
    }
    hasFetchedRef.current = true;
    loadFlows();
    fetchEnvironmentName(api, envId).then(setEnvironmentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId, api.isApiReady, loadFlows]);

  const fetchDefinition = useCallback(
    (flow: FlowSummary) =>
      getFlowDefinition(api, getFlowUrl(envId, flow.id, api.isPowerPlatformApi)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [envId, api.isPowerPlatformApi, api.isApiReady]
  );

  /** Download one flow's definition as its own .json file. */
  const downloadFlow = useCallback(
    async (flow: FlowSummary) => {
      try {
        setIsLoading(true);
        debugLog('Downloading flow:', flow.displayName);
        const definition = await fetchDefinition(flow);
        saveBlob(
          new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' }),
          `${toFileName(flow.displayName, flow.id)}.json`
        );
        addMessage(`Downloaded "${flow.displayName}".`);
      } catch (error) {
        debugError('Failed to download flow:', error);
        addMessage(
          `Error downloading "${flow.displayName}": ${error instanceof Error ? error.message : String(error)}`,
          MessageBarType.error
        );
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDefinition, addMessage]
  );

  /**
   * Download several flows as a single .zip. Chrome blocks a burst of individual
   * downloads, and one archive is what you want for a backup anyway.
   */
  const downloadFlowsAsZip = useCallback(
    async (selection: FlowSummary[]) => {
      if (selection.length === 0) {
        addMessage('No flows selected.', MessageBarType.warning);
        return;
      }

      const zip = new JSZip();
      const usedNames = new Set<string>();
      const failed: string[] = [];

      setProgress({ done: 0, total: selection.length });

      await mapWithConcurrency(
        selection,
        DOWNLOAD_CONCURRENCY,
        async (flow) => {
          try {
            const definition = await fetchDefinition(flow);
            let fileName = `${toFileName(flow.displayName, flow.id)}.json`;
            if (usedNames.has(fileName)) {
              fileName = `${toFileName(flow.displayName, flow.id)} (${flow.id}).json`;
            }
            usedNames.add(fileName);
            zip.file(fileName, JSON.stringify(definition, null, 2));
          } catch (error) {
            debugError('Failed to fetch flow for zip:', flow.displayName, error);
            failed.push(flow.displayName);
          }
        },
        (done) => setProgress({ done, total: selection.length })
      );

      setProgress(null);

      const succeeded = selection.length - failed.length;
      if (succeeded === 0) {
        addMessage('None of the selected flows could be downloaded.', MessageBarType.error);
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `power-automate-flows-${envId || 'environment'}.zip`);

      if (failed.length > 0) {
        addMessage(
          `Downloaded ${succeeded} of ${selection.length} flows. Skipped: ${failed.join(', ')}.`,
          MessageBarType.warning
        );
      } else {
        addMessage(`Downloaded ${succeeded} flows as a zip.`);
      }
    },
    [fetchDefinition, addMessage, envId]
  );

  /** Reload the same tab into the JSON editor; the tab keeps its token wiring. */
  const openInEditor = useCallback(
    (flow: FlowSummary) => {
      if (!envId) {
        return;
      }
      window.location.search = `?envId=${encodeURIComponent(envId)}&flowId=${encodeURIComponent(flow.id)}`;
    },
    [envId]
  );

  return {
    envId,
    flows,
    isLoading,
    progress,
    loadFlows,
    downloadFlow,
    downloadFlowsAsZip,
    openInEditor,
    environmentName,
    messages,
    dismissMessage,
  };
};
