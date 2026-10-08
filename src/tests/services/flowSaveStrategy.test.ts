import { ApiError, ApiRequest, IApiProvider } from '../../services/ApiProvider';
import { ConflictError, DataverseFlowError, MissingConnectionReferenceError } from '../../services/DataverseFlowService';
import { dataverseSaveStrategy, readDataverseEtag } from '../../features/flow-editor/dataverseSaveStrategy';
import {
  dataverseAvailability,
  flowServiceSaveStrategy,
  FlowTarget,
  SaveMode,
  selectSaveStrategy,
  strategyFor,
} from '../../features/flow-editor/flowPersistence';

const WF = 'a1b2c3d4-0000-1111-2222-333344445555';
const NOW = 1_800_000_000_000;

const FLOW_REFS = {
  shared_office365: {
    connectionName: 'shared-office365-1',
    source: 'Invoker',
    id: '/providers/Microsoft.PowerApps/apis/shared_office365',
    connectionReferenceLogicalName: 'cr_office365',
  },
};
const DV_REFS = {
  shared_office365: {
    api: { name: 'shared_office365' },
    connection: { connectionReferenceLogicalName: 'cr_office365' },
    runtimeSource: 'invoker',
  },
};
const DEFINITION = { triggers: {}, actions: { Compose: { type: 'Compose', inputs: 1 } } };
const DOC = { displayName: 'Invoice flow', definition: DEFINITION, connectionReferences: FLOW_REFS };

function apiWith(
  overrides: Partial<IApiProvider> & { hasDataverse?: boolean; expiresAt?: number } = {}
): IApiProvider {
  const { hasDataverse = true, expiresAt, ...rest } = overrides;
  return {
    get: jest.fn(),
    getAbsolute: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
    isApiReady: true,
    isPowerPlatformApi: false,
    request: jest.fn(),
    endpoints: { hasDataverse, expiresAt: expiresAt ? { dataverse: expiresAt } : undefined },
    ...rest,
  };
}

const target = (extra: Partial<FlowTarget> = {}): FlowTarget => ({ envId: 'env-1', flowId: 'flow-1', ...extra });

function row(definition: any, etag: string, extra: Record<string, any> = {}) {
  return {
    workflowid: WF,
    name: 'Invoice flow (stored)',
    '@odata.etag': etag,
    clientdata: JSON.stringify({
      properties: { connectionReferences: DV_REFS, definition, templateName: 'tpl', ...extra },
      schemaVersion: '1.0.0.0',
    }),
  };
}

/** A fake Dataverse endpoint: routes requests by method/url and records them. */
function fakeDataverse(handlers: {
  get?: (call: number) => any;
  patch?: (req: ApiRequest) => any;
  publish?: (call: number) => any;
}) {
  const calls: ApiRequest[] = [];
  let gets = 0;
  let publishes = 0;
  const request = jest.fn(async (req: ApiRequest) => {
    calls.push(req);
    let result: any;
    if (req.method === 'GET') result = handlers.get?.(++gets);
    else if (req.method === 'PATCH') result = handlers.patch?.(req);
    else if (req.url === 'PublishXml') result = handlers.publish?.(++publishes);
    if (result instanceof Error) throw result;
    return result;
  });
  return { request, calls };
}

