import { ApiError, ApiRequest } from '../../services/ApiProvider';
import {
    buildClientData,
    buildPublishXml,
    ConflictError,
    DataverseFlowError,
    DataverseFlowService,
    MissingConnectionReferenceError,
    toDataverseConnectionReferences,
} from '../../services/DataverseFlowService';

const WF = 'A1B2C3D4-0000-1111-2222-333344445555';
const wf = WF.toLowerCase();

const FLOW_API_REFS = {
    shared_sharepointonline: {
        connectionName: 'shared-sharepointonl-123',
        source: 'Embedded',
        id: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
        tier: 'NotSpecified',
        connectionReferenceLogicalName: 'cr_sharedsharepointonline_abc',
    },
    shared_office365_1: {
        connectionName: 'shared-office365-9',
        source: 'Invoker',
        id: '/providers/Microsoft.PowerApps/apis/shared_office365',
        connectionReferenceLogicalName: 'cr_sharedoffice365_def',
    },
};

const DEFINITION = { $schema: 'x', triggers: {}, actions: { Compose: { type: 'Compose', inputs: 1 } } };

function makeHttp(handler: (req: ApiRequest, call: number) => any) {
    const calls: ApiRequest[] = [];
    const http = {
        request: jest.fn(async (req: ApiRequest) => {
            calls.push(req);
            const result = handler(req, calls.length);
            if (result instanceof Error) throw result;
            return result;
        }),
    };
    return { http, calls };
}

