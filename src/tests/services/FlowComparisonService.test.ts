import {
  BaselineStore,
  chromeBaselineStore,
  FlowComparisonService,
  localBaselineStore,
} from '../../services/FlowComparisonService';

function memoryStore(): BaselineStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
}

const flow = (actions: Record<string, unknown>) => ({
  $schema: 'x',
  connectionReferences: { a: 1 },
  definition: { actions },
});

describe('FlowComparisonService baselines', () => {
  it('keeps one baseline per environment and flow', async () => {
    const store = memoryStore();
    const service = new FlowComparisonService(store);

    await service.saveBaseline('env', 'flow-a', flow({ A: {} }), { label: '  Before  ', now: new Date(2026, 9, 3, 14, 2) });
    await service.saveBaseline('env', 'flow-b', flow({ B: {} }));

    const a = await service.getBaseline('env', 'flow-a');
    expect(a?.label).toBe('Before');
    expect(a?.definition).toEqual({ definition: { actions: { A: {} } } });
    expect(FlowComparisonService.formatSavedAt(a!.savedAt, new Date(2026, 9, 8))).toBe('3 Oct 14:02');
    expect((await service.getBaseline('env', 'flow-b'))?.definition.definition.actions).toEqual({ B: {} });
    expect(await service.getBaseline('other-env', 'flow-a')).toBeNull();
    expect(Array.from(store.data.keys())).toEqual(['flowBaseline:env:flow-a', 'flowBaseline:env:flow-b']);
  });

  it('compares the editor against the stored baseline', async () => {
    const service = new FlowComparisonService(memoryStore());
    const baseline = await service.saveBaseline('env', 'f', flow({ A: { type: 'Compose' } }));
    const result = service.compareWithBaseline(baseline, flow({ A: { type: 'Compose' }, B: { type: 'Http' } }));

    expect(result.newItems.map((d) => d.pathString)).toEqual(['definition.actions.B']);
  });

  it('clears a baseline', async () => {
    const service = new FlowComparisonService(memoryStore());
    await service.saveBaseline('env', 'f', flow({}));
    await service.clearBaseline('env', 'f');
    expect(await service.getBaseline('env', 'f')).toBeNull();
  });

  it('surfaces storage failures to the caller', async () => {
    const failing: BaselineStore = {
      get: async () => {
        throw new Error('quota');
      },
      set: async () => {
        throw new Error('QuotaExceededError');
      },
      remove: async () => undefined,
    };
    const service = new FlowComparisonService(failing);
    await expect(service.saveBaseline('e', 'f', flow({}))).rejects.toThrow('QuotaExceededError');
    await expect(service.getBaseline('e', 'f')).rejects.toThrow('quota');
  });

  it('shows the year only for older baselines', () => {
    expect(FlowComparisonService.formatSavedAt(new Date(2025, 0, 5, 9, 7).toISOString(), new Date(2026, 1, 1))).toBe(
      '5 Jan 2025 09:07'
    );
  });
});

describe('baseline stores', () => {
  it('localStorage round-trips JSON', async () => {
    window.localStorage.clear();
    const store = localBaselineStore();
    await store.set('k', { a: 1 });
    expect(await store.get('k')).toEqual({ a: 1 });
    await store.remove('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('chrome.storage rejects with runtime.lastError', async () => {
    const lastError = { message: 'QUOTA_BYTES quota exceeded' };
    (global as any).chrome = { runtime: { lastError: undefined } };
    const area = {
      get: (_key: string, done: (r: any) => void) => done({ k: { a: 1 } }),
      set: (_v: any, done: () => void) => {
        (global as any).chrome.runtime.lastError = lastError;
        done();
        (global as any).chrome.runtime.lastError = undefined;
      },
      remove: (_k: string, done: () => void) => done(),
    } as unknown as chrome.storage.StorageArea;

    const store = chromeBaselineStore(area);
    expect(await store.get('k')).toEqual({ a: 1 });
    await expect(store.set('k', {})).rejects.toThrow('QUOTA_BYTES quota exceeded');
    delete (global as any).chrome;
  });
});
