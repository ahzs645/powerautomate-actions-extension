import { readSaveMode, saveModeKey, writeSaveMode } from '../../features/flow-editor/savePreferences';

describe('per-environment save method', () => {
  const g = global as any;
  let store: Record<string, any>;

  beforeEach(() => {
    store = {};
    window.localStorage.clear();
    g.chrome = {
      storage: {
        local: {
          get: jest.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
          set: jest.fn(async (items: Record<string, any>) => Object.assign(store, items)),
        },
      },
    };
  });

  afterEach(() => {
    delete g.chrome;
  });

  test('defaults to the Flow service', async () => {
    expect(await readSaveMode('env-1')).toBe('flow');
  });

  test('is stored per environment in chrome.storage.local', async () => {
    await writeSaveMode('env-1', 'dataverse');
    expect(store).toEqual({ 'flowEditorSaveMode:env-1': 'dataverse' });
    expect(await readSaveMode('env-1')).toBe('dataverse');
    expect(await readSaveMode('env-2')).toBe('flow');
  });

  test('ignores unknown stored values', async () => {
    store[saveModeKey('env-1')] = 'something-else';
    expect(await readSaveMode('env-1')).toBe('flow');
  });

  test('falls back to localStorage when chrome.storage fails or is missing', async () => {
    g.chrome.storage.local.set = jest.fn().mockRejectedValue(new Error('quota'));
    g.chrome.storage.local.get = jest.fn().mockRejectedValue(new Error('gone'));
    await writeSaveMode('env-1', 'dataverse');
    expect(window.localStorage.getItem('flowEditorSaveMode:env-1')).toBe('dataverse');
    expect(await readSaveMode('env-1')).toBe('dataverse');

    delete g.chrome;
    expect(await readSaveMode('env-1')).toBe('dataverse');
    await writeSaveMode('env-1', 'flow');
    expect(await readSaveMode('env-1')).toBe('flow');
  });
});