describe('selectSaveStrategy', () => {
  type Row = [SaveMode, string | undefined, boolean, boolean, 'flow' | 'dataverse'];
  // preference, workflowEntityId, hasDataverse, has request(), expected
  const matrix: Row[] = [
    ['flow', undefined, false, true, 'flow'],
    ['flow', WF, true, true, 'flow'],
    ['dataverse', WF, true, true, 'dataverse'],
    ['dataverse', undefined, true, true, 'flow'],
    ['dataverse', WF, false, true, 'flow'],
    ['dataverse', WF, true, false, 'flow'],
    ['dataverse', undefined, false, false, 'flow'],
  ];

  test.each(matrix)('preference %s, workflow %s, dataverse %s, request %s → %s', (pref, wf, hasDv, hasRequest, expected) => {
    const api = apiWith({ hasDataverse: hasDv, ...(hasRequest ? {} : { request: undefined }) });
    expect(selectSaveStrategy(api, target({ workflowEntityId: wf }), pref).id).toBe(expected);
  });

  test('defaults to the Flow service when no preference is given', () => {
    expect(selectSaveStrategy(apiWith(), target({ workflowEntityId: WF }))).toBe(flowServiceSaveStrategy);
  });

  test('an expired Dataverse token falls back to the Flow service', () => {
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      const api = apiWith({ expiresAt: NOW - 1 });
      expect(selectSaveStrategy(api, target({ workflowEntityId: WF }), 'dataverse').id).toBe('flow');
      expect(selectSaveStrategy(apiWith({ expiresAt: NOW + 60_000 }), target({ workflowEntityId: WF }), 'dataverse').id).toBe('dataverse');
    } finally {
      Date.now = realNow;
    }
  });

  test('explains why Dataverse is unavailable', () => {
    expect(dataverseAvailability(apiWith(), undefined)).toEqual({ available: false, reason: expect.stringMatching(/solution flows/) });
    expect(dataverseAvailability(apiWith({ hasDataverse: false }), WF)).toEqual({ available: false, reason: expect.stringMatching(/No Dataverse sign-in/) });
    expect(dataverseAvailability(apiWith({ expiresAt: NOW - 1 }), WF, NOW)).toEqual({ available: false, reason: expect.stringMatching(/expired/) });
    expect(dataverseAvailability(apiWith(), WF)).toEqual({ available: true });
  });

  test('strategyFor maps modes to strategies with user-facing labels', () => {
    expect(strategyFor('flow')).toBe(flowServiceSaveStrategy);
    expect(strategyFor('dataverse')).toBe(dataverseSaveStrategy);
    expect(strategyFor('dataverse').label).toMatch(/experimental/);
  });
});

