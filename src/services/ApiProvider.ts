import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { FlowEditorActions, TokenAudience } from './interfaces/IFlowEditorActions';
import type { DiagnosticRequestIds } from './Diagnostics';

/** Which captured token/base URL a request should use. 'primary' = apiUrl/token. */
export type ApiAudience = 'primary' | TokenAudience;

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path relative to the audience's base URL, or an absolute URL with `absolute: true`. */
  url: string;
  audience?: ApiAudience;
  /** Override the base URL (otherwise taken from the audience). */
  baseUrl?: string;
  /** Override the Authorization header value (otherwise taken from the audience). */
  token?: string;
  headers?: Record<string, string>;
  body?: any;
  /**
   * api-version query parameter. Defaults to '1' for Power Platform hosts and
   * '2016-11-01' for Flow/Power Apps hosts; `false` sends none (Dataverse —
   * the default for the 'dataverse' audience).
   */
  apiVersion?: string | false;
  /** `url` is already fully qualified (paging nextLinks); never rewritten. */
  absolute?: boolean;
  /** Retries for 429/5xx/network errors (default 3). */
  retries?: number;
  /** Resolve with status, headers and request ids instead of just the body. */
  raw?: boolean;
}

export interface ApiRawResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
  requestIds: DiagnosticRequestIds;
}

export interface IApiProvider {
  get(url: string): Promise<any>;
  /**
   * GET a fully-qualified URL as returned by the API itself (paging `nextLink`s
   * already carry their own host and api-version, so they must not be rewritten).
   */
  getAbsolute(url: string): Promise<any>;
  patch(url: string, data: any): Promise<any>;
  post(url: string, data: any): Promise<any>;
  isApiReady: boolean;
  isPowerPlatformApi: boolean;
  /** Generic request: other audience/base URL/token, custom headers, optional api-version. */
  request?: <T = any>(req: ApiRequest) => Promise<T>;
  /** Snapshot of the captured endpoints (tokens are not exposed here). */
  endpoints?: IApiEndpoints;
  /** Tell the background the Dataverse workflow id of the open flow (from flow GET properties.workflowEntityId). */
  setWorkflowEntityId?: (workflowEntityId: string, flowId?: string) => void;
  /** Sanitised diagnostics text for "Copy diagnostics". */
  getDiagnostics?: () => Promise<string>;
}

export interface IApiEndpoints {
  apiUrl?: string;
  legacyApiUrl?: string;
  powerPlatformApiUrl?: string;
  dataverseApiUrl?: string;
  hasDataverse: boolean;
  workflowEntityId?: string;
  expiresAt?: Partial<Record<TokenAudience, number>>;
}

export interface IApiDetails {
  apiUrl?: string;
  token?: string;
  isReady: boolean;
  /** Flow (ProcessSimple) API — api.flow.microsoft.com and regional/gov variants. */
  legacyApiUrl?: string;
  legacyToken?: string;
  /** Power Platform API (*.api.powerplatform.com /powerautomate/). */
  powerPlatformApiUrl?: string;
  powerPlatformToken?: string;
  /** Dataverse Web API root, e.g. https://org.crm.dynamics.com/api/data/v9.2/ */
  dataverseApiUrl?: string;
  dataverseToken?: string;
  workflowEntityId?: string;
  expiresAt?: Partial<Record<TokenAudience, number>>;
}

/** Error thrown for every non-2xx response. `message` keeps the historical wording. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestIds: DiagnosticRequestIds;
  readonly body?: any;

  constructor(message: string, status: number, code?: string, requestIds: DiagnosticRequestIds = {}, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestIds = requestIds;
    this.body = body;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export interface ApiDiagnosticEvent {
  kind: 'api';
  method: string;
  host?: string;
  status?: number;
  audience: ApiAudience;
  durationMs: number;
  requestIds?: DiagnosticRequestIds;
  flags?: Record<string, boolean>;
  detail?: string;
}

export interface ApiClientOptions {
  getDetails: () => IApiDetails;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onDiagnostic?: (event: ApiDiagnosticEvent) => void;
  /** Base delay for linear backoff (default 1000ms). */
  retryDelayMs?: number;
}

