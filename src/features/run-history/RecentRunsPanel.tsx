import { DefaultButton } from '@fluentui/react/lib/Button';
import { Checkbox } from '@fluentui/react/lib/Checkbox';
import { Link } from '@fluentui/react/lib/Link';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Spinner } from '@fluentui/react/lib/Spinner';
import { Stack } from '@fluentui/react/lib/Stack';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { useEffect, useRef, useState } from 'react';
import { classifyApiUrl, isMakerOrigin } from '../../chrome/hosts';
import { createRecentRunsClient } from './runHistoryApi';
import type { RecentRun, RecentRunDetail, RecentStep, RunHistoryApi, RunOutput, RunTarget } from './runHistoryApi';
import { RunOutputInspector } from './RunOutputInspector';

interface RecentRunsPanelProps extends RunTarget {
  api: RunHistoryApi;
  isOpen: boolean;
  onDismiss: () => void;
  portalUrl?: string;
  onRevealStep?: (step: RecentStep) => boolean;
  onReconnect?: () => void;
}

const listClass = mergeStyles({ listStyle: 'none', padding: 0, margin: 0 });
const rowClass = mergeStyles({ borderBottom: '1px solid var(--color-stroke)', padding: '10px 0' });
const summaryClass = mergeStyles({ cursor: 'pointer', padding: '4px 0', lineHeight: 1.6 });
const secondaryClass = mergeStyles({ color: 'var(--color-fg-secondary)' });
const detailClass = mergeStyles({ margin: '10px 0 6px 16px', overflowWrap: 'anywhere' });
const stepClass = mergeStyles({ padding: '6px 0', borderTop: '1px solid var(--color-stroke)' });
const errorClass = mergeStyles({ color: 'var(--color-danger)', margin: '4px 0' });

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function displayDuration(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.floor((end - start) / 1000);
  if (!seconds) return '< 1s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return [hours && `${hours}h`, minutes && `${minutes}m`, `${seconds % 60}s`].filter(Boolean).join(' ');
}

function fallbackPortal(apiUrl?: string) {
  const endpoint = apiUrl ? classifyApiUrl(apiUrl) : null;
  if (!endpoint || endpoint.audience === 'dataverse') return;
  const { host } = endpoint;
  if (host.endsWith('.com')) return 'https://make.powerautomate.com';
  if (host.endsWith('.appsplatform.us')) return 'https://make.powerautomate.appsplatform.us';
  const governmentCloud = /(?:^|\.)(gov|high)\.api\.flow\.microsoft\.us$/.exec(host)?.[1] ??
    /(?:^|\.)api\.(gov|high)\.powerplatform\.microsoft\.us$/.exec(host)?.[1] ??
    /(?:^|\.)(usgovhigh|usgov|gov|high)\.api\.powerapps\.us$/.exec(host)?.[1];
  if (governmentCloud) return `https://make.${governmentCloud.includes('high') ? 'high' : 'gov'}.powerautomate.us`;
}

export function recentRunHistoryUrl({ envId, flowId }: RunTarget, portalUrl?: string, apiUrl?: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(envId) || !/^[a-z0-9][a-z0-9._-]*$/i.test(flowId)) return;
  // A source URL can retain the solution or shared-flow prefix for this target.
  const source = portalUrl && isMakerOrigin(portalUrl) ? new URL(portalUrl) : undefined;
  const recognized = source && !source.username && !source.password && !source.port ? source : undefined;
  if (recognized) {
    recognized.hostname = recognized.hostname === 'make.apps.appsplatform.us'
      ? 'make.powerautomate.appsplatform.us'
      : recognized.hostname.replace(/powerapps(?=\.(?:com|us)$)/, 'powerautomate');
  }
  const origin = recognized?.origin ?? fallbackPortal(apiUrl);
  if (!origin) return;

  const path = /^\/environments\/([a-z0-9._-]+)\/(?:solutions\/[a-z0-9._-]+\/)?flows\/(?:shared\/)?([a-z0-9._-]+)(?=\/|$)/i
    .exec(recognized?.pathname ?? '');
  const sameTarget = path?.[1].toLowerCase() === envId.toLowerCase() && path?.[2].toLowerCase() === flowId.toLowerCase();
  const flowPath = sameTarget ? path[0] : `/environments/${encodeURIComponent(envId)}/flows/${encodeURIComponent(flowId)}`;
  return `${origin}${flowPath}/runs`;
}