describe('dataverseSaveStrategy', () => {
  test('saves with the row version, keeps unmanaged clientdata fields and returns what Dataverse stored', async () => {
    const storedDefinition = { ...DEFINITION, contentVersion: '1.0.0.0' };
    const { request, calls } = fakeDataverse({
      get: (n) => (n === 1 ? row(DEFINITION, 'W/"100"') : row(storedDefinition, 'W/"101"')),
      patch: () => ({ status: 204, body: {}, headers: { etag: 'W/"101"' }, requestIds: {} }),
    });
    const api = apiWith({ request });

    const saved = await dataverseSaveStrategy.saveDraft(api, target({ workflowEntityId: WF }), DOC);

    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH', 'GET']);
    const patch = calls[1];
    expect(patch.url).toBe(`workflows(${WF})`);
    expect(patch.headers).toMatchObject({ 'If-Match': 'W/"100"', 'MSCRM.AsUnpublished': 'true' });
    const clientdata = JSON.parse(patch.body.clientdata);
    expect(clientdata.properties.definition).toEqual(DEFINITION);
    expect(clientdata.properties.connectionReferences).toEqual(DV_REFS);
    expect(clientdata.properties.templateName).toBe('tpl'); // carried over, not dropped

    expect(saved.definition).toEqual(storedDefinition);
    expect(saved.displayName).toBe('Invoice flow (stored)');
    // Stored references say the same thing: the editor keeps its own shape.
    expect(saved.connectionReferences).toBe(FLOW_REFS);
    expect(saved.dataverseEtag).toBe('W/"101"');
  });

  test('uses the version the editor is based on and reports a newer row as a conflict without writing', async () => {
    const { request, calls } = fakeDataverse({ get: () => row(DEFINITION, 'W/"105"') });
    const api = apiWith({ request });

    await expect(
      dataverseSaveStrategy.saveDraft(api, target({ workflowEntityId: WF, dataverseEtag: 'W/"100"' }), DOC)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  test('a 412 from Dataverse becomes a ConflictError carrying the request ids', async () => {
    const { request } = fakeDataverse({
      get: () => row(DEFINITION, 'W/"100"'),
      patch: () => new ApiError('Precondition failed', 412, '0x80060882', { serviceRequestId: 'svc-412' }),
    });
    const error = await dataverseSaveStrategy
      .saveDraft(apiWith({ request }), target({ workflowEntityId: WF }), DOC)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.requestIds).toEqual({ serviceRequestId: 'svc-412' });
  });

  test('references without a logical name fail before any request is sent', async () => {
    const { request } = fakeDataverse({});
    const doc = {
      ...DOC,
      connectionReferences: {
        ...FLOW_REFS,
        shared_teams: { connectionName: 'shared-teams-1', id: '/providers/Microsoft.PowerApps/apis/shared_teams' },
      },
    };
    const error = await dataverseSaveStrategy
      .saveDraft(apiWith({ request }), target({ workflowEntityId: WF }), doc)
      .catch((e) => e);
    expect(error).toBeInstanceOf(MissingConnectionReferenceError);
    expect(error.referenceKeys).toEqual(['shared_teams']);
    expect(request).not.toHaveBeenCalled();
  });

  test('refuses a row whose clientdata holds no flow definition', async () => {
    const { request, calls } = fakeDataverse({ get: () => ({ workflowid: WF, '@odata.etag': 'W/"1"', clientdata: '' }) });
    await expect(
      dataverseSaveStrategy.saveDraft(apiWith({ request }), target({ workflowEntityId: WF }), DOC)
    ).rejects.toBeInstanceOf(DataverseFlowError);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  test('requires a solution flow', async () => {
    await expect(dataverseSaveStrategy.saveDraft(apiWith(), target(), DOC)).rejects.toThrow(/not in a solution/);
  });

  test('a failed re-read after a successful write returns the sent document', async () => {
    const { request } = fakeDataverse({
      get: (n) => (n === 1 ? row(DEFINITION, 'W/"100"') : new Error('network')),
      patch: () => ({ status: 204, body: {}, headers: { etag: 'W/"101"' }, requestIds: {} }),
    });
    const saved = await dataverseSaveStrategy.saveDraft(apiWith({ request }), target({ workflowEntityId: WF }), DOC);
    expect(saved).toEqual({ ...DOC, dataverseEtag: 'W/"101"' });
  });

  test('shows the stored references when they differ from what was sent', async () => {
    const otherRefs = { shared_office365: { ...DV_REFS.shared_office365, runtimeSource: 'embedded' } };
    const { request } = fakeDataverse({
      get: (n) => (n === 1 ? row(DEFINITION, 'W/"1"') : { ...row(DEFINITION, 'W/"2"'), clientdata: JSON.stringify({ properties: { definition: DEFINITION, connectionReferences: otherRefs } }) }),
      patch: () => ({ status: 204, body: {}, headers: {}, requestIds: {} }),
    });
    const saved = await dataverseSaveStrategy.saveDraft(apiWith({ request }), target({ workflowEntityId: WF }), DOC);
    expect(saved.connectionReferences).toEqual(otherRefs);
  });

  test('publishes with PublishXml', async () => {
    const { request, calls } = fakeDataverse({ publish: () => ({}) });
    await dataverseSaveStrategy.publish(apiWith({ request }), target({ workflowEntityId: WF }));
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'PublishXml' });
    expect(calls[0].body.ParameterXml).toContain(`{${WF}}`);
  });

  test('readDataverseEtag is best effort', async () => {
    const ok = fakeDataverse({ get: () => row(DEFINITION, 'W/"7"') });
    expect(await readDataverseEtag(apiWith({ request: ok.request }), WF)).toBe('W/"7"');
    const failing = fakeDataverse({ get: () => new Error('nope') });
    expect(await readDataverseEtag(apiWith({ request: failing.request }), WF)).toBeUndefined();
  });
});
