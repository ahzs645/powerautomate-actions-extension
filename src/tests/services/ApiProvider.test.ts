import { ApiError, createApiClient, IApiDetails, parseRequestIds } from '../../services/ApiProvider';

type MockResponseInit = { status?: number; body?: any; headers?: Record<string, string>; statusText?: string };

function mockResponse({ status = 200, body, headers = {}, statusText = '' }: MockResponseInit) {
    const lower: Record<string, string> = {};
    Object.keys(headers).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
    if (body !== undefined && !lower['content-type']) lower['content-type'] = 'application/json; odata.metadata=minimal';
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText,
        headers: {
            get: (name: string) => lower[name.toLowerCase()] ?? null,
            forEach: (cb: (value: string, key: string) => void) => Object.keys(lower).forEach((k) => cb(lower[k], k)),
        },
        text: async () => text,
        json: async () => JSON.parse(text),
    } as unknown as Response;
}

const DETAILS: IApiDetails = {
    isReady: true,
    apiUrl: 'https://unitedstates.api.flow.microsoft.com/',
    token: 'Bearer primary',
    legacyApiUrl: 'https://unitedstates.api.flow.microsoft.com/',
    legacyToken: 'Bearer primary',
    dataverseApiUrl: 'https://contoso.crm.dynamics.com/api/data/v9.2/',
    dataverseToken: 'Bearer dataverse',
};

function setup(responses: Array<Response | Error>, details: IApiDetails = DETAILS) {
    const fetchImpl = jest.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error('no more responses');
        if (next instanceof Error) throw next;
        return next;
    });
    const sleep = jest.fn(async () => undefined);
    const onDiagnostic = jest.fn();
    const client = createApiClient({ getDetails: () => details, fetchImpl: fetchImpl as any, sleep, onDiagnostic });
    return { client, fetchImpl, sleep, onDiagnostic };
}

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
    jest.restoreAllMocks();
});

