/**
 * Save and publish solution-aware cloud flows directly through the Dataverse
 * Web API (`workflows` table), as an alternative to the Flow API PATCH.
 *
 * NOT VERIFIED AGAINST A LIVE TENANT. Request shapes follow the public
 * Dataverse Web API documentation (OData v4 conditional PATCH with If-Match,
 * the `PublishXml` unbound action, the solution-aware `clientdata` format of
 * the workflow row). Unit tests cover the request construction only. Callers
 * should keep the Flow API save path as the fallback, and must fall back when
 * `MissingConnectionReferenceError` is thrown.
 *
 * Not wired into the editor UI yet.
 */
import { ApiError, ApiRawResponse, ApiRequest } from './ApiProvider';

/** Minimal surface needed from ApiProvider (`useApiProviderContext().request`). */
export interface DataverseRequester {
    request<T = any>(req: ApiRequest): Promise<T>;
}

export interface DataverseWorkflow {
    workflowid: string;
    name?: string;
    statecode?: number;
    modifiedon?: string;
    /** Raw JSON string stored by Dataverse. */
    clientdata?: string;
    /** Parsed `clientdata` (undefined when empty or not JSON). */
    clientdataParsed?: any;
    /** OData ETag (`@odata.etag`), e.g. W/"1234567". */
    etag?: string;
}

/** Connection reference in the solution-aware (Dataverse clientdata) shape. */
export interface DataverseConnectionReference {
    api: { name: string };
    connection: { connectionReferenceLogicalName: string };
    runtimeSource: 'embedded' | 'invoker';
}

export type DataverseConnectionReferences = Record<string, DataverseConnectionReference>;

export interface SaveDraftInput {
    workflowEntityId: string;
    definition: any;
    /** Flow API shape or Dataverse shape; converted with toDataverseConnectionReferences. */
    connectionReferences?: Record<string, any>;
    displayName?: string;
    /** Informational only — the org URL already scopes the request to one environment. */
    environmentName?: string;
    /** `@odata.etag` from getWorkflow. Fetched first when missing (never `*`). */
    etag?: string;
}

export class DataverseFlowError extends Error {
    readonly status?: number;
    readonly code?: string;
    readonly requestIds?: ApiError['requestIds'];
    readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'DataverseFlowError';
        if (cause instanceof ApiError) {
            this.status = cause.status;
            this.code = cause.code;
            this.requestIds = cause.requestIds;
        }
        this.cause = cause;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** 412 Precondition Failed: the row changed since it was read. */
export class ConflictError extends DataverseFlowError {
    constructor(cause?: unknown) {
        super('The flow was changed elsewhere since it was loaded. Reload it and re-apply your edits.', cause);
        this.name = 'ConflictError';
    }
}

/**
 * A connection reference has no `connectionReferenceLogicalName`, so it cannot
 * be expressed in the solution-aware shape. Fall back to the Flow API save.
 */
export class MissingConnectionReferenceError extends DataverseFlowError {
    readonly referenceKeys: string[];

    constructor(referenceKeys: string[]) {
        super(`Connection reference(s) without a logical name: ${referenceKeys.join(', ')}. Save through the Flow API instead.`);
        this.name = 'MissingConnectionReferenceError';
        this.referenceKeys = referenceKeys;
    }
}

const GUID_RE = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i;

export function normalizeWorkflowId(id: string): string {
    const m = GUID_RE.exec((id || '').trim());
    if (!m) throw new DataverseFlowError(`Invalid Dataverse workflow id: ${id}`);
    return m[1].toLowerCase();
}

function apiNameFromReference(key: string, ref: any): string | undefined {
    const fromApi = ref?.api?.name;
    if (typeof fromApi === 'string' && fromApi) return fromApi;
    const id: string | undefined = ref?.id || ref?.apiId || ref?.api?.id;
    if (typeof id === 'string' && id.includes('/apis/')) {
        return id.split('/apis/')[1].split('/')[0];
    }
    if (typeof ref?.apiName === 'string' && ref.apiName) {
        return ref.apiName.startsWith('shared_') ? ref.apiName : `shared_${ref.apiName}`;
    }
    // Keys look like shared_office365 or shared_office365_1
    if (key.startsWith('shared_')) return key.replace(/_\d+$/, '');
    return undefined;
}

function runtimeSourceOf(ref: any): 'embedded' | 'invoker' {
    const raw = String(ref?.runtimeSource ?? ref?.source ?? 'embedded').toLowerCase();
    return raw === 'invoker' ? 'invoker' : 'embedded';
}

/**
 * Flow API connectionReferences → Dataverse clientdata shape.
 *
 *   Flow API:  { shared_x: { connectionName, source: 'Invoker'|'Embedded', id: '/providers/Microsoft.PowerApps/apis/shared_x', connectionReferenceLogicalName? } }
 *   Dataverse: { shared_x: { api: { name: 'shared_x' }, connection: { connectionReferenceLogicalName }, runtimeSource: 'embedded'|'invoker' } }
 *
 * Throws MissingConnectionReferenceError listing every reference without a
 * logical name (non-solution connections cannot be saved this way).
 */
export function toDataverseConnectionReferences(refs: Record<string, any> | undefined | null): DataverseConnectionReferences {
    const out: DataverseConnectionReferences = {};
    const missing: string[] = [];
    Object.keys(refs || {}).forEach((key) => {
        const ref = refs![key] || {};
        const logicalName: unknown = ref.connection?.connectionReferenceLogicalName ?? ref.connectionReferenceLogicalName;
        const apiName = apiNameFromReference(key, ref);
        if (typeof logicalName !== 'string' || !logicalName.trim() || !apiName) {
            missing.push(key);
            return;
        }
        out[key] = {
            api: { name: apiName },
            connection: { connectionReferenceLogicalName: logicalName.trim() },
            runtimeSource: runtimeSourceOf(ref),
        };
    });
    if (missing.length) throw new MissingConnectionReferenceError(missing);
    return out;
}

/** The `clientdata` string Dataverse stores for a modern cloud flow. */
export function buildClientData(definition: any, connectionReferences: DataverseConnectionReferences, displayName?: string): string {
    const properties: Record<string, any> = { connectionReferences, definition };
    if (displayName) properties.displayName = displayName;
    return JSON.stringify({ properties, schemaVersion: '1.0.0.0' });
}

/** ParameterXml for the PublishXml action, e.g. <importexportxml><workflows><workflow>{id}</workflow></workflows></importexportxml> */
export function buildPublishXml(workflowEntityId: string): string {
    return `<importexportxml><workflows><workflow>{${normalizeWorkflowId(workflowEntityId)}}</workflow></workflows></importexportxml>`;
}

const ODATA_HEADERS = {
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    Accept: 'application/json',
};

function isRetryable(error: unknown): boolean {
    return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}

export interface DataverseFlowServiceOptions {
    sleep?: (ms: number) => Promise<void>;
    publishRetryDelayMs?: number;
}

export class DataverseFlowService {
    private sleep: (ms: number) => Promise<void>;
    private publishRetryDelayMs: number;

