import {
    DiagnosticsStore,
    DIAGNOSTICS_MAX_EVENTS,
    formatDiagnostics,
    sanitizeDiagnosticEvent,
    scrubText,
} from '../../services/Diagnostics';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE3MDAwMDAwMDAsImF1ZCI6Imh0dHBzOi8vc2VydmljZS5mbG93In0.c2lnbmF0dXJl';

function memoryStorage() {
    const data: Record<string, any> = {};
    return {
        data,
        get: jest.fn(async (key: string) => (key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {})),
        set: jest.fn(async (items: Record<string, any>) => { Object.assign(data, JSON.parse(JSON.stringify(items))); }),
    };
}

describe('sanitizeDiagnosticEvent', () => {
    test('keeps only whitelisted fields and reduces URLs to hosts', () => {
        const event = sanitizeDiagnosticEvent({
            kind: 'api',
            url: 'https://contoso.crm.dynamics.com/api/data/v9.2/workflows(1)?$select=clientdata&token=abc',
            method: 'PATCH',
            status: 412,
            audience: 'dataverse',
            token: `Bearer ${JWT}`,
            body: { clientdata: 'secret' },
            requestIds: { serviceRequestId: 'abc-123', correlationRequestId: 'bad value with spaces', clientRequestId: 'c-1' },
            flags: { hasToken: true, nested: { x: 1 }, str: 'yes' },
        }, 42)!;
        expect(event).toEqual({
            t: 42,
            kind: 'api',
            host: 'contoso.crm.dynamics.com',
            method: 'PATCH',
            status: 412,
            audience: 'dataverse',
            requestIds: { serviceRequestId: 'abc-123', clientRequestId: 'c-1' },
            flags: { hasToken: true },
        });
        const serialized = JSON.stringify(event);
        expect(serialized).not.toContain('eyJ');
        expect(serialized).not.toContain('select');
        expect(serialized).not.toContain('secret');
    });

    test('scrubs tokens and URLs out of free text', () => {
        const text = scrubText(`failed Bearer ${JWT} calling https://api.flow.microsoft.com/providers/x?sig=SECRET and ${JWT}`)!;
        expect(text).not.toContain('eyJ');
        expect(text).not.toContain('SECRET');
        expect(text).not.toContain('/providers/');
        expect(text).toContain('api.flow.microsoft.com');
    });

    test('rejects events without a valid kind', () => {
        expect(sanitizeDiagnosticEvent({})).toBeNull();
        expect(sanitizeDiagnosticEvent({ kind: 'has spaces' })).toBeNull();
        expect(sanitizeDiagnosticEvent(null)).toBeNull();
    });
});

describe('DiagnosticsStore', () => {
    test('is a per-tab ring buffer of the last 50 events', async () => {
        const storage = memoryStorage();
        const store = new DiagnosticsStore(storage);
        await Promise.all(Array.from({ length: 60 }, (_, i) => store.record(1, { kind: 'api', status: i, t: i })));
        await store.record(2, { kind: 'token', host: 'api.flow.microsoft.com' });

        const tab1 = await store.get(1);
        expect(tab1).toHaveLength(DIAGNOSTICS_MAX_EVENTS);
        expect(tab1[0].status).toBe(10);
        expect(tab1[49].status).toBe(59);
        expect(await store.get(2)).toHaveLength(1);

        await store.removeTab(1);
        expect(await store.get(1)).toEqual([]);
        expect(await store.get(2)).toHaveLength(1);
    });

    test('survives a failing storage area', async () => {
        const store = new DiagnosticsStore({
            get: async () => { throw new Error('no session storage'); },
            set: async () => { throw new Error('no session storage'); },
        });
        await expect(store.record(1, { kind: 'api' })).resolves.toBeUndefined();
        await expect(store.get(1)).resolves.toEqual([]);
    });
});

describe('formatDiagnostics', () => {
    test('produces a readable blob without secrets', () => {
        const text = formatDiagnostics([
            { t: 0, kind: 'api', method: 'GET', host: 'api.flow.microsoft.com', status: 200, durationMs: 120, requestIds: { serviceRequestId: 's-1', clientRequestId: 'c-1' } },
            { t: 1000, kind: 'token', audience: 'dataverse', host: 'contoso.crm.dynamics.com', flags: { hasToken: true } },
        ], {
            extensionVersion: '2.3.0',
            extensionEnabled: true,
            envId: 'Default-1',
            tokens: { flow: { host: 'api.flow.microsoft.com', hasToken: true, expired: false, expiresInMin: 42 } },
        }, 5000);
        expect(text).toContain('Extension version: 2.3.0');
        expect(text).toContain('flow: host=api.flow.microsoft.com hasToken=true expires in 42 min');
        expect(text).toContain('api GET api.flow.microsoft.com -> 200 120ms svc=s-1 client=c-1');
        expect(text).toContain('token [dataverse] contoso.crm.dynamics.com hasToken=true');
        expect(text).not.toMatch(/eyJ|Bearer/);
    });
});
