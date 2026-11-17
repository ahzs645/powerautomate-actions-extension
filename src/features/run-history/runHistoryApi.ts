import { classifyApiUrl } from '../../chrome/hosts';
import { ApiError, IApiProvider } from '../../services/ApiProvider';
import { fetchRunPayload } from './runPayload';

export interface RunTarget {
  envId: string;
  flowId: string;
}

export type RunHistoryApi = Pick<IApiProvider, 'request' | 'endpoints'>;

export interface RunRange {
  start: number;
  endExclusive: number;
  timeZone: string;
}

interface ContentLink {
  uri?: string;
  secureData?: unknown;
  metadata?: { foreachItemsCount?: number };
}

export interface RuntimeProperties {
  startTime?: string;
  endTime?: string;
  status?: string;
  code?: string;
  error?: { code?: string; message?: string; details?: Array<{ message?: string }> };
  correlation?: { clientTrackingId?: string; actionTrackingId?: string };
  trackingId?: string;
  retryHistory?: Array<{
    code?: string;
    startTime?: string;
    endTime?: string;
    clientRequestId?: string;
    serviceRequestId?: string;
    error?: RuntimeProperties['error'];
  }>;
}

export interface StepProperties extends RuntimeProperties {
  name?: string;
  inputs?: unknown;
  outputs?: unknown;
  inputsLink?: ContentLink;
  outputsLink?: ContentLink;
  repetitionCount?: number;
  iterationCount?: number;
  repetitionIndexes?: Array<{ scopeName: string; itemIndex: number }>;
}

interface RunProperties extends RuntimeProperties {
  trigger?: StepProperties;
  actions?: Record<string, StepProperties>;
  flow?: { properties?: { displayName?: string; definition?: { actions?: Record<string, DefinitionAction> } } };
}

export interface DefinitionAction {
  type?: string;
  actions?: Record<string, DefinitionAction>;
  else?: { actions?: Record<string, DefinitionAction> };
  cases?: Record<string, { actions?: Record<string, DefinitionAction> }>;
  default?: { actions?: Record<string, DefinitionAction> };
}

export interface RunRecord {
  name: string;
  isMigrationSource?: boolean;
  properties: RunProperties;
}

export interface RecentStep {
  name: string;
  kind: 'action' | 'trigger';
  status?: string;
  startTime?: string;
  durationMs?: number;
  error?: string;
}

export type RunOutput = { status: 'available'; value: unknown } | { status: 'secured' | 'unavailable' };

