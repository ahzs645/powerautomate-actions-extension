import { classifyApiUrl } from '../../chrome/hosts';
import type { ApiRequest, IApiProvider } from '../../services/ApiProvider';
import { normalizeWorkflowId } from '../../services/DataverseFlowService';
import { reviewSolutionPackage, SolutionPackageReview } from './solutionPackageReview';

type Request = NonNullable<IApiProvider['request']>;

export interface ExportableSolution {
  uniqueName: string;
  label: string;
  version: string;
}

interface SolutionMembershipPage {
  value: Array<{ solutionid?: {
    friendlyname?: string;
    uniquename?: string;
    version?: string;
    ismanaged?: boolean;
    isvisible?: boolean;
  } }>;
  '@odata.nextLink'?: string;
}

export interface PreparedSolution {
  bytes: Uint8Array;
  review: SolutionPackageReview;
}

const headers = { 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' };
const initialWaitMs = 2_000;
const jobTimeoutMs = 10 * 60_000;

function dataverseRequest<T>(request: Request, signal: AbortSignal, options: Pick<ApiRequest, 'method' | 'url' | 'body' | 'absolute' | 'retries'>) {
  return request<T>({ audience: 'dataverse', apiVersion: false, headers, signal, redirect: 'error', ...options });
}

export async function verifyDataverseEnvironment(request: Request, baseUrl: string, envId: string, signal: AbortSignal) {
  const endpoint = classifyApiUrl(baseUrl);
  if (endpoint?.audience !== 'dataverse') throw new Error('Connect to Dataverse in the flow’s environment to export a solution.');
  const organizationUrl = new URL('RetrieveCurrentOrganization(AccessType=@p1)', endpoint.baseUrl);
  organizationUrl.searchParams.set('@p1', "Microsoft.Dynamics.CRM.EndpointAccessType'Default'");
  const organization = await dataverseRequest<{ Detail?: { EnvironmentId?: string } }>(request, signal,
    { method: 'GET', url: organizationUrl.href, absolute: true });
  if (organization?.Detail?.EnvironmentId?.toLowerCase() !== envId.toLowerCase()) {
    throw new Error('Dataverse is connected to a different environment or did not return its environment ID. Reconnect from this flow.');
  }
  return endpoint.baseUrl;
}

export async function listExportableSolutions(request: Request, baseUrl: string, envId: string, workflowId: string, signal: AbortSignal) {
  const verifiedBase = await verifyDataverseEnvironment(request, baseUrl, envId, signal);
  const source = new URL('solutioncomponents', verifiedBase);
  const query = new URLSearchParams({
    '$select': 'objectid',
    '$filter': `objectid eq ${normalizeWorkflowId(workflowId)} and componenttype eq 29`,
    '$expand': 'solutionid($select=friendlyname,uniquename,version,ismanaged,isvisible)',
  });
  const solutions = new Map<string, ExportableSolution>();
  const visited = new Set<string>();
  let url = new URL(`${source.href}?${query}`);
  while (true) {
    if (visited.has(url.href)) throw new Error('Dataverse returned a repeated solution page.');
    visited.add(url.href);
    const page = await dataverseRequest<SolutionMembershipPage>(request, signal, { method: 'GET', url: url.href, absolute: true });
    if (!Array.isArray(page?.value)) throw new Error('Dataverse returned an unreadable solution list.');
    for (const { solutionid } of page.value) {
      const name = solutionid?.uniquename;
      if (!name || /^(active|default)$/i.test(name) || solutionid.ismanaged !== false || solutionid.isvisible !== true) continue;
      solutions.set(name.toLowerCase(), { uniqueName: name, label: solutionid.friendlyname || name, version: solutionid.version || '' });
    }
    const next = page['@odata.nextLink'];
    if (!next) break;
    url = new URL(next, url);
    if (url.origin !== source.origin || url.pathname !== source.pathname || url.username || url.password || url.hash) {
      throw new Error('Dataverse returned a solution page outside the requested resource.');
    }
  }
  return Array.from(solutions.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function prepareManagedSolution(request: Request, solution: ExportableSolution, workflowId: string, signal: AbortSignal): Promise<PreparedSolution> {
  const expectedFlow = normalizeWorkflowId(workflowId);
  const job = await dataverseRequest<{ AsyncOperationId: string; ExportJobId: string }>(request, signal, {
    method: 'POST', url: 'ExportSolutionAsync', body: { SolutionName: solution.uniqueName, Managed: true }, retries: 0,
  });
  const operationId = normalizeWorkflowId(job?.AsyncOperationId || '');
  const jobId = normalizeWorkflowId(job?.ExportJobId || '');
  const deadline = Date.now() + jobTimeoutMs;
  let delay = initialWaitMs;
  while (true) {
    const status = await dataverseRequest<{ statecode?: number; statuscode?: number }>(request, signal, {
      method: 'GET', url: `asyncoperations(${operationId})?$select=statecode,statuscode`,
    });
    if (status?.statecode === 3) {
      if (status.statuscode !== 30) throw new Error('Dataverse did not complete the export. Check the solution export job in Power Platform.');
      break;
    }
    if (Date.now() >= deadline) throw new Error('Dataverse is still preparing the export. Check the solution export job in Power Platform.');
    await wait(delay, signal);
    delay = Math.min(delay * 2, 10_000);
  }
  const result = await dataverseRequest<{ ExportSolutionFile?: string }>(request, signal, {
    method: 'POST', url: 'DownloadSolutionExportData', body: { ExportJobId: jobId },
  });
  if (!result?.ExportSolutionFile) throw new Error('Dataverse did not return a solution ZIP.');
  const bytes = Uint8Array.from(atob(result.ExportSolutionFile), character => character.charCodeAt(0));
  const review = await reviewSolutionPackage(bytes);
  if (!review.managed || review.uniqueName.toLowerCase() !== solution.uniqueName.toLowerCase()) {
    throw new Error('The returned ZIP does not match the requested managed solution.');
  }
  if (!review.flows.some(flow => flow.id === expectedFlow)) {
    throw new Error('The returned ZIP does not contain this cloud flow. Check its solution membership before exporting.');
  }
  return { bytes, review };
}

export function deploymentSettings(review: SolutionPackageReview) {
  return {
    EnvironmentVariables: review.environmentVariables.map(variable => ({ SchemaName: variable.name, Value: '' })),
    ConnectionReferences: review.connections.filter(reference => reference.included && reference.connectorId).map(reference => ({
      LogicalName: reference.name, ConnectionId: '', ConnectorId: reference.connectorId,
    })),
  };
}
