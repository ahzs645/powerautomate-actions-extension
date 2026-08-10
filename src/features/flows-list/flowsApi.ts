import { IApiProvider } from '../../services/ApiProvider';

export interface FlowSummary {
  /** The flow GUID (the API returns it as `name`) */
  id: string;
  displayName: string;
  state?: string;
  createdTime?: string;
  lastModifiedTime?: string;
  /** Which listing the flow came from - owned by me, or shared with me */
  scope: 'personal' | 'team' | 'unknown';
}

export interface FlowDefinitionExport {
  $schema: string;
  connectionReferences: Record<string, unknown>;
  definition: unknown;
}

export const EXPORT_SCHEMA = 'https://power-automate-toolkit.local/flow-editor.json#';

/** Guard against a malformed nextLink chain paging forever */
const MAX_PAGES = 25;

interface ListAttempt {
  url: string;
  scope: FlowSummary['scope'];
}

const PAGE_SIZE = 50;

/**
 * Owned flows and flows shared with you come back from two separate `search()`
 * filters - exactly the pair the maker portal itself issues for the flows list.
 */
function searchPair(base: string): ListAttempt[] {
  return [
    { url: `${base}?$filter=${encodeURIComponent("search('personal')")}&$top=${PAGE_SIZE}`, scope: 'personal' },
    { url: `${base}?$filter=${encodeURIComponent("search('team')")}&$top=${PAGE_SIZE}`, scope: 'team' },
  ];
}

/**
 * The listing endpoint differs by host: environment-scoped Power Platform hosts
 * imply the environment in the hostname and serve `powerautomate/flows`, while the
 * legacy Flow API takes the environment in the path. Which host the captured token
 * belongs to is not known ahead of time, so groups are tried in order and the first
 * one that returns flows wins.
 */
export function getFlowListAttempts(envId: string, isPowerPlatform: boolean): ListAttempt[][] {
  const legacyBase = `providers/Microsoft.ProcessSimple/environments/${envId}/flows`;
  const ppBase = 'powerautomate/flows';

  if (isPowerPlatform) {
    return [
      searchPair(ppBase),
      [{ url: `${ppBase}?$top=${PAGE_SIZE}`, scope: 'unknown' }],
      searchPair(legacyBase),
    ];
  }

  return [
    searchPair(legacyBase),
    [{ url: `${legacyBase}?$top=${PAGE_SIZE}`, scope: 'unknown' }],
  ];
}

function toSummary(item: any, scope: FlowSummary['scope']): FlowSummary | null {
  const id = item?.name || item?.properties?.workflowEntityId;
  if (!id) {
    return null;
  }
  return {
    id,
    displayName: item?.properties?.displayName || id,
    state: item?.properties?.state,
    createdTime: item?.properties?.createdTime,
    lastModifiedTime: item?.properties?.lastModifiedTime,
    scope,
  };
}

async function fetchAllPages(api: IApiProvider, url: string, scope: FlowSummary['scope']): Promise<FlowSummary[]> {
  const flows: FlowSummary[] = [];
  let response = await api.get(url);
  let pages = 0;

  while (response) {
    const value = Array.isArray(response?.value) ? response.value : [];
    value.forEach((item: any) => {
      const summary = toSummary(item, scope);
      if (summary) {
        flows.push(summary);
      }
    });

    const nextLink = response?.nextLink || response?.['@odata.nextLink'];
    if (!nextLink || ++pages >= MAX_PAGES) {
      break;
    }
    response = await api.getAbsolute(nextLink);
  }

  return flows;
}

/**
 * List every flow in the environment the caller can see, deduplicated by flow id.
 * A flow shared with you can appear in more than one listing; the first hit wins.
 */
export async function listFlows(
  api: IApiProvider,
  envId: string,
  isPowerPlatform: boolean
): Promise<FlowSummary[]> {
  const groups = getFlowListAttempts(envId, isPowerPlatform);
  const failures: string[] = [];
  let sawEmptySuccess = false;

  for (const group of groups) {
    const results = await Promise.all(
      group.map(async (attempt) => {
        try {
          return await fetchAllPages(api, attempt.url, attempt.scope);
        } catch (error) {
          failures.push(`${attempt.url}: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      })
    );

    const succeeded = results.filter((r): r is FlowSummary[] => r !== null);
    if (succeeded.length === 0) {
      continue;
    }

    const byId = new Map<string, FlowSummary>();
    succeeded.flat().forEach((flow) => {
      if (!byId.has(flow.id)) {
        byId.set(flow.id, flow);
      }
    });

    if (byId.size === 0) {
      // The shape was accepted but held nothing - keep trying the other shapes
      // before concluding the environment is genuinely empty.
      sawEmptySuccess = true;
      continue;
    }

    return Array.from(byId.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }

  if (sawEmptySuccess) {
    return [];
  }

  throw new Error(
    `Could not list flows for this environment.${failures.length ? ' Last error - ' + failures[failures.length - 1] : ''}`
  );
}

/** Fetch a single flow's full definition in the same shape the JSON editor saves. */
export async function getFlowDefinition(
  api: IApiProvider,
  url: string
): Promise<FlowDefinitionExport> {
  const flow = await api.get(url);

  if (!flow?.properties?.definition) {
    throw new Error('Flow has no definition');
  }

  return {
    $schema: EXPORT_SCHEMA,
    connectionReferences: flow.properties.connectionReferences || {},
    definition: flow.properties.definition,
  };
}

/** Make a flow display name safe to use as a file name on Windows and POSIX. */
export function toFileName(displayName: string, fallback: string): string {
  const cleaned = (displayName || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}
