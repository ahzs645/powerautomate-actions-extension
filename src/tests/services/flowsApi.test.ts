import {
  EXPORT_SCHEMA,
  getFlowDefinition,
  getFlowListAttempts,
  listFlows,
  toFileName,
} from '../../features/flows-list/flowsApi';
import { IApiProvider } from '../../services/ApiProvider';

function makeApi(
  get: (url: string) => Promise<any>,
  getAbsolute?: (url: string) => Promise<any>
): IApiProvider {
  return {
    get: jest.fn(get),
    getAbsolute: jest.fn(getAbsolute || get),
    patch: jest.fn(),
    post: jest.fn(),
    isApiReady: true,
    isPowerPlatformApi: false,
  } as unknown as IApiProvider;
}

function flowItem(id: string, displayName: string, extra: Record<string, any> = {}) {
  return {
    name: id,
    id: `/providers/Microsoft.ProcessSimple/environments/env-1/flows/${id}`,
    properties: { displayName, state: 'Started', ...extra },
  };
}

describe('getFlowListAttempts', () => {
  it('asks the environment-scoped Power Platform host for powerautomate/flows first', () => {
    const groups = getFlowListAttempts('env-1', true);

    expect(groups[0].map((a) => a.scope)).toEqual(['personal', 'team']);
    groups[0].forEach((attempt) => {
      expect(attempt.url.startsWith('powerautomate/flows?')).toBe(true);
    });
    expect(groups[0][0].url).toContain(encodeURIComponent("search('personal')"));
    expect(groups[0][1].url).toContain(encodeURIComponent("search('team')"));
  });

  it('puts the environment in the path for the legacy Flow API', () => {
    const groups = getFlowListAttempts('env-1', false);

    groups[0].forEach((attempt) => {
      expect(attempt.url).toContain('providers/Microsoft.ProcessSimple/environments/env-1/flows');
    });
  });

  it('falls back to an unfiltered listing when the search filters return nothing', () => {
    const ppGroups = getFlowListAttempts('env-1', true);
    const legacyGroups = getFlowListAttempts('env-1', false);

    expect(ppGroups[1][0].url).not.toContain('$filter');
    expect(legacyGroups[1][0].url).not.toContain('$filter');
  });
});

describe('listFlows', () => {
  it('merges the personal and team listings and sorts by name', async () => {
    const api = makeApi(async (url) =>
      url.includes(encodeURIComponent("search('personal')"))
        ? { value: [flowItem('b', 'Zebra flow')] }
        : { value: [flowItem('a', 'Alpha flow')] }
    );

    const flows = await listFlows(api, 'env-1', false);

    expect(flows.map((f) => f.displayName)).toEqual(['Alpha flow', 'Zebra flow']);
    expect(flows.map((f) => f.scope)).toEqual(['team', 'personal']);
  });

  it('deduplicates a flow that appears in both listings', async () => {
    const api = makeApi(async () => ({ value: [flowItem('dup', 'Shared flow')] }));

    const flows = await listFlows(api, 'env-1', false);

    expect(flows).toHaveLength(1);
    expect(flows[0].id).toBe('dup');
  });

  it('follows nextLink paging', async () => {
    const get = jest.fn(async () => ({
      value: [flowItem('p1', 'Page one')],
      nextLink: 'https://host/next-page',
    }));
    const getAbsolute = jest.fn(async () => ({ value: [flowItem('p2', 'Page two')] }));
    const api = makeApi(get, getAbsolute);

    const flows = await listFlows(api, 'env-1', false);

    expect(getAbsolute).toHaveBeenCalledWith('https://host/next-page');
    expect(flows.map((f) => f.id).sort()).toEqual(['p1', 'p2']);
  });

  it('moves on to the next endpoint shape when the first one errors', async () => {
    const api = makeApi(async (url) => {
      if (url.includes('$filter')) {
        throw new Error('Bad request');
      }
      return { value: [flowItem('only', 'Unfiltered flow')] };
    });

    const flows = await listFlows(api, 'env-1', false);

    expect(flows.map((f) => f.displayName)).toEqual(['Unfiltered flow']);
    expect(flows[0].scope).toBe('unknown');
  });

  it('reports an empty environment rather than an error when the API accepts the call', async () => {
    const api = makeApi(async () => ({ value: [] }));

    await expect(listFlows(api, 'env-1', false)).resolves.toEqual([]);
  });

  it('throws when no endpoint shape works', async () => {
    const api = makeApi(async () => {
      throw new Error('Authentication failed');
    });

    await expect(listFlows(api, 'env-1', false)).rejects.toThrow('Could not list flows');
  });
});

describe('getFlowDefinition', () => {
  it('returns the same shape the JSON editor saves', async () => {
    const api = makeApi(async () => ({
      properties: {
        displayName: 'My flow',
        definition: { triggers: {}, actions: {} },
        connectionReferences: { shared_office365: {} },
      },
    }));

    const result = await getFlowDefinition(api, 'powerautomate/flows/abc?draftFlow=true');

    expect(result).toEqual({
      $schema: EXPORT_SCHEMA,
      connectionReferences: { shared_office365: {} },
      definition: { triggers: {}, actions: {} },
    });
  });

  it('defaults connection references when the flow has none', async () => {
    const api = makeApi(async () => ({ properties: { definition: {} } }));

    const result = await getFlowDefinition(api, 'flows/abc');

    expect(result.connectionReferences).toEqual({});
  });

  it('throws when the flow has no definition', async () => {
    const api = makeApi(async () => ({ properties: { displayName: 'Broken' } }));

    await expect(getFlowDefinition(api, 'flows/abc')).rejects.toThrow('no definition');
  });
});

describe('toFileName', () => {
  it('keeps readable names intact', () => {
    expect(toFileName('Send approval email', 'fallback')).toBe('Send approval email');
  });

  it('replaces characters that are illegal in file names', () => {
    expect(toFileName('Invoice: A/B "test" <v2>', 'fallback')).toBe('Invoice_ A_B _test_ _v2_');
  });

  it('trims trailing dots and spaces that Windows rejects', () => {
    expect(toFileName('Nightly sync...  ', 'fallback')).toBe('Nightly sync');
  });

  it('falls back to the flow id when nothing usable is left', () => {
    expect(toFileName('   ', 'flow-guid')).toBe('flow-guid');
    expect(toFileName('', 'flow-guid')).toBe('flow-guid');
  });
});