describe('toDataverseConnectionReferences', () => {
    test('converts the Flow API shape to the solution-aware shape', () => {
        expect(toDataverseConnectionReferences(FLOW_API_REFS)).toEqual({
            shared_sharepointonline: {
                api: { name: 'shared_sharepointonline' },
                connection: { connectionReferenceLogicalName: 'cr_sharedsharepointonline_abc' },
                runtimeSource: 'embedded',
            },
            shared_office365_1: {
                api: { name: 'shared_office365' },
                connection: { connectionReferenceLogicalName: 'cr_sharedoffice365_def' },
                runtimeSource: 'invoker',
            },
        });
    });

    test('passes through references already in Dataverse shape', () => {
        const refs = {
            shared_teams: { api: { name: 'shared_teams' }, connection: { connectionReferenceLogicalName: 'cr_teams' }, runtimeSource: 'invoker' },
        };
        expect(toDataverseConnectionReferences(refs)).toEqual(refs);
    });

    test('derives the api name from apiName or the key when id is missing', () => {
        const out = toDataverseConnectionReferences({
            a: { apiName: 'approvals', connectionReferenceLogicalName: 'cr_a' },
            shared_excelonlinebusiness_2: { connectionReferenceLogicalName: 'cr_b' },
        });
        expect(out.a.api.name).toBe('shared_approvals');
        expect(out.shared_excelonlinebusiness_2.api.name).toBe('shared_excelonlinebusiness');
    });

    test('throws a typed error listing every reference without a logical name', () => {
        const refs = {
            ...FLOW_API_REFS,
            shared_teams: { connectionName: 'shared-teams-1', source: 'Embedded', id: '/providers/Microsoft.PowerApps/apis/shared_teams' },
            shared_approvals: { connectionName: 'x', id: '/providers/Microsoft.PowerApps/apis/shared_approvals', connectionReferenceLogicalName: '  ' },
        };
        let error: any;
        try {
            toDataverseConnectionReferences(refs);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(MissingConnectionReferenceError);
        expect(error).toBeInstanceOf(DataverseFlowError);
        expect(error.referenceKeys).toEqual(['shared_teams', 'shared_approvals']);
    });

    test('handles no references', () => {
        expect(toDataverseConnectionReferences(undefined)).toEqual({});
    });
});

describe('buildClientData / buildPublishXml', () => {
    test('clientdata matches the stored workflow format', () => {
        const refs = toDataverseConnectionReferences(FLOW_API_REFS);
        const parsed = JSON.parse(buildClientData(DEFINITION, refs, 'My flow'));
        expect(parsed).toEqual({ properties: { connectionReferences: refs, definition: DEFINITION, displayName: 'My flow' }, schemaVersion: '1.0.0.0' });
        expect(JSON.parse(buildClientData(DEFINITION, {})).properties).not.toHaveProperty('displayName');
    });

    test('keeps the fields of the existing clientdata it does not manage', () => {
        const base = { properties: { definition: { old: true }, connectionReferences: {}, templateName: 'tpl', extra: 1 }, schemaVersion: '1.0.0.0', other: 'x' };
        const parsed = JSON.parse(buildClientData(DEFINITION, {}, undefined, base));
        expect(parsed).toEqual({ properties: { definition: DEFINITION, connectionReferences: {}, templateName: 'tpl', extra: 1 }, schemaVersion: '1.0.0.0', other: 'x' });
        expect(JSON.parse(buildClientData(DEFINITION, {}, undefined, 'not an object'))).toEqual({ properties: { connectionReferences: {}, definition: DEFINITION }, schemaVersion: '1.0.0.0' });
    });

    test('PublishXml parameter wraps the id in braces', () => {
        expect(buildPublishXml(WF)).toBe(`<importexportxml><workflows><workflow>{${wf}}</workflow></workflows></importexportxml>`);
        expect(buildPublishXml(`{${WF}}`)).toBe(`<importexportxml><workflows><workflow>{${wf}}</workflow></workflows></importexportxml>`);
        expect(() => buildPublishXml('not-a-guid')).toThrow(DataverseFlowError);
    });
});

describe('DataverseFlowService.getWorkflow', () => {
    test('selects the needed columns and returns the ETag', async () => {
        const clientdata = buildClientData(DEFINITION, {});
        const { http, calls } = makeHttp(() => ({ '@odata.etag': 'W/"100"', workflowid: wf, name: 'Flow', statecode: 1, modifiedon: '2026-01-01T00:00:00Z', clientdata }));
        const result = await new DataverseFlowService(http).getWorkflow(WF);
        expect(calls[0]).toEqual(expect.objectContaining({
            method: 'GET',
            audience: 'dataverse',
            url: `workflows(${wf})?$select=clientdata,name,statecode,modifiedon`,
            apiVersion: false,
        }));
        expect(calls[0].headers).toEqual(expect.objectContaining({ 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' }));
        expect(result.etag).toBe('W/"100"');
        expect(result.clientdataParsed.properties.definition).toEqual(DEFINITION);
    });
});

describe('DataverseFlowService.saveDraft', () => {
    test('PATCHes clientdata with If-Match, OData and AsUnpublished headers', async () => {
        const { http, calls } = makeHttp(() => ({ status: 204, body: {}, headers: { etag: 'W/"101"' }, requestIds: {} }));
        const result = await new DataverseFlowService(http).saveDraft({
            workflowEntityId: WF,
            definition: DEFINITION,
            connectionReferences: FLOW_API_REFS,
            displayName: 'Renamed',
            environmentName: 'Default-1',
            etag: 'W/"100"',
        });
        expect(calls).toHaveLength(1);
        const req = calls[0];
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`workflows(${wf})`);
        expect(req.audience).toBe('dataverse');
        expect(req.apiVersion).toBe(false);
        expect(req.headers).toEqual(expect.objectContaining({
            'Content-Type': 'application/json',
            'OData-MaxVersion': '4.0',
            'OData-Version': '4.0',
            'If-Match': 'W/"100"',
            'MSCRM.AsUnpublished': 'true',
        }));
        const clientdata = JSON.parse(req.body.clientdata);
        expect(clientdata.schemaVersion).toBe('1.0.0.0');
        expect(clientdata.properties.displayName).toBe('Renamed');
        expect(clientdata.properties.connectionReferences.shared_office365_1.runtimeSource).toBe('invoker');
        expect(result.etag).toBe('W/"101"');
    });

    test('fetches the ETag first when none is supplied (never If-Match: *)', async () => {
        const { http, calls } = makeHttp((req) => req.method === 'GET'
            ? { '@odata.etag': 'W/"7"', workflowid: wf }
            : { status: 204, body: {}, headers: {}, requestIds: {} });
        await new DataverseFlowService(http).saveDraft({ workflowEntityId: WF, definition: DEFINITION, connectionReferences: {} });
        expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
        expect(calls[1].headers!['If-Match']).toBe('W/"7"');
    });

    test('refuses to save when Dataverse returns no ETag', async () => {
        const { http, calls } = makeHttp(() => ({ workflowid: wf }));
        await expect(new DataverseFlowService(http).saveDraft({ workflowEntityId: WF, definition: DEFINITION })).rejects.toThrow(/ETag/);
        expect(calls.map((c) => c.method)).toEqual(['GET']);
    });

    test('412 becomes a ConflictError carrying request ids', async () => {
        const { http } = makeHttp(() => new ApiError('Precondition Failed', 412, '0x80060882', { serviceRequestId: 'svc-1' }));
        const error: any = await new DataverseFlowService(http)
            .saveDraft({ workflowEntityId: WF, definition: DEFINITION, etag: 'W/"1"' })
            .catch((e) => e);
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toMatch(/changed elsewhere/);
        expect(error.status).toBe(412);
        expect(error.requestIds).toEqual({ serviceRequestId: 'svc-1' });
    });

    test('missing logical names fail before any request so the caller can fall back', async () => {
        const { http } = makeHttp(() => ({}));
        await expect(new DataverseFlowService(http).saveDraft({
            workflowEntityId: WF, definition: DEFINITION, etag: 'W/"1"',
            connectionReferences: { shared_teams: { connectionName: 'c', id: '/providers/Microsoft.PowerApps/apis/shared_teams' } },
        })).rejects.toBeInstanceOf(MissingConnectionReferenceError);
        expect(http.request).not.toHaveBeenCalled();
    });

    test('does not let ApiProvider retry the write', async () => {
        const { http, calls } = makeHttp(() => ({ status: 204, body: {}, headers: {}, requestIds: {} }));
        await new DataverseFlowService(http).saveDraft({ workflowEntityId: WF, definition: DEFINITION, etag: 'W/"1"' });
        expect(calls[0].retries).toBe(0);
    });
});

describe('DataverseFlowService.publish', () => {
    test('POSTs PublishXml with the workflow id', async () => {
        const { http, calls } = makeHttp(() => ({}));
        await new DataverseFlowService(http).publish(WF);
        expect(calls[0]).toEqual(expect.objectContaining({ method: 'POST', url: 'PublishXml', audience: 'dataverse', apiVersion: false }));
        expect(calls[0].body).toEqual({ ParameterXml: `<importexportxml><workflows><workflow>{${wf}}</workflow></workflows></importexportxml>` });
    });

    test.each([429, 503])('retries once on %s', async (status) => {
        const sleep = jest.fn(async () => undefined);
        const { http, calls } = makeHttp((_req, n) => (n === 1 ? new ApiError('busy', status) : {}));
        await new DataverseFlowService(http, { sleep }).publish(WF);
        expect(calls).toHaveLength(2);
        expect(sleep).toHaveBeenCalledTimes(1);
    });

    test('gives up after one retry', async () => {
        const { http, calls } = makeHttp(() => new ApiError('busy', 500));
        await expect(new DataverseFlowService(http, { sleep: async () => undefined }).publish(WF)).rejects.toBeInstanceOf(DataverseFlowError);
        expect(calls).toHaveLength(2);
    });

    test('does not retry client errors', async () => {
        const { http, calls } = makeHttp(() => new ApiError('Forbidden', 403));
        await expect(new DataverseFlowService(http, { sleep: async () => undefined }).publish(WF)).rejects.toThrow(/Could not publish the flow: Forbidden/);
        expect(calls).toHaveLength(1);
    });
});
