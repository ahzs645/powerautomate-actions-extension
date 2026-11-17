import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Checkbox } from '@fluentui/react/lib/Checkbox';
import { ChoiceGroup } from '@fluentui/react/lib/ChoiceGroup';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { ProgressIndicator } from '@fluentui/react/lib/ProgressIndicator';
import { Stack } from '@fluentui/react/lib/Stack';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { TextField } from '@fluentui/react/lib/TextField';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, useApiProviderContext } from '../../services/ApiProvider';
import type { RunExportSession } from '../../services/interfaces/IFlowEditorActions';
import { downloadBlob } from '../flow-editor/browserActions';
import { createRunHistoryClient, getRunEndpoints, RunTarget } from './runHistoryApi';
import { ExportProgress, exportRunHistory, localDateInput } from './runHistoryExport';

const mainClass = mergeStyles({ flex: 1, overflow: 'auto', padding: '28px 24px', color: 'var(--color-fg)' });
const embeddedClass = mergeStyles({ padding: '16px', color: 'var(--color-fg)' });
const formClass = mergeStyles({ maxWidth: 680, margin: '0 auto' });
const headingClass = mergeStyles({ margin: 0, fontSize: 28, fontWeight: 600 });
const descriptionClass = mergeStyles({ margin: 0, color: 'var(--color-fg-secondary)' });
const flowNameClass = mergeStyles({ margin: 0, overflowWrap: 'anywhere', fontWeight: 600 });

function defaultDates() {
  const through = new Date();
  const from = new Date(through);
  from.setDate(from.getDate() - 6);
  return { from: localDateInput(from), through: localDateInput(through) };
}

function progressLabel(progress: ExportProgress, format: 'zip' | 'xlsx') {
  switch (progress.phase) {
    case 'history': return `Reading run history. Scanned ${progress.scanned} records and found ${progress.matched} in range.`;
    case 'details': return `Collecting step logs for ${progress.done} of ${progress.total} runs…`;
    case 'archive': return format === 'xlsx' ? 'Building Excel workbook…' : 'Building ZIP archive…';
  }
}