export interface RecentRun extends Pick<RunRecord, 'name' | 'isMigrationSource'> {
  status?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface RecentRunDetail {
  error?: string;
  steps: RecentStep[];
}

interface Page<T> {
  value: T[];
  nextLink?: string;
  '@odata.nextLink'?: string;
}

type Request = NonNullable<IApiProvider['request']>;
type RunAudience = 'flow' | 'powerPlatform';

interface RunEndpoint {
  audience: RunAudience;
  url: URL;
  version: string;
}

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

function endpoint(audience: RunAudience, base: string | undefined, path: string): RunEndpoint | undefined {
  if (!base || classifyApiUrl(base)?.audience !== audience) return undefined;
  const url = new URL(path, base);
  if (url.port || url.username || url.password) return undefined;
  return { audience, url, version: audience === 'flow' ? '2016-11-01' : '1' };
}

export function getRunEndpoints(api: RunHistoryApi, { envId, flowId }: RunTarget) {
  if (!SAFE_SEGMENT.test(envId) || !SAFE_SEGMENT.test(flowId)) return {};
  const legacyPath = `/providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}/runs`;
  const platformPath = `/powerautomate/flows/${flowId}/runs`;
  const flow = endpoint('flow', api.endpoints?.legacyApiUrl, legacyPath);
  const platform = endpoint('powerPlatform', api.endpoints?.powerPlatformApiUrl, platformPath);
  // The newer API identifies the environment in the host, so a token captured
  // during a switch from a different environment must not select its endpoint.
  const env = envId.replace(/-/g, '').toLowerCase();
  const host = `${env.slice(0, -2)}.${env.slice(-2)}.environment.api.`;
  return { flow, platform: platform?.url.hostname.startsWith(host) ? platform : undefined };
}

function apiGet<T>(request: Request, audience: RunAudience, url: URL, signal: AbortSignal) {
  return request<T>({ method: 'GET', audience, url: url.href, absolute: true, redirect: 'error', signal });
}

const readText = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const startTime = (value?: string) => Date.parse(value ?? '') || 0;

function errorText(properties: RuntimeProperties) {
  const { error } = properties;
  return readText(error?.message) ?? readText(error?.details?.[0]?.message) ?? readText(error?.code);
}

async function* pages<T>(request: Request, target: RunEndpoint, signal: AbortSignal) {
  const visited = new Set<string>();
  let url = new URL(target.url);
  url.searchParams.set('api-version', target.version);
  while (true) {
    signal.throwIfAborted();
    if (visited.has(url.href)) throw new Error('Power Automate returned a repeated pagination link.');
    visited.add(url.href);
    const page = await apiGet<Page<T>>(request, target.audience, url, signal);
    if (!Array.isArray(page?.value)) throw new Error('Power Automate returned an invalid history page.');
    yield page.value;

    const next = page.nextLink || page['@odata.nextLink'];
    if (!next) return;
    url = new URL(next, url);
    if (url.origin !== target.url.origin || url.pathname.toLowerCase() !== target.url.pathname.toLowerCase() ||
        url.username || url.password || url.hash) {
      throw new Error('Power Automate returned a pagination link outside the requested resource.');
    }
  }
}

function createDetailLoader(request: Request, { flow, platform }: ReturnType<typeof getRunEndpoints>, signal: AbortSignal) {
  let platformAuthRejected = false;

  return async (
    run: Pick<RunRecord, 'name' | 'isMigrationSource'>,
    expansions: string[],
    repetitionCount: boolean,
  ) => {
    const load = async (target: RunEndpoint) => {
      const url = new URL(`${target.url.pathname}/${encodeURIComponent(run.name)}`, target.url);
      url.search = new URLSearchParams({
        '$expand': expansions.join(','),
        ...(repetitionCount ? { include: 'repetitionCount' } : {}),
        isMigrationSource: String(run.isMigrationSource === true),
        'api-version': target.version,
      }).toString();
      const detail = await apiGet<RunRecord>(request, target.audience, url, signal);
      if (detail?.name !== run.name || !detail.properties ||
          (!detail.properties.trigger && !detail.properties.actions)) {
        throw new Error('Power Automate returned an incomplete run detail response.');
      }
      return detail;
    };

    if (platform && !platformAuthRejected) {
      try {
        return await load(platform);
      } catch (error) {
        if (!flow || !(error instanceof ApiError) || ![400, 401, 404].includes(error.status)) throw error;
        // The regional Flow API uses the same audience that already listed these runs.
        if (error.status === 401) platformAuthRejected = true;
      }
    }
    if (!flow) throw new Error('No compatible run history endpoint is available.');
    return load(flow);
  };
}

export function createRecentRunsClient(api: RunHistoryApi, target: RunTarget, signal: AbortSignal) {
  const endpoints = getRunEndpoints(api, target);
  const listEndpoint = endpoints.flow ?? endpoints.platform;
  const request = api.request;
  if (!request || !listEndpoint) {
    throw new Error('Open or refresh the Power Automate Run history page to connect.');
  }
  const loadDetail = createDetailLoader(request, endpoints, signal);
  const outputDetails = new Map<string, Promise<RunRecord>>();

  return {
    async list(): Promise<RecentRun[]> {
      const url = new URL(listEndpoint.url.href);
      url.searchParams.set('api-version', listEndpoint.version);
      url.searchParams.set('$top', '10');
      const page = await apiGet<Page<RunRecord>>(request, listEndpoint.audience, url, signal);
      if (!Array.isArray(page?.value)) throw new Error('Power Automate returned an invalid history page.');

      const runs = new Map<string, RecentRun>();
      for (const run of page.value) {
        if (typeof run?.name !== 'string' || !SAFE_SEGMENT.test(run.name) || !run.properties || runs.has(run.name)) continue;
        runs.set(run.name, {
          name: run.name,
          isMigrationSource: run.isMigrationSource === true,
          status: readText(run.properties.status),
          startTime: readText(run.properties.startTime),
          endTime: readText(run.properties.endTime),
          error: errorText(run.properties),
        });
      }
      return Array.from(runs.values()).sort((a, b) => startTime(b.startTime) - startTime(a.startTime)).slice(0, 10);
    },

    async detail(run: RecentRun): Promise<RecentRunDetail> {
      const { properties } = await loadDetail(run, ['properties/actions'], false);
      const summarizeStep = (name: string, step: StepProperties, kind: RecentStep['kind']): RecentStep => {
        const duration = Date.parse(step.endTime ?? '') - Date.parse(step.startTime ?? '');
        return { name, kind, status: readText(step.status), startTime: readText(step.startTime), error: errorText(step),
          durationMs: Number.isFinite(duration) && duration >= 0 ? duration : undefined };
      };
      const steps = Object.entries(properties.actions ?? {}).filter(([, step]) => step)
        .map(([name, step]) => summarizeStep(name, step, 'action'))
        .sort((a, b) => (startTime(a.startTime) || Infinity) - (startTime(b.startTime) || Infinity));
      const { trigger } = properties;
      if (trigger) steps.unshift(summarizeStep(readText(trigger.name) ?? 'Trigger', trigger, 'trigger'));
      return { error: errorText(properties) ?? run.error, steps };
    },

    async output(run: RecentRun, step: RecentStep): Promise<RunOutput> {
      let pending = outputDetails.get(run.name);
      if (!pending) {
        pending = loadDetail(run, ['properties/actions', 'properties.isSelfHosted', 'properties/contents'], false)
          .catch(error => { outputDetails.delete(run.name); throw error; });
        outputDetails.set(run.name, pending);
      }
      const { properties } = await pending;
      const result = step.kind === 'trigger' ? properties.trigger : Object.prototype.hasOwnProperty.call(properties.actions ?? {}, step.name)
        ? properties.actions?.[step.name] : undefined;
      if (result?.outputsLink?.secureData) return { status: 'secured' };
      if (result?.outputs !== undefined) return { status: 'available', value: result.outputs };
      if (result?.outputsLink?.uri) return { status: 'available', value: await fetchRunPayload(result.outputsLink.uri, signal) };
      return { status: 'unavailable' };
    },
  };
}

export function createRunHistoryClient(api: RunHistoryApi, target: RunTarget, signal: AbortSignal) {
  const { flow, platform } = getRunEndpoints(api, target);
  const request = api.request;
  if (!request || !flow) {
    throw new Error('Open or refresh the Power Automate Run history page to connect.');
  }
  const loadDetail = createDetailLoader(request, { flow, platform }, signal);

  return {
    async getFlowName() {
      const url = new URL(flow.url.pathname.slice(0, -'/runs'.length), flow.url);
      url.searchParams.set('api-version', flow.version);
      const result = await apiGet<RunProperties['flow']>(request, flow.audience, url, signal);
      return result?.properties?.displayName;
    },

    async list(range: RunRange, onPage: (scanned: number, matched: number) => void) {
      const runs = new Map<string, RunRecord>();
      let scanned = 0;
      for await (const rows of pages<RunRecord>(request, flow, signal)) {
        for (const run of rows) {
          const started = Date.parse(run?.properties?.startTime ?? '');
          if (!Number.isFinite(started) || !SAFE_SEGMENT.test(run?.name ?? '')) {
            throw new Error('Power Automate returned a run with a missing or invalid ID or start time.');
          }
          if (started >= range.start && started < range.endExclusive && !runs.has(run.name)) {
            runs.set(run.name, run);
          }
        }
        scanned += rows.length;
        onPage(scanned, runs.size);
      }
      return Array.from(runs.values()).sort((a, b) =>
        Date.parse(b.properties.startTime!) - Date.parse(a.properties.startTime!));
    },

    async detail(run: RunRecord, includePayloads: boolean) {
      const expansions = ['properties/actions', 'properties/flow'];
      if (includePayloads) expansions.push('properties.isSelfHosted', 'properties/contents');
      return loadDetail(run, expansions, true);
    },

    async repetitions(run: RunRecord, actionName: string, scope: boolean) {
      if (!actionName || actionName === '.' || actionName === '..') throw new Error('Invalid action name.');
      // The maker's repetition service uses the regional Flow API and the run path.
      const path = `${flow.url.pathname}/${encodeURIComponent(run.name)}/actions/${encodeURIComponent(actionName)}/`;
      const url = new URL(path + (scope ? 'scopeRepetitions' : 'repetitions'), flow.url);
      if (run.isMigrationSource) url.searchParams.set('isMigrationSource', 'true');
      const repetitions: StepProperties[] = [];
      for await (const rows of pages<{ properties?: StepProperties }>(request, { ...flow, url }, signal)) {
        for (const row of rows) {
          if (!row?.properties) throw new Error('Power Automate returned an invalid iteration.');
          repetitions.push(row.properties);
        }
      }
      return repetitions;
    },
  };
}
