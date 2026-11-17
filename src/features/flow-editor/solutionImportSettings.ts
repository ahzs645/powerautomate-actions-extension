import { classifyApiUrl } from '../../chrome/hosts';
import type { IApiProvider } from '../../services/ApiProvider';
import { jsonObject } from './flowConnections';
import { deploymentSettings } from './managedSolutionExport';
import type { SolutionPackageReview } from './solutionPackageReview';

export interface TargetConnection {
  id: string;
  label: string;
  connector: string;
}

export function connectorKey(value: string) {
  return (/(?:^|\/)apis\/([^/]+)(?:\/|$)/i.exec(value)?.[1] ?? value).toLowerCase();
}

export const validConnectionId = (value: string) => /^[a-z\d][a-z\d._-]*$/i.test(value);

export async function listTargetConnections(api: Pick<IApiProvider, 'request' | 'endpoints'>, envId: string, signal: AbortSignal) {
  const endpoint = api.endpoints?.powerPlatformApiUrl && classifyApiUrl(api.endpoints.powerPlatformApiUrl);
  if (!api.request || !endpoint || endpoint.audience !== 'powerPlatform' || !endpoint.host.endsWith('.com')) {
    throw new Error('A Power Platform connection list is unavailable for this session. You can enter a target connection ID manually.');
  }
  const source = new URL(`https://api.powerplatform.com/connectivity/environments/${encodeURIComponent(envId)}/connections?api-version=2024-10-01`);
  const result = new Map<string, TargetConnection>();
  const seen = new Set<string>();
  let current = source;
  while (!seen.has(current.href)) {
    seen.add(current.href);
    const response: { value?: unknown[]; nextLink?: string; '@odata.nextLink'?: string } = await api.request({
      method: 'GET', url: current.href, absolute: true, audience: 'powerPlatform', redirect: 'error', signal,
    });
    if (!Array.isArray(response?.value)) throw new Error('Power Platform returned an invalid connection list.');
    for (const value of response.value) {
      const row = jsonObject(value);
      const properties = jsonObject(row?.properties);
      const serviceId = typeof row?.id === 'string' ? row.id : '';
      const id = typeof row?.name === 'string' && validConnectionId(row.name) ? row.name : serviceId.split('/').pop() ?? '';
      const connector = properties?.apiId ?? properties?.apiid ?? jsonObject(properties?.api)?.id ?? properties?.connectorId ??
        /(?:^|\/)apis\/([^/]+)\/connections\//i.exec(serviceId)?.[1];
      if (!validConnectionId(id) || typeof connector !== 'string' || !connector) continue;
      result.set(`${connectorKey(connector)}:${id}`, { id, connector: connectorKey(connector),
        label: typeof properties?.displayName === 'string' ? properties.displayName : id });
    }
    const next = response.nextLink ?? response['@odata.nextLink'];
    if (!next) return Array.from(result.values()).sort((a, b) => a.label.localeCompare(b.label));
    current = new URL(next, current);
    if (current.origin !== source.origin || current.pathname !== source.pathname || current.username || current.password || current.hash) {
      throw new Error('Power Platform returned a page outside the target environment connection list.');
    }
  }
  throw new Error('Power Platform returned a repeated connection page.');
}

export function fillDeploymentSettings(review: SolutionPackageReview, connections: ReadonlyMap<string, string>, variables: ReadonlyMap<string, string>) {
  const template = deploymentSettings(review);
  return {
    ConnectionReferences: template.ConnectionReferences.map(reference => {
      const connectionId = connections.get(reference.LogicalName)?.trim() ?? '';
      return { ...reference, ConnectionId: validConnectionId(connectionId) ? connectionId : '' };
    }),
    EnvironmentVariables: template.EnvironmentVariables.map(setting => ({ ...setting, Value: variables.get(setting.SchemaName) ?? '' })),
  };
}
