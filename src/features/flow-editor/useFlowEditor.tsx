import { MessageBarType } from '@fluentui/react/lib/MessageBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiProviderContext } from '../../services/ApiProvider';
import type { DiagnosticRequestIds } from '../../services/Diagnostics';
import { ConflictError, MissingConnectionReferenceError } from '../../services/DataverseFlowService';
import { SchemaValidator } from '../../services/SchemaValidator';
import { copyText, downloadText, jsonFileName } from './browserActions';
import {
  CONFLICT_TEXT,
  ConflictActions,
  DataverseOfferActions,
  ErrorText,
  missingReferencesSentence,
  requestIdsOf,
  statusOf,
} from './components/StatusContent';
import { readDataverseEtag } from './dataverseSaveStrategy';
import {
  dataverseAvailability,
  documentFromFlowResponse,
  FlowSaveStrategy,
  FlowTarget,
  flowServiceSaveStrategy,
  getFlowUrl,
  parseEditorText,
  SaveMode,
  selectSaveStrategy,
  strategyFor,
  toEditorText,
} from './flowPersistence';
import {
  failedCheckWithRequestIds,
  runFlowCheckers,
  summarizeValidation,
  ValidationReport,
} from './flowValidation';
import { fetchEnvironmentName } from '../flows-list/flowsApi';
import { readSaveMode, writeSaveMode } from './savePreferences';
import { useStatusMessages } from './useStatusMessages';

export { getFlowUrl } from './flowPersistence';

const DEBUG = true;

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[PA-Toolkit FlowEditor]', ...args);
  }
}

function debugError(...args: any[]) {
  if (DEBUG) {
    console.error('[PA-Toolkit FlowEditor Error]', ...args);
  }
}

export interface FlowEnvironmentInfo {
  id: string;
  /** Friendly name when the environment lookup succeeded. */
  displayName?: string;
}

export type SaveOutcome =
  | {
      ok: true;
      serverText: string;
      /** The method that actually wrote the flow. */
      method: SaveMode;
      /** Set when a Dataverse save fell back to the Flow service (references without a logical name). */
      fallbackReferenceKeys?: string[];
    }
  | { ok: false };

export interface SaveOptions {
  quiet?: boolean;
  /** Use this method instead of the environment's preference (the "try Dataverse" retry). */
  method?: SaveMode;
}

export type BusyState = null | 'loading' | 'saving' | 'publishing' | 'validating';

/** Lets messages act on the page's editor (retry the save, download the text). */
export interface FlowEditorHost {
  /** The editor's current text. */
  getText?: () => string | undefined;
  /** A save started from a message succeeded: show the server text in the editor. */
  onSaved?: (sentText: string, serverText: string) => void;
}

export interface SaveMethodState {
  /** What the user chose for this environment. */
  preference: SaveMode;
  /** What Save / Publish will use now (Dataverse only when it is usable). */
  effective: SaveMode;
  dataverseAvailable: boolean;
  /** Why Dataverse cannot be used, for the menu item's tooltip. */
  dataverseUnavailableReason?: string;
  setPreference: (mode: SaveMode) => Promise<void>;
}

const TONE_TO_TYPE = {
  success: MessageBarType.success,
  warning: MessageBarType.warning,
  error: MessageBarType.error,
} as const;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Flow service errors a Dataverse save would not fix (the definition itself was rejected). */
const isDefinitionRejected = (error: unknown) => {
  const status = statusOf(error);
  return status === 400 || status === 422;
};

