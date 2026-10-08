import { MessageBarType } from '@fluentui/react/lib/MessageBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiProviderContext } from '../../services/ApiProvider';
import { SchemaValidator } from '../../services/SchemaValidator';
import {
  documentFromFlowResponse,
  FlowTarget,
  getFlowUrl,
  parseEditorText,
  selectSaveStrategy,
  toEditorText,
} from './flowPersistence';
import { runFlowCheckers, summarizeValidation, ValidationReport } from './flowValidation';
import { fetchEnvironmentName } from '../flows-list/flowsApi';
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

export type SaveOutcome = { ok: true; serverText: string } | { ok: false };

export type BusyState = null | 'loading' | 'saving' | 'publishing' | 'validating';

const TONE_TO_TYPE = {
  success: MessageBarType.success,
  warning: MessageBarType.warning,
  error: MessageBarType.error,
} as const;

export const useFlowEditor = () => {
  const api = useApiProviderContext();
  const { envId, flowId } = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    return { envId: query.get('envId'), flowId: query.get('flowId') };
  }, []);
  const target: FlowTarget | null = envId && flowId ? { envId, flowId } : null;

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
  const hasFetchedRef = useRef(false);

  // --- Load ----------------------------------------------------------------
  useEffect(() => {
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
        showMessage(`Flow "${doc.displayName}" loaded successfully.`);
      } catch (error) {
        debugError('Error fetching flow:', error);
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        showMessage(`Error loading flow: ${message}`, MessageBarType.error);
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

  // --- Save / publish ------------------------------------------------------
  /**
   * Save the editor text as a draft through the active FlowSaveStrategy.
   * Resolves with the server's version of the text so the page can show it.
   */
  const saveDraft = useCallback(
    async (text: string, opts: { quiet?: boolean } = {}): Promise<SaveOutcome> => {
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

      const strategy = selectSaveStrategy(api, target);
      try {
        setBusy('saving');
        debugLog('Saving flow via', strategy.id);
        const saved = await strategy.saveDraft(api, target, parsed.doc);
        const serverText = toEditorText(saved);
        setSavedText(serverText);
        if (saved.displayName) setName(saved.displayName);
        if (!opts.quiet) showMessage(`Flow "${saved.displayName || name}" saved.`);
        return { ok: true, serverText };
      } catch (error) {
        debugError('Error saving flow:', error);
        showMessage(
          `Error saving flow: ${error instanceof Error ? error.message : String(error)}`,
          MessageBarType.error
        );
        return { ok: false };
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.isApiReady, api.isPowerPlatformApi, envId, flowId, name, showMessage]
  );

  /** Save the editor text, then publish it. Publishing only happens after a successful save. */
  const publish = useCallback(
    async (text: string): Promise<SaveOutcome> => {
      const saved = await saveDraft(text, { quiet: true });
      if (!saved.ok || !target) return saved;

      const strategy = selectSaveStrategy(api, target);
      try {
        setBusy('publishing');
        await strategy.publish(api, target);
        showMessage(`Flow "${name}" saved and published.`);
      } catch (error) {
        debugError('Error publishing flow:', error);
        showMessage(
          `Flow saved but publish failed: ${error instanceof Error ? error.message : String(error)}`,
          MessageBarType.error
        );
      } finally {
        setBusy(null);
      }
      // The draft was saved either way, so the caller should show the server text.
      return saved;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saveDraft, name, showMessage, envId, flowId, api.isPowerPlatformApi]
  );

  // --- Validate -------------------------------------------------------------
  const validate = useCallback(
    async (text: string) => {
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
        showMessage(summary.text, TONE_TO_TYPE[summary.tone]);
      } catch (error) {
        debugError('Error during validation:', error);
        showMessage(
          `Error during validation: ${error instanceof Error ? error.message : String(error)}`,
          MessageBarType.error
        );
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.isApiReady, api.isPowerPlatformApi, envId, flowId, name, showMessage]
  );

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
    saveDraft,
    publish,
    validate,
  };
};