describe('createApiClient', () => {
    test('legacy get() keeps the primary base URL, token and api-version', async () => {
        const { client, fetchImpl } = setup([mockResponse({ body: { name: 'flow' } })]);
        await expect(client.get('providers/Microsoft.ProcessSimple/environments/e/flows/f')).resolves.toEqual({ name: 'flow' });
        const [url, init] = (fetchImpl.mock.calls[0] as any[]);
        expect(url).toBe('https://unitedstates.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/e/flows/f?api-version=2016-11-01');
        expect(init.headers.authorization).toBe('Bearer primary');
        expect(init.headers['x-ms-client-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('Power Platform hosts use api-version=1', async () => {
        const { client, fetchImpl } = setup([mockResponse({ body: {} })], {
            isReady: true, apiUrl: 'https://abc.environment.api.powerplatform.com/', token: 'Bearer pp',
        });
        await client.get('powerautomate/flows/x?$expand=y');
        expect((fetchImpl.mock.calls[0] as any[])[0]).toBe('https://abc.environment.api.powerplatform.com/powerautomate/flows/x?$expand=y&api-version=1');
    });

    test('getAbsolute never rewrites the URL', async () => {
        const { client, fetchImpl } = setup([mockResponse({ body: { value: [] } })]);
        await client.getAbsolute('https://api.flow.microsoft.com/next?api-version=2016-11-01&$skiptoken=x');
        expect((fetchImpl.mock.calls[0] as any[])[0]).toBe('https://api.flow.microsoft.com/next?api-version=2016-11-01&$skiptoken=x');
    });

    test('request() targets the Dataverse audience without api-version and with custom headers', async () => {
        const { client, fetchImpl } = setup([mockResponse({ body: { workflowid: 'w' } })]);
        await client.request({ method: 'GET', audience: 'dataverse', url: 'workflows(w)?$select=name', headers: { 'OData-Version': '4.0' } });
        const [url, init] = (fetchImpl.mock.calls[0] as any[]);
        expect(url).toBe('https://contoso.crm.dynamics.com/api/data/v9.2/workflows(w)?$select=name');
        expect(init.headers.authorization).toBe('Bearer dataverse');
        expect(init.headers['OData-Version']).toBe('4.0');
    });

    test('request() accepts an explicit base URL + token', async () => {
        const { client, fetchImpl } = setup([mockResponse({ status: 204 })]);
        await client.request({ method: 'PATCH', url: '/things(1)', baseUrl: 'https://other.example.com/api/', token: 'Bearer other', apiVersion: false, body: { a: 1 } });
        const [url, init] = (fetchImpl.mock.calls[0] as any[]);
        expect(url).toBe('https://other.example.com/api/things(1)');
        expect(init.headers.authorization).toBe('Bearer other');
        expect(init.body).toBe('{"a":1}');
    });

    test('raw responses expose status, headers and request ids', async () => {
        const { client } = setup([mockResponse({ status: 204, headers: { ETag: 'W/"2"', 'x-ms-service-request-id': 'svc-1' } })]);
        const raw: any = await client.request({ method: 'PATCH', audience: 'dataverse', url: 'workflows(w)', raw: true, body: {} });
        expect(raw.status).toBe(204);
        expect(raw.headers.etag).toBe('W/"2"');
        expect(raw.requestIds.serviceRequestId).toBe('svc-1');
    });

    test('a missing audience token fails with a clear message', async () => {
        const { client, fetchImpl } = setup([], { isReady: true, apiUrl: 'https://api.flow.microsoft.com/', token: 'Bearer x' });
        await expect(client.request({ method: 'GET', audience: 'dataverse', url: 'workflows' })).rejects.toThrow(/no dataverse token/);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('errors are ApiError with status, code, message and request ids', async () => {
        const { client } = setup([mockResponse({
            status: 412,
            statusText: 'Precondition Failed',
            body: { error: { code: '0x80060882', message: 'The version of the existing record doesn\'t match' } },
            headers: { 'x-ms-service-request-id': 'svc-9', 'x-ms-correlation-request-id': 'corr-9' },
        })]);
        const error: ApiError = await client.request({ method: 'PATCH', audience: 'dataverse', url: 'workflows(w)' }).catch((e) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toBeInstanceOf(Error);
        expect(error.status).toBe(412);
        expect(error.code).toBe('0x80060882');
        expect(error.message).toMatch(/existing record/);
        expect(error.requestIds).toEqual(expect.objectContaining({ serviceRequestId: 'svc-9', correlationRequestId: 'corr-9' }));
        expect(error.requestIds.clientRequestId).toBeTruthy();
    });

    test('keeps the historical messages for 401/403/404', async () => {
        const { client } = setup([mockResponse({ status: 401 }), mockResponse({ status: 403 }), mockResponse({ status: 404 })]);
        await expect(client.get('a')).rejects.toThrow('Authentication failed. Please refresh the Power Automate page and try again.');
        await expect(client.get('a')).rejects.toThrow('Access forbidden. You may not have permission to modify this flow.');
        await expect(client.get('a')).rejects.toThrow('Flow not found. It may have been deleted or moved.');
    });

    test('retries 429 and 5xx with backoff, honouring Retry-After', async () => {
        const { client, sleep, fetchImpl } = setup([
            mockResponse({ status: 429, headers: { 'Retry-After': '2' } }),
            mockResponse({ status: 503 }),
            mockResponse({ body: { ok: true } }),
        ]);
        await expect(client.get('a')).resolves.toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenNthCalledWith(1, 2000);
        expect(sleep).toHaveBeenNthCalledWith(2, 2000); // linear backoff, attempt 2
    });

    test('gives up after the retry budget', async () => {
        const { client, fetchImpl } = setup([
            mockResponse({ status: 500, body: { error: { message: 'boom' } } }),
            mockResponse({ status: 500, body: { error: { message: 'boom' } } }),
        ]);
        await expect(client.request({ method: 'POST', url: 'x', retries: 1 })).rejects.toThrow('Server error (500): boom');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('retries network errors then reports them', async () => {
        const { client, fetchImpl } = setup([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
        await expect(client.request({ method: 'GET', url: 'x', retries: 1 })).rejects.toThrow('Network error. Please check your connection and try again.');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('diagnostics hook receives host/status/ids but no URL path, query or token', async () => {
        const { client, onDiagnostic } = setup([mockResponse({ body: {}, headers: { 'x-ms-service-request-id': 'svc-1' } })]);
        await client.get('providers/secret-path?$filter=x');
        const event = onDiagnostic.mock.calls[0][0];
        expect(event).toEqual(expect.objectContaining({ kind: 'api', method: 'GET', host: 'unitedstates.api.flow.microsoft.com', status: 200 }));
        expect(JSON.stringify(event)).not.toMatch(/secret-path|filter|Bearer/);
    });
});

describe('parseRequestIds', () => {
    test('reads the Microsoft request id headers', () => {
        const headers = new Map<string, string>([
            ['x-ms-service-request-id', 'a, b'],
            ['x-ms-correlation-request-id', 'c'],
            ['x-ms-client-request-id', 'd'],
        ]);
        expect(parseRequestIds({ get: (n: string) => headers.get(n) ?? null })).toEqual({
            serviceRequestId: 'a', correlationRequestId: 'c', clientRequestId: 'd',
        });
        expect(parseRequestIds(undefined)).toEqual({});
    });
});