export const useFlowEditor = (host: FlowEditorHost = {}) => {
  const api = useApiProviderContext();
  const hostRef = useRef(host);
  hostRef.current = host;

  const { envId, flowId } = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    return { envId: query.get('envId'), flowId: query.get('flowId') };
  }, []);

  const { messages, show: showMessage, dismiss: dismissMessage } = useStatusMessages();
  const [busy, setBusy] = useState<BusyState>(null);
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<FlowEnvironmentInfo | null>(
    envId ? { id: envId } : null
  );
  /** The text as last loaded from or saved to the server; the editor is dirty when it differs. */
  const [savedText, setSavedText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [validationPaneIsOpen, setValidationPaneIsOpen] = useState(false);
  /** Dataverse `workflowid` of a solution flow (flow GET properties.workflowEntityId). */
  const [workflowEntityId, setWorkflowEntityId] = useState<string | undefined>(undefined);
  const [savePreference, setSavePreferenceState] = useState<SaveMode>('flow');
  /** Dataverse row version the saved text corresponds to (see dataverseSaveStrategy). */
  const dataverseEtagRef = useRef<string | undefined>(undefined);
  /** Status/code/request ids of the last failure, for "Copy diagnostics". */
  const lastFailureRef = useRef<{ operation: string; status?: number; code?: string; requestIds?: DiagnosticRequestIds } | null>(null);
  const hasFetchedRef = useRef(false);

  const dataverse = dataverseAvailability(api, workflowEntityId);
  const effectiveSaveMode: SaveMode = savePreference === 'dataverse' && dataverse.available ? 'dataverse' : 'flow';

  const targetFor = useCallback(
    (): FlowTarget | null =>
      envId && flowId
        ? { envId, flowId, workflowEntityId, dataverseEtag: dataverseEtagRef.current }
        : null,
    [envId, flowId, workflowEntityId]
  );

  const rememberFailure = (operation: string, error: unknown) => {
    const ids = requestIdsOf(error);
    lastFailureRef.current = {
      operation,
      status: statusOf(error),
      code: (error as { code?: string } | null)?.code,
      requestIds: ids,
    };
  };

  // --- Load ----------------------------------------------------------------
  useEffect(() => {
    const target = targetFor();
    if (hasFetchedRef.current || !target || !api.isApiReady) return;
    hasFetchedRef.current = true;

    (async () => {
      try {
        setBusy('loading');
        const flow = await api.get(getFlowUrl(target.envId, target.flowId, api.isPowerPlatformApi));
        const doc = documentFromFlowResponse(flow);
        setName(doc.displayName);
        setSavedText(toEditorText(doc));
        setLoadError(null);

        // A solution flow: tell the background which Dataverse row this editor is
        // about, and remember it for the Dataverse save method.
        const entityId = flow?.properties?.workflowEntityId;
        if (typeof entityId === 'string' && entityId.trim()) {
          setWorkflowEntityId(entityId.trim());
          try {
            api.setWorkflowEntityId?.(entityId.trim(), target.flowId);
          } catch (error) {
            debugError('Could not report the workflow id:', error);
          }
        }
        showMessage(`Flow "${doc.displayName}" loaded successfully.`);
      } catch (error) {
        debugError('Error fetching flow:', error);
        const message = errorMessage(error);
        setLoadError(message);
        rememberFailure('load', error);
        showMessage(<ErrorText text={`Error loading flow: ${message}`} error={error} />, MessageBarType.error);
      } finally {
        setBusy(null);
      }

      // Best effort: a friendly environment name for the header and confirmations.
      const displayName = await fetchEnvironmentName(api, target.envId);
      if (displayName) setEnvironment({ id: target.envId, displayName });
    })();
    // api is rebuilt on every render; depend on the fields that matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId, flowId, api.isApiReady]);

  // --- Save method preference (per environment) -----------------------------
  useEffect(() => {
    if (!envId) return;
    let cancelled = false;
    readSaveMode(envId).then((mode) => {
      if (!cancelled) setSavePreferenceState(mode);
    });
    return () => {
      cancelled = true;
    };
  }, [envId]);

  const setSavePreference = useCallback(
    async (mode: SaveMode) => {
      setSavePreferenceState(mode);
      if (envId) await writeSaveMode(envId, mode);
    },
    [envId]
  );

  /** Re-read the row version after this editor wrote the flow some other way. */
  const refreshDataverseBaseline = useCallback(async () => {
    dataverseEtagRef.current = undefined;
    if (!workflowEntityId || !dataverseAvailability(api, workflowEntityId).available) return;
    dataverseEtagRef.current = await readDataverseEtag(api, workflowEntityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowEntityId, api.endpoints?.hasDataverse]);

  // Record the row version the loaded text is based on as soon as the Dataverse
  // method is in use, so a later Dataverse save can detect changes made elsewhere.
  useEffect(() => {
    if (effectiveSaveMode !== 'dataverse' || !workflowEntityId || !savedText) return;
    if (dataverseEtagRef.current) return;
    let cancelled = false;
    readDataverseEtag(api, workflowEntityId).then((etag) => {
      if (!cancelled && !dataverseEtagRef.current) dataverseEtagRef.current = etag;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSaveMode, workflowEntityId, !!savedText]);

  // --- Save / publish ------------------------------------------------------
  const saveDraftRef = useRef<(text: string, opts?: SaveOptions) => Promise<SaveOutcome>>(async () => ({ ok: false }));

  /** Retry a failed Flow service save once through Dataverse (from the offer in the error bar). */
  const retryThroughDataverse = useCallback(
    async (failedText: string, rememberForEnvironment: boolean) => {
      if (rememberForEnvironment) await setSavePreference('dataverse');
      const text = hostRef.current.getText?.() ?? failedText;
      const outcome = await saveDraftRef.current(text, { method: 'dataverse' });
      if (outcome.ok) hostRef.current.onSaved?.(text, outcome.serverText);
    },
    [setSavePreference]
  );

  const showSaveError = useCallback(
    (error: unknown, strategy: FlowSaveStrategy, text: string, opts: { offerDataverse: boolean; prefix?: string }) => {
      rememberFailure(`save:${strategy.id}`, error);
      if (error instanceof ConflictError) {
        showMessage(<ErrorText text={CONFLICT_TEXT} error={error} />, MessageBarType.error, true, {
          actions: (
            <ConflictActions
              onReload={() => window.location.reload()}
              onDownload={() => downloadText(jsonFileName(name), hostRef.current.getText?.() ?? text)}
            />
          ),
        });
        return;
      }
      if (error instanceof MissingConnectionReferenceError) {
        showMessage(
          `Couldn't save through Dataverse. ${missingReferencesSentence(error.referenceKeys)}`,
          MessageBarType.error,
          true
        );
        return;
      }
      const via = strategy.id === 'dataverse' ? ' through Dataverse' : '';
      const content = <ErrorText text={`${opts.prefix ?? `Error saving flow${via}`}: ${errorMessage(error)}`} error={error} />;
      if (opts.offerDataverse) {
        showMessage(
          <>
            {content}
            <span style={{ display: 'block', marginTop: 4 }}>
              This is a solution flow and a Dataverse sign-in is available, so you can try saving it
              through Dataverse instead. This method is experimental.
            </span>
          </>,
          MessageBarType.error,
          true,
          { actions: <DataverseOfferActions onTry={(remember) => retryThroughDataverse(text, remember)} /> }
        );
        return;
      }
      showMessage(content, MessageBarType.error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, showMessage, retryThroughDataverse]
  );

  /**
   * Save the editor text as a draft through the active FlowSaveStrategy.
   * Resolves with the server's version of the text so the page can show it.
   */
  const saveDraft = useCallback(
    async (text: string, opts: SaveOptions = {}): Promise<SaveOutcome> => {
      const target = targetFor();
      if (!target) {
        showMessage('Cannot save - missing flow parameters', MessageBarType.error);
        return { ok: false };
      }
      const parsed = parseEditorText(text, name);
      if (!parsed.ok) {
        showMessage(`Cannot save: ${parsed.error}`, MessageBarType.error);
        return { ok: false };
      }
      if (!name.trim()) {
        showMessage('Flow name cannot be empty', MessageBarType.error);
        return { ok: false };
      }

      const strategy = opts.method ? strategyFor(opts.method) : selectSaveStrategy(api, target, savePreference);

      const succeed = (saved: Awaited<ReturnType<FlowSaveStrategy['saveDraft']>>, used: FlowSaveStrategy) => {
        const serverText = toEditorText(saved);
        setSavedText(serverText);
        if (saved.displayName) setName(saved.displayName);
        if (used.id === 'dataverse') {
          dataverseEtagRef.current = saved.dataverseEtag;
        } else if (dataverseEtagRef.current || effectiveSaveMode === 'dataverse') {
          // This save changed the row: the recorded version is stale now.
          void refreshDataverseBaseline();
        }
        return serverText;
      };

      try {
        setBusy('saving');
        debugLog('Saving flow via', strategy.id);
        const saved = await strategy.saveDraft(api, target, parsed.doc);
        const serverText = succeed(saved, strategy);
        if (!opts.quiet) {
          showMessage(
            `Flow "${saved.displayName || name}" saved${strategy.id === 'dataverse' ? ' through Dataverse (experimental)' : ''}.`
          );
        }
        return { ok: true, serverText, method: strategy.id };
      } catch (error) {
        debugError('Error saving flow:', error);

        // Dataverse cannot express this flow's connections; nothing was sent, so
        // save it the default way (unless the Flow service is what just failed).
        if (error instanceof MissingConnectionReferenceError && strategy.id === 'dataverse' && !opts.method) {
          try {
            const saved = await flowServiceSaveStrategy.saveDraft(api, target, parsed.doc);
            const serverText = succeed(saved, flowServiceSaveStrategy);
            if (!opts.quiet) {
              showMessage(
                `Flow "${saved.displayName || name}" saved through the Flow service instead. ` +
                  missingReferencesSentence(error.referenceKeys),
                MessageBarType.warning,
                true
              );
            }
            return { ok: true, serverText, method: 'flow', fallbackReferenceKeys: error.referenceKeys };
          } catch (fallbackError) {
            debugError('Fallback save failed:', fallbackError);
            showSaveError(fallbackError, flowServiceSaveStrategy, text, { offerDataverse: false });
            return { ok: false };
          }
        }

        const offerDataverse =
          strategy.id === 'flow' &&
          !opts.method &&
          dataverse.available &&
          !isDefinitionRejected(error);
        showSaveError(error, strategy, text, { offerDataverse });
        return { ok: false };
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      api.isApiReady,
      api.isPowerPlatformApi,
      api.endpoints?.hasDataverse,
      targetFor,
      name,
      savePreference,
      effectiveSaveMode,
      dataverse.available,
      showMessage,
      showSaveError,
      refreshDataverseBaseline,
    ]
  );
  saveDraftRef.current = saveDraft;

  /** Save the editor text, then publish it. Publishing only happens after a successful save. */
  const publish = useCallback(
    async (text: string): Promise<SaveOutcome> => {
      const saved = await saveDraft(text, { quiet: true });
      const target = targetFor();
      if (!saved.ok || !target) return saved;

      // Publish through whichever method saved the draft.
      const strategy = strategyFor(saved.method);
      try {
        setBusy('publishing');
        await strategy.publish(api, target);
        if (saved.fallbackReferenceKeys) {
          showMessage(
            `Flow "${name}" saved and published through the Flow service instead. ` +
              missingReferencesSentence(saved.fallbackReferenceKeys),
            MessageBarType.warning,
            true
          );
        } else {
          showMessage(
            `Flow "${name}" saved and published${strategy.id === 'dataverse' ? ' through Dataverse (experimental)' : ''}.`
          );
        }
      } catch (error) {
        debugError('Error publishing flow:', error);
        rememberFailure(`publish:${strategy.id}`, error);
        showMessage(
          <ErrorText text={`Flow saved but publish failed: ${errorMessage(error)}`} error={error} />,
          MessageBarType.error
        );
      } finally {
        setBusy(null);
      }
      if (dataverseEtagRef.current || strategy.id === 'dataverse') void refreshDataverseBaseline();
      // The draft was saved either way, so the caller should show the server text.
      return saved;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saveDraft, targetFor, name, showMessage, api.isPowerPlatformApi, refreshDataverseBaseline]
  );

  // --- Validate -------------------------------------------------------------
  const validate = useCallback(
    async (text: string) => {
      const target = targetFor();
      if (!target) {
        showMessage('Cannot validate - missing flow parameters', MessageBarType.error);
        return;
      }
      const parsed = parseEditorText(text, name);
      if (!parsed.ok) {
        showMessage(`Cannot validate: ${parsed.error}`, MessageBarType.error);
        return;
      }

      try {
        setBusy('validating');
        const schema = new SchemaValidator().validateFlow(parsed.doc.definition);
        const checks = await runFlowCheckers(api, target, parsed.doc);
        const report: ValidationReport = { schema, ...checks };
        setValidation(report);
        setValidationPaneIsOpen(true);

        const summary = summarizeValidation(report);
        const failure = failedCheckWithRequestIds(report);
        if (failure) {
          rememberFailure('validate', failure);
          showMessage(<ErrorText text={summary.text} error={failure} />, TONE_TO_TYPE[summary.tone]);
        } else {
          showMessage(summary.text, TONE_TO_TYPE[summary.tone]);
        }
      } catch (error) {
        debugError('Error during validation:', error);
        rememberFailure('validate', error);
        showMessage(
          <ErrorText text={`Error during validation: ${errorMessage(error)}`} error={error} />,
          MessageBarType.error
        );
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.isApiReady, api.isPowerPlatformApi, targetFor, name, showMessage]
  );

  // --- Diagnostics ------------------------------------------------------------
  /** Background diagnostics plus the editor's own state; no tokens, no flow content. */
  const copyDiagnostics = useCallback(async () => {
    if (!api.getDiagnostics) {
      showMessage('Diagnostics are not available on this page.', MessageBarType.warning);
      return;
    }
    let text: string;
    try {
      text = await api.getDiagnostics();
    } catch (error) {
      showMessage(`Couldn't collect diagnostics: ${errorMessage(error)}`, MessageBarType.error);
      return;
    }
    const failure = lastFailureRef.current;
    const lines = [
      '',
      'Flow editor',
      `  Save method: ${effectiveSaveMode} (preference: ${savePreference})`,
      `  Solution flow: ${workflowEntityId ? 'yes' : 'no'}`,
      `  Dataverse save available: ${dataverse.available ? 'yes' : 'no'}`,
    ];
    if (failure) {
      const ids = failure.requestIds || {};
      lines.push(
        `  Last failure: ${failure.operation}` +
          (failure.status ? `, HTTP ${failure.status}` : '') +
          (failure.code ? `, code ${failure.code}` : '')
      );
      if (ids.serviceRequestId) lines.push(`    Service request id: ${ids.serviceRequestId}`);
      if (ids.correlationRequestId) lines.push(`    Correlation request id: ${ids.correlationRequestId}`);
      if (ids.clientRequestId) lines.push(`    Client request id: ${ids.clientRequestId}`);
    }
    const copied = await copyText(`${text}\n${lines.join('\n')}\n`);
    if (copied) showMessage('Diagnostics copied (no tokens or flow content included)');
    else showMessage("Couldn't copy diagnostics to the clipboard. Allow clipboard access and try again.", MessageBarType.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.getDiagnostics, showMessage, effectiveSaveMode, savePreference, workflowEntityId, dataverse.available]);

  const saveMethod: SaveMethodState = {
    preference: savePreference,
    effective: effectiveSaveMode,
    dataverseAvailable: dataverse.available,
    dataverseUnavailableReason: dataverse.available ? undefined : dataverse.reason,
    setPreference: setSavePreference,
  };

  return {
    envId,
    flowId,
    name,
    environment,
    savedText,
    loadError,
    busy,
    isLoading: busy !== null,
    messages,
    showMessage,
    dismissMessage,
    validation,
    validationPaneIsOpen,
    setValidationPaneIsOpen,
    workflowEntityId,
    saveMethod,
    saveDraft,
    publish,
    validate,
    copyDiagnostics,
  };
};