export default function RunHistoryExportPage({ envId, flowId, source }: RunTarget & { source?: RunExportSession }) {
  const editorApi = useApiProviderContext();
  const { legacyApiUrl, legacyToken, powerPlatformApiUrl, powerPlatformToken } = source?.credentials ?? {};
  const inlineApi = useMemo(() => {
    const client = createApiClient({
      getDetails: () => ({ legacyApiUrl, legacyToken, powerPlatformApiUrl, powerPlatformToken, isReady: !!legacyToken }),
    });
    return { request: client.request, endpoints: { legacyApiUrl, powerPlatformApiUrl, hasDataverse: false } };
  }, [legacyApiUrl, legacyToken, powerPlatformApiUrl, powerPlatformToken]);
  const api = source ? inlineApi : editorApi;
  const ready = Boolean(getRunEndpoints(api, { envId, flowId }).flow);
  const embedded = Boolean(source);
  const [flowName, setFlowName] = useState<string>();
  const [dates, setDates] = useState(defaultDates);
  const [includePayloads, setIncludePayloads] = useState(false);
  const [format, setFormat] = useState<'zip' | 'xlsx'>('zip');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: MessageBarType } | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof exportRunHistory>>>(null);
  const activeExport = useRef<AbortController | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (!embedded) document.title = 'Export flow runs · Power Automate Toolkit';
    return () => activeExport.current?.abort();
  }, [embedded]);

  useEffect(() => {
    if (!embedded || !ready) return;
    const controller = new AbortController();
    createRunHistoryClient(inlineApi, { envId, flowId }, controller.signal).getFlowName().then(name => {
      if (name && !controller.signal.aborted) setFlowName(name);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [embedded, ready, inlineApi, envId, flowId]);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || activeExport.current) return;
    const controller = new AbortController();
    activeExport.current = controller;
    setResult(null);
    setMessage(null);
    try {
      const archive = await exportRunHistory(api, {
        envId, flowId, ...dates, includePayloads, format, signal: controller.signal, onProgress: setProgress,
      });
      setResult(archive);
      if (!archive) {
        setMessage({ text: 'No available runs started in the selected date range.', type: MessageBarType.info });
      }
    } catch (error) {
      const canceled = controller.signal.aborted;
      controller.abort();
      setMessage(canceled
        ? { text: 'Export canceled.', type: MessageBarType.info }
        : { text: error instanceof Error ? error.message : 'Unable to export run history.', type: MessageBarType.error });
    } finally {
      activeExport.current = null;
      setProgress(null);
      setCanceling(false);
    }
  }

  function updateDate(key: 'from' | 'through', value: string) {
    setDates(current => ({ ...current, [key]: value }));
    setResult(null);
    setMessage(null);
  }

  function refreshSourceTab() {
    if (source) {
      chrome.tabs.reload(source.tabId, {}, () => { void chrome.runtime.lastError; });
      return;
    }
    chrome.runtime.sendMessage({ type: 'refresh' }, () => { void chrome.runtime.lastError; });
  }

  const connectButton = source?.runHistoryUrl
    ? <DefaultButton text="Open Run history" href={source.runHistoryUrl} target="_blank" rel="noopener noreferrer" />
    : <DefaultButton type="button" text="Refresh source tab" onClick={refreshSourceTab} />;

  return (
    <section className={embedded ? embeddedClass : mainClass} aria-label="Export flow runs">
      <form className={formClass} onSubmit={prepare}>
        <Stack tokens={{ childrenGap: 18 }}>
          <h1 className={headingClass}>Export flow runs</h1>
          {embedded && <p className={flowNameClass}>{flowName ?? `Flow ${flowId}`}</p>}
          <p className={descriptionClass}>
            Download the available runs for this flow with a run summary, step summaries, and a JSON log per run.
            Power Automate typically retains 28 days of run history.
          </p>
          <Stack horizontal wrap tokens={{ childrenGap: 16 }}>
            <TextField label="Start date" type="date" required value={dates.from}
              disabled={!!progress} onChange={(_, value) => updateDate('from', value ?? '')} />
            <TextField label="End date" type="date" required min={dates.from} value={dates.through}
              disabled={!!progress} onChange={(_, value) => updateDate('through', value ?? '')} />
          </Stack>
          <p className={descriptionClass}>Both dates are inclusive and use the browser time zone ({timeZone}). Runs are selected by start time.</p>
          <ChoiceGroup label="Export format" selectedKey={format} disabled={!!progress}
            options={[{ key: 'zip', text: 'ZIP · CSV summaries and full JSON logs' }, { key: 'xlsx', text: 'Excel · linked run summary and step sheets' }]}
            onChange={(_, option) => {
              setFormat(option?.key === 'xlsx' ? 'xlsx' : 'zip');
              setResult(null);
              setMessage(null);
            }} />
          <Checkbox
            label="Include step inputs and outputs"
            checked={includePayloads}
            disabled={!!progress}
            onChange={(_, checked) => {
              setIncludePayloads(Boolean(checked));
              setResult(null);
              setMessage(null);
            }}
          />
          {includePayloads && (
            <MessageBar messageBarType={MessageBarType.warning}>
              Payloads can contain sensitive data. Secure inputs and outputs remain hidden.
              {format === 'xlsx' && ' Use ZIP for payloads longer than Excel’s 32,767-character cell limit.'}
            </MessageBar>
          )}
          {!ready && (
            <MessageBar actions={connectButton}>
              {source?.runHistoryUrl
                ? 'Open this flow’s Run history in Power Automate to connect.'
                : 'Waiting for Power Automate sign-in. Keep the Run history tab open and signed in.'}
            </MessageBar>
          )}
          {embedded && document.documentElement.dataset.surface !== 'sidepanel' && progress && (
            <p className={descriptionClass}>Keep this popup open until the ZIP is ready.</p>
          )}
          {progress && (
            <div role="status" aria-live="polite">
              <ProgressIndicator label={canceling ? 'Canceling…' : progressLabel(progress, format)}
                percentComplete={progress.phase === 'details' ? progress.done / progress.total : undefined} />
            </div>
          )}
          {message && (
            <MessageBar messageBarType={message.type} actions={message.type === MessageBarType.error
              ? connectButton
              : undefined}>
              {message.text}
            </MessageBar>
          )}
          {result && (
            <MessageBar messageBarType={result.issueCount ? MessageBarType.warning : MessageBarType.success}>
              {result.runCount} {result.runCount === 1 ? 'run' : 'runs'} ready to download.
              {result.issueCount > 0 && (
                  <> Some logs could not be retrieved ({result.issueCount}). See {format === 'xlsx' ? 'the Export issues sheet' : 'manifest.json'}.</>
              )}
            </MessageBar>
          )}
          <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
            <PrimaryButton type="submit" text="Prepare export" disabled={!ready || !!progress || !dates.from || !dates.through} />
            {progress && <DefaultButton type="button" text="Cancel" disabled={canceling} onClick={() => {
              setCanceling(true);
              activeExport.current?.abort();
            }} />}
            {result && <PrimaryButton type="button" text={format === 'xlsx' ? 'Download Excel' : 'Download ZIP'} iconProps={{ iconName: 'Download' }}
              onClick={() => downloadBlob(result.fileName, result.blob)} />}
          </Stack>
        </Stack>
      </form>
    </section>
  );
}