type RecentRunLoader = (run: RecentRun) => Promise<RecentRunDetail>;
type OutputLoader = (run: RecentRun, step: RecentStep) => Promise<RunOutput>;
type DetailState = { loading: true } | { detail: RecentRunDetail } | { error: string };
type ListState = { loading: true } | { error: string } | {
  runs: RecentRun[];
  loadDetail: RecentRunLoader;
  loadOutput: OutputLoader;
  signal: AbortSignal;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const failed = (status?: string) => /^(failed|timedout)$/i.test(status ?? '');

function StepOutput({ load, step, signal }: { load: () => Promise<RunOutput>; step: RecentStep; signal: AbortSignal }) {
  const [result, setResult] = useState<RunOutput>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function inspect() {
    setError('');
    setLoading(true);
    try {
      const output = await load();
      if (!signal.aborted) setResult(output);
    } catch (reason) {
      if (!signal.aborted) setError(errorMessage(reason, 'Unable to load the output.'));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  return result ? <RunOutputInspector result={result} step={step} /> : (
    <div><Link disabled={loading} onClick={() => void inspect()}>{loading ? 'Loading output…' : 'Inspect output'}</Link>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function RunRow({ run, runHistoryUrl, loadDetail, loadOutput, onRevealStep, signal }: {
  run: RecentRun;
  runHistoryUrl?: string;
  loadDetail: RecentRunLoader;
  loadOutput: OutputLoader;
  onRevealStep?: RecentRunsPanelProps['onRevealStep'];
  signal: AbortSignal;
}) {
  const [state, setState] = useState<DetailState>();
  const [showSlowest, setShowSlowest] = useState(false);
  const [jumpUnavailable, setJumpUnavailable] = useState(false);
  const firstFailed = useRef<HTMLLIElement>(null);
  const start = Date.parse(run.startTime ?? '');
  const duration = displayDuration(start, Date.parse(run.endTime ?? ''));
  const detail = state && 'detail' in state ? state.detail : undefined;
  const runError = detail?.error ?? run.error;
  const failedStep = detail?.steps.find(step => failed(step.status) || !!step.error);
  const steps = showSlowest && detail ? [...detail.steps].sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1)) : detail?.steps;

  function load() {
    setState({ loading: true });
    loadDetail(run).then(result => {
      if (!signal.aborted) setState({ detail: result });
    }).catch(error => {
      if (!signal.aborted) setState({ error: errorMessage(error, 'Unable to load this run.') });
    });
  }

  return (
    <li className={rowClass}>
      <details onToggle={event => { if (event.currentTarget.open && !state) load(); }}>
        <summary className={summaryClass}>
          <strong>{run.status ?? 'Unknown status'}</strong>
          {' · '}
          {Number.isFinite(start) ? <time dateTime={run.startTime}>{dateFormat.format(start)}</time> : 'Start time unavailable'}
          {duration && <span className={secondaryClass}> · {duration}</span>}
        </summary>
        <div className={detailClass}>
          {runHistoryUrl && (
            <Link href={`${runHistoryUrl}/${encodeURIComponent(run.name)}`} target="_blank" rel="noopener noreferrer">
              Open run in Power Automate
            </Link>
          )}
          {runError && <p className={errorClass}>{runError}</p>}
          {state && 'loading' in state && <Spinner label="Loading run steps…" />}
          {state && 'error' in state && (
            <MessageBar messageBarType={MessageBarType.error} actions={<DefaultButton text="Retry" onClick={load} />}>
              {state.error}
            </MessageBar>
          )}
          {detail && (steps?.length ? (
            <>
            <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
              {failedStep && <DefaultButton text="Jump to failed step" onClick={() => firstFailed.current?.focus()} />}
              <DefaultButton text={showSlowest ? 'Show execution order' : 'Slowest steps first'} onClick={() => setShowSlowest(value => !value)} />
            </Stack>
            {jumpUnavailable && <p role="status">This step could not be matched to the current flow definition.</p>}
            <ul aria-label="Run steps" className={listClass}>
              {steps.map(step => (
                <li key={`${step.kind}-${step.name}`} className={stepClass}
                    ref={failedStep === step ? firstFailed : undefined} tabIndex={failedStep === step ? -1 : undefined}>
                  <strong>{step.name}</strong> <span className={secondaryClass}>{step.status}</span>
                  {step.durationMs !== undefined && <span className={secondaryClass}> · {step.durationMs < 1000 ? `${step.durationMs} ms` : displayDuration(0, step.durationMs)}</span>}
                  {step.error && <p className={errorClass}>{step.error}</p>}
                  {!!onRevealStep && (failed(step.status) || !!step.error) && (
                    <Link onClick={() => setJumpUnavailable(!onRevealStep(step))}>Show failed step in editor</Link>
                  )}
                  <StepOutput step={step} signal={signal} load={() => loadOutput(run, step)} />
                </li>
              ))}
            </ul>
            </>
          ) : <p>No steps were reported for this run.</p>)}
        </div>
      </details>
    </li>
  );
}

function RecentRuns({ api, envId, flowId, portalUrl, onRevealStep, onReconnect }: Omit<RecentRunsPanelProps, 'isOpen' | 'onDismiss'>) {
  const { request } = api;
  const { legacyApiUrl, powerPlatformApiUrl } = api.endpoints ?? {};
  const runHistoryUrl = recentRunHistoryUrl({ envId, flowId }, portalUrl, legacyApiUrl ?? powerPlatformApiUrl);
  const [state, setState] = useState<ListState>({ loading: true });
  const [refreshCount, setRefreshCount] = useState(0);
  const [failedOnly, setFailedOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const load = async () => {
      setState({ loading: true });
      try {
        const client = createRecentRunsClient({
          request,
          endpoints: { legacyApiUrl, powerPlatformApiUrl, hasDataverse: false },
        }, { envId, flowId }, signal);
        const runs = await client.list();
        if (!signal.aborted) setState({ runs, loadDetail: client.detail, loadOutput: client.output, signal });
      } catch (error) {
        if (!signal.aborted) setState({ error: errorMessage(error, 'Unable to load recent runs.') });
      }
    };
    void load();
    return () => controller.abort();
  }, [request, legacyApiUrl, powerPlatformApiUrl, envId, flowId, refreshCount]);

  const runs = 'runs' in state ? state.runs.filter(run => !failedOnly || failed(run.status)) : [];
  return (
    <Stack tokens={{ childrenGap: 16, padding: '16px 0' }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 12 }}>
        <DefaultButton text="Refresh" disabled={'loading' in state} onClick={() => setRefreshCount(count => count + 1)} />
        {runHistoryUrl && <Link href={runHistoryUrl} target="_blank" rel="noopener noreferrer">Open run history</Link>}
      </Stack>
      {'runs' in state && <Checkbox label="Failed runs only" checked={failedOnly} onChange={(_, value) => setFailedOnly(!!value)} />}
      {'loading' in state && <Spinner label="Loading recent runs…" />}
      {'error' in state && <MessageBar messageBarType={MessageBarType.error} actions={onReconnect && <DefaultButton text="Reconnect" onClick={onReconnect} />}>{state.error}</MessageBar>}
      {'runs' in state && (runs.length ? (
        <ul aria-label="Recent runs" className={listClass}>
          {runs.map(run => (
            <RunRow key={run.name} run={run} runHistoryUrl={runHistoryUrl} loadDetail={state.loadDetail} loadOutput={state.loadOutput}
              onRevealStep={onRevealStep} signal={state.signal} />
          ))}
        </ul>
      ) : <p role="status">{failedOnly ? 'No failures in the 10 most recent runs.' : 'No recent runs were found for this flow.'}</p>)}
    </Stack>
  );
}

export default function RecentRunsPanel({ isOpen, onDismiss, ...props }: RecentRunsPanelProps) {
  return (
    <Panel isOpen={isOpen} onDismiss={onDismiss} type={PanelType.medium} headerText="Recent runs" closeButtonAriaLabel="Close">
      {isOpen && <RecentRuns key={`${props.envId}/${props.flowId}`} {...props} />}
    </Panel>
  );
}