export interface ApiClient {
  request<T = any>(req: ApiRequest): Promise<T>;
  get(url: string): Promise<any>;
  getAbsolute(url: string): Promise<any>;
  patch(url: string, data: any): Promise<any>;
  post(url: string, data: any): Promise<any>;
}

const DEBUG = true;

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[PA-Toolkit API]', ...args);
  }
}

function debugError(...args: any[]) {
  if (DEBUG) {
    console.error('[PA-Toolkit API Error]', ...args);
  }
}

function newClientRequestId(): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Request ids Microsoft APIs return; quoted in support tickets. */
export function parseRequestIds(headers: { get(name: string): string | null } | undefined): DiagnosticRequestIds {
  if (!headers) return {};
  const ids: DiagnosticRequestIds = {};
  const svc = headers.get('x-ms-service-request-id') || headers.get('req_id');
  const corr = headers.get('x-ms-correlation-request-id');
  const client = headers.get('x-ms-client-request-id');
  if (svc) ids.serviceRequestId = svc.split(',')[0].trim();
  if (corr) ids.correlationRequestId = corr.trim();
  if (client) ids.clientRequestId = client.trim();
  return ids;
}

function resolveTarget(details: IApiDetails, audience: ApiAudience): { baseUrl?: string; token?: string } {
  switch (audience) {
    case 'flow':
      return { baseUrl: details.legacyApiUrl, token: details.legacyToken };
    case 'powerPlatform':
      return { baseUrl: details.powerPlatformApiUrl, token: details.powerPlatformToken };
    case 'dataverse':
      return { baseUrl: details.dataverseApiUrl, token: details.dataverseToken };
    case 'powerApps':
    case 'primary':
    default:
      return { baseUrl: details.apiUrl, token: details.token };
  }
}

function joinUrl(base: string, path: string): string {
  if (!base.endsWith('/') && !path.startsWith('/')) return `${base}/${path}`;
  if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1);
  return base + path;
}

function hostOfUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Framework-free HTTP client (unit testable). The React provider below wraps
 * it with the token received from the background worker.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl || ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelay = options.retryDelayMs ?? 1000;

  const report = (event: ApiDiagnosticEvent) => {
    try {
      options.onDiagnostic?.(event);
    } catch {
      // diagnostics must never break a request
    }
  };

  async function send(req: ApiRequest, attempt: number): Promise<any> {
    const details = options.getDetails();
    const audience: ApiAudience = req.audience || 'primary';
    const target = resolveTarget(details, audience);
    const baseUrl = req.baseUrl ?? target.baseUrl;
    const token = req.token ?? target.token;
    const maxRetries = req.retries ?? 3;

    if (!token || (!req.absolute && !baseUrl)) {
      throw new Error(audience === 'primary' || audience === 'powerApps'
        ? 'API not ready - missing URL or token'
        : `API not ready - no ${audience} token captured yet. Refresh the Power Automate page and try again.`);
    }

    let fullUrl: string;
    if (req.absolute) {
      fullUrl = req.url;
    } else {
      const endpointUrl = joinUrl(baseUrl!, req.url);
      // Power Platform environment APIs use api-version=1;
      // legacy powerapps/flow APIs use api-version=2016-11-01; Dataverse uses none.
      let apiVersion: string | false;
      if (req.apiVersion !== undefined) {
        apiVersion = req.apiVersion;
      } else if (audience === 'dataverse') {
        apiVersion = false;
      } else {
        apiVersion = baseUrl!.includes('.api.powerplatform.com') ? '1' : '2016-11-01';
      }
      fullUrl = apiVersion
        ? endpointUrl + (endpointUrl.includes('?') ? `&api-version=${apiVersion}` : `?api-version=${apiVersion}`)
        : endpointUrl;
    }

    const clientRequestId = newClientRequestId();
    const headers: Record<string, string> = {
      authorization: token,
      'Content-Type': 'application/json',
      'x-ms-client-request-id': clientRequestId,
      ...(req.headers || {}),
    };

    debugLog(`${req.method} request to:`, fullUrl.split('?')[0]);

    const started = Date.now();
    const host = hostOfUrl(fullUrl);
    const retryOrThrow = async (status: number | undefined, delayMs: number, error: Error, requestIds?: DiagnosticRequestIds) => {
      report({ kind: 'api', method: req.method, host, status, audience, durationMs: Date.now() - started, requestIds, flags: { hasToken: true, retried: attempt < maxRetries }, detail: (error as ApiError).code || undefined });
      if (attempt < maxRetries) {
        debugLog(`Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delayMs);
        return send(req, attempt + 1);
      }
      throw error;
    };

    let response: Response;
    try {
      response = await fetchImpl(fullUrl, {
        method: req.method,
        body: req.body !== undefined && req.body !== null ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
        headers,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        debugError('Network error:', error);
        return retryOrThrow(undefined, retryDelay * (attempt + 1), new Error('Network error. Please check your connection and try again.'), { clientRequestId });
      }
      debugError('Unexpected error:', error);
      throw new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }

    debugLog(`Response status: ${response.status} ${response.statusText}`);
    const requestIds = parseRequestIds(response.headers);
    if (!requestIds.clientRequestId) requestIds.clientRequestId = clientRequestId;

    let body: any;
    try {
      const contentType = response.headers?.get('content-type');
      if (contentType && contentType.includes('json')) {
        const text = await response.text();
        body = text ? JSON.parse(text) : {};
      } else {
        const text = await response.text();
        body = text ? { message: text } : {};
      }
    } catch {
      body = {};
    }

    if (response.ok) {
      report({ kind: 'api', method: req.method, host, status: response.status, audience, durationMs: Date.now() - started, requestIds, flags: { hasToken: true } });
      if (req.raw) {
        const headerMap: Record<string, string> = {};
        response.headers?.forEach?.((value: string, key: string) => { headerMap[key.toLowerCase()] = value; });
        return { status: response.status, body, headers: headerMap, requestIds } as ApiRawResponse;
      }
      return body;
    }

    const code: string | undefined = body?.error?.code || undefined;
    const serverMsg: string = body?.error?.message || body?.message || '';
    const fail = (message: string) => new ApiError(message, response.status, code, requestIds, body);

    if (response.status === 429) {
      const retryAfter = Number(response.headers?.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 30 ? retryAfter * 1000 : retryDelay * (attempt + 1);
      return retryOrThrow(429, delay, fail('Too many requests. Please wait a moment and try again.'), requestIds);
    }
    if (response.status >= 500) {
      debugError('Server error:', response.status, code);
      return retryOrThrow(response.status, retryDelay * (attempt + 1), fail(`Server error (${response.status})${serverMsg ? ': ' + serverMsg : '. Please try again later.'}`), requestIds);
    }

    report({ kind: 'api', method: req.method, host, status: response.status, audience, durationMs: Date.now() - started, requestIds, flags: { hasToken: true }, detail: code });

    if (response.status === 401) {
      debugError('Authentication failed - token may be expired');
      throw fail('Authentication failed. Please refresh the Power Automate page and try again.');
    }
    if (response.status === 403) {
      debugError('Access forbidden - insufficient permissions');
      throw fail('Access forbidden. You may not have permission to modify this flow.');
    }
    if (response.status === 404) {
      debugError('Resource not found');
      throw fail('Flow not found. It may have been deleted or moved.');
    }
    const errorMessage = serverMsg || `HTTP ${response.status}: ${response.statusText}`;
    debugError('API error:', response.status, code);
    throw fail(errorMessage);
  }

  const request = <T = any>(req: ApiRequest): Promise<T> => send(req, 0);

  return {
    request,
    get: (url: string) => request({ method: 'GET', url }),
    getAbsolute: (url: string) => request({ method: 'GET', url, absolute: true }),
    patch: (url: string, data: any) => request({ method: 'PATCH', url, body: data }),
    post: (url: string, data: any) => request({ method: 'POST', url, body: data }),
  };
}

export const ApiProviderContext = createContext<IApiProvider>({} as any);

function sendRuntimeMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(response);
      });
    } catch {
      resolve(undefined);
    }
  });
}

export const ApiProviderContextRoot = (): IApiProvider => {
  const [apiDetails, setApiDetails] = useState<IApiDetails>({ isReady: false });

  const client = useMemo(
    () => createApiClient({
      getDetails: () => apiDetails,
      onDiagnostic: (event) => {
        // Background re-sanitises; only host/status/ids leave this page.
        sendRuntimeMessage({ type: 'diagnostics-event', event });
      },
    }),
    [apiDetails]
  );

  useEffect(() => {
    const cb = (action: FlowEditorActions, sender: any, sendResponse: () => void) => {
      // Only handle token-changed messages; ignore others
      // (check-flow-page, open-flow-editor, etc. are meant for the background)
      if (action.type !== 'token-changed') {
        sendResponse();
        return;
      }

      debugLog('Token updated, API ready:', Boolean(action.apiUrl && action.token),
        'dataverse:', Boolean(action.dataverseApiUrl && action.dataverseToken));
      setApiDetails({
        apiUrl: action.apiUrl,
        token: action.token,
        isReady: Boolean(action.apiUrl && action.token),
        legacyApiUrl: action.legacyApiUrl,
        legacyToken: action.legacyToken,
        powerPlatformApiUrl: action.powerPlatformApiUrl,
        powerPlatformToken: action.powerPlatformToken,
        dataverseApiUrl: action.dataverseApiUrl,
        dataverseToken: action.dataverseToken,
        workflowEntityId: action.workflowEntityId,
        expiresAt: action.expiresAt,
      });
      sendResponse();
    };

    chrome.runtime.onMessage.addListener(cb);

    debugLog('Sending app-loaded message');
    chrome.runtime.sendMessage({ type: 'app-loaded' } as FlowEditorActions, (response) => {
      if (chrome.runtime.lastError) {
        debugError('Failed to send app-loaded message:', chrome.runtime.lastError);
      } else {
        debugLog('App-loaded message sent successfully');
      }
    });

    return () => {
      chrome.runtime.onMessage.removeListener(cb);
    };
  }, []);

  return {
    get: client.get,
    getAbsolute: client.getAbsolute,
    patch: client.patch,
    post: client.post,
    request: client.request,
    isApiReady: apiDetails.isReady,
    isPowerPlatformApi: Boolean(apiDetails.apiUrl?.includes('.api.powerplatform.com')),
    endpoints: {
      apiUrl: apiDetails.apiUrl,
      legacyApiUrl: apiDetails.legacyApiUrl,
      powerPlatformApiUrl: apiDetails.powerPlatformApiUrl,
      dataverseApiUrl: apiDetails.dataverseApiUrl,
      hasDataverse: Boolean(apiDetails.dataverseApiUrl && apiDetails.dataverseToken),
      workflowEntityId: apiDetails.workflowEntityId,
      expiresAt: apiDetails.expiresAt,
    },
    setWorkflowEntityId: (workflowEntityId: string, flowId?: string) => {
      sendRuntimeMessage({ type: 'set-workflow-entity-id', workflowEntityId, flowId } as FlowEditorActions);
    },
    getDiagnostics: async () => {
      const response = await sendRuntimeMessage({ type: 'get-diagnostics' } as FlowEditorActions);
      return typeof response?.text === 'string' ? response.text : 'Diagnostics unavailable (background not reachable).';
    },
  };
};

export const useApiProviderContext = () => useContext(ApiProviderContext);
