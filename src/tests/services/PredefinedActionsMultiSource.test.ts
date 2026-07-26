// Covers the multi-source behaviour added alongside the bundled utility pack:
// per-URL caching, bundled + remote merging, and category extraction.

import { PredefinedActionsService } from '../../services';
import { IActionModel, ISettingsModel, defaultSettings } from '../../models';

const buildRemoteAction = (title: string): IActionModel => ({
    id: `remote-${title}`,
    title,
    method: 'GET',
    icon: '',
    url: 'https://example.com',
    actionJson: JSON.stringify({ operationName: title, operationDefinition: { type: 'Compose' } }),
    category: 'Remote',
});

describe('PredefinedActionsService multi-source', () => {
    let service: PredefinedActionsService;
    let store: Record<string, any>;

    beforeEach(() => {
        service = new PredefinedActionsService();
        store = {};

        (global as any).chrome = {
            storage: {
                local: {
                    get: jest.fn((keys: any) => {
                        if (keys === null) { return Promise.resolve({ ...store }); }
                        const result: Record<string, any> = {};
                        for (const key of ([] as string[]).concat(keys)) {
                            if (key in store) { result[key] = store[key]; }
                        }
                        return Promise.resolve(result);
                    }),
                    set: jest.fn((items: Record<string, any>) => {
                        Object.assign(store, items);
                        return Promise.resolve();
                    }),
                    remove: jest.fn((keys: any) => {
                        for (const key of ([] as string[]).concat(keys)) { delete store[key]; }
                        return Promise.resolve();
                    }),
                },
            },
        };
    });

    describe('parseUrls', () => {
        it('splits on newlines and commas and trims', () => {
            expect(service.parseUrls(' https://a.json \n https://b.json, https://c.json '))
                .toEqual(['https://a.json', 'https://b.json', 'https://c.json']);
        });

        it('returns an empty list for undefined', () => {
            expect(service.parseUrls(undefined)).toEqual([]);
        });
    });

    // Regression: a single global cache key meant a second source overwrote the
    // first, so both URLs returned whichever was fetched last.
    it('caches each source under its own key', async () => {
        global.fetch = jest.fn((url: any) =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([buildRemoteAction(url.includes('a.json') ? 'FromA' : 'FromB')]),
            } as Response)
        ) as any;

        await service.fetchPredefinedActions('https://example.com/a.json');
        await service.fetchPredefinedActions('https://example.com/b.json');

        const cacheKeys = Object.keys(store).filter(k => !k.endsWith(':timestamp'));
        expect(cacheKeys).toHaveLength(2);

        // Served from cache now, so each URL must still return its own actions.
        (global.fetch as jest.Mock).mockClear();
        const fromA = await service.fetchPredefinedActions('https://example.com/a.json');
        const fromB = await service.fetchPredefinedActions('https://example.com/b.json');

        expect(global.fetch).not.toHaveBeenCalled();
        expect(fromA[0].title).toBe('FromA');
        expect(fromB[0].title).toBe('FromB');
    });

    it('clears only the requested source', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve([buildRemoteAction('X')]) } as Response)
        ) as any;

        await service.fetchPredefinedActions('https://example.com/a.json');
        await service.fetchPredefinedActions('https://example.com/b.json');
        await service.clearCache('https://example.com/a.json');

        expect(Object.keys(store).filter(k => !k.endsWith(':timestamp'))).toHaveLength(1);
    });

    it('clears every source when no url is given', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve([buildRemoteAction('X')]) } as Response)
        ) as any;

        await service.fetchPredefinedActions('https://example.com/a.json');
        await service.fetchPredefinedActions('https://example.com/b.json');
        await service.clearCache();

        expect(Object.keys(store)).toHaveLength(0);
    });

    describe('getAllActions', () => {
        it('returns the bundled utility pack with no remote sources configured', async () => {
            const settings: ISettingsModel = { ...defaultSettings, predefinedActionsUrl: '' };
            const actions = await service.getAllActions(settings);

            expect(actions.length).toBeGreaterThan(30);
            expect(actions.every(a => a.packId === 'file-and-utility-functions')).toBe(true);
        });

        it('omits the utility pack when it is turned off', async () => {
            const settings: ISettingsModel = { ...defaultSettings, showUtilityActions: false };
            expect(await service.getAllActions(settings)).toEqual([]);
        });

        it('merges bundled and remote sources', async () => {
            global.fetch = jest.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve([buildRemoteAction('Remote One')]) } as Response)
            ) as any;

            const settings: ISettingsModel = {
                ...defaultSettings,
                predefinedActionsUrl: 'https://example.com/a.json',
            };
            const actions = await service.getAllActions(settings);

            expect(actions.some(a => a.packId === 'file-and-utility-functions')).toBe(true);
            expect(actions.some(a => a.title === 'Remote One')).toBe(true);
        });

        it('keeps the bundled pack when a remote source fails', async () => {
            global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;

            const settings: ISettingsModel = {
                ...defaultSettings,
                predefinedActionsUrl: 'https://example.com/a.json',
            };
            const actions = await service.getAllActions(settings);

            expect(actions.length).toBeGreaterThan(30);
        });

        it('applies the configured base url and key to bundled presets', async () => {
            const settings: ISettingsModel = {
                ...defaultSettings,
                utilityFunctionBaseUrl: 'https://my-utils.azurewebsites.net',
                utilityFunctionKey: 'topsecret',
            };
            const actions = await service.getAllActions(settings);
            const merge = actions.find(a => a.id === 'utility-merge_pdf_fitz')!;

            expect(merge.url).toBe('https://my-utils.azurewebsites.net/api/merge_pdf_fitz?code=topsecret');
        });

        it('excludes eval-backed endpoints unless opted in', async () => {
            const off = await service.getAllActions({ ...defaultSettings });
            expect(off.some(a => a.id === 'utility-py_filter')).toBe(false);

            const on = await service.getAllActions({ ...defaultSettings, includeUnsafeUtilityActions: true });
            expect(on.some(a => a.id === 'utility-py_filter')).toBe(true);
        });

        it('adds Parse JSON companions only when enabled', async () => {
            const off = await service.getAllActions({ ...defaultSettings });
            expect(off.some(a => a.id.startsWith('utility-parse-'))).toBe(false);

            const on = await service.getAllActions({ ...defaultSettings, showUtilityParseJsonActions: true });
            expect(on.some(a => a.id === 'utility-parse-merge_pdf_fitz')).toBe(true);
        });
    });

    describe('getCategories', () => {
        it('returns distinct categories in first-seen order', () => {
            const actions = [
                { category: 'PDF' }, { category: 'PDF' }, { category: 'Excel & CSV' },
            ] as IActionModel[];

            expect(service.getCategories(actions)).toEqual(['PDF', 'Excel & CSV']);
        });

        it('ignores actions without a category', () => {
            expect(service.getCategories([{ title: 'x' } as IActionModel])).toEqual([]);
        });
    });
});