    constructor(private http: DataverseRequester, options: DataverseFlowServiceOptions = {}) {
        this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.publishRetryDelayMs = options.publishRetryDelayMs ?? 2000;
    }

    async getWorkflow(id: string): Promise<DataverseWorkflow> {
        const workflowId = normalizeWorkflowId(id);
        let body: any;
        try {
            body = await this.http.request({
                method: 'GET',
                audience: 'dataverse',
                url: `workflows(${workflowId})?$select=clientdata,name,statecode,modifiedon`,
                apiVersion: false,
                headers: { ...ODATA_HEADERS },
            });
        } catch (error) {
            throw this.wrap(error, 'Could not read the flow from Dataverse');
        }
        let clientdataParsed: any;
        if (typeof body?.clientdata === 'string' && body.clientdata) {
            try {
                clientdataParsed = JSON.parse(body.clientdata);
            } catch {
                clientdataParsed = undefined;
            }
        }
        return {
            workflowid: body?.workflowid || workflowId,
            name: body?.name,
            statecode: body?.statecode,
            modifiedon: body?.modifiedon,
            clientdata: body?.clientdata,
            clientdataParsed,
            etag: body?.['@odata.etag'],
        };
    }

    /**
     * PATCH the workflow row's clientdata with optimistic concurrency.
     * Returns the new ETag when Dataverse reports one.
     */
    async saveDraft(input: SaveDraftInput): Promise<{ etag?: string }> {
        const workflowId = normalizeWorkflowId(input.workflowEntityId);
        // Convert before any network call so an unsupported flow fails fast.
        const connectionReferences = toDataverseConnectionReferences(input.connectionReferences || {});
        if (!input.definition || typeof input.definition !== 'object') {
            throw new DataverseFlowError('A flow definition object is required.');
        }

        let etag = input.etag;
        if (!etag) {
            etag = (await this.getWorkflow(workflowId)).etag;
        }
        if (!etag) {
            // Never fall back to If-Match: * — that would silently overwrite concurrent edits.
            throw new DataverseFlowError('Dataverse did not return an ETag for the flow; refusing to save without concurrency protection.');
        }

        const clientdata = buildClientData(input.definition, connectionReferences, input.displayName);
        let response: ApiRawResponse;
        try {
            response = await this.http.request<ApiRawResponse>({
                method: 'PATCH',
                audience: 'dataverse',
                url: `workflows(${workflowId})`,
                apiVersion: false,
                retries: 0, // a retried write after an ambiguous 5xx would surface as a bogus 412
                raw: true,
                headers: {
                    ...ODATA_HEADERS,
                    'Content-Type': 'application/json',
                    'If-Match': etag,
                    'MSCRM.AsUnpublished': 'true',
                },
                body: { clientdata },
            });
        } catch (error) {
            throw this.wrap(error, 'Could not save the flow to Dataverse');
        }
        const newEtag = response?.headers?.etag || response?.body?.['@odata.etag'];
        return { etag: newEtag || undefined };
    }

    /** Run the PublishXml action for the workflow; retries once on 429/5xx. */
    async publish(workflowEntityId: string): Promise<void> {
        const req: ApiRequest = {
            method: 'POST',
            audience: 'dataverse',
            url: 'PublishXml',
            apiVersion: false,
            retries: 0, // retry policy owned here: exactly one retry
            headers: { ...ODATA_HEADERS, 'Content-Type': 'application/json' },
            body: { ParameterXml: buildPublishXml(workflowEntityId) },
        };
        try {
            await this.http.request(req);
        } catch (error) {
            if (!isRetryable(error)) throw this.wrap(error, 'Could not publish the flow');
            await this.sleep(this.publishRetryDelayMs);
            try {
                await this.http.request(req);
            } catch (retryError) {
                throw this.wrap(retryError, 'Could not publish the flow');
            }
        }
    }

    private wrap(error: unknown, prefix: string): Error {
        if (error instanceof DataverseFlowError) return error;
        if (error instanceof ApiError && error.status === 412) return new ConflictError(error);
        const message = error instanceof Error ? error.message : String(error);
        return new DataverseFlowError(`${prefix}: ${message}`, error);
    }
}
