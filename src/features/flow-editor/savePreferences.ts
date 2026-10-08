// "Confirm before saving" preferences. Every storage access is guarded: storage can
// be unavailable (blocked site data) and a confirmation must never break saving.

const SKIP_SAVE_CONFIRM_KEY = 'paToolkit.flowEditor.skipSaveConfirm';
const SESSION_CONFIRMED_KEY = 'paToolkit.flowEditor.saveConfirmedThisSession';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // ignore: the preference simply is not remembered
  }
}

/** Ask before the first save of each browser session, unless the user opted out. */
export function shouldConfirmSave(): boolean {
  if (read(() => window.localStorage, SKIP_SAVE_CONFIRM_KEY) === 'true') return false;
  return read(() => window.sessionStorage, SESSION_CONFIRMED_KEY) !== 'true';
}

export function rememberSaveConfirmed(dontAskAgain: boolean) {
  write(() => window.sessionStorage, SESSION_CONFIRMED_KEY, 'true');
  if (dontAskAgain) write(() => window.localStorage, SKIP_SAVE_CONFIRM_KEY, 'true');
}

export function resetSaveConfirmation() {
  write(() => window.localStorage, SKIP_SAVE_CONFIRM_KEY, null);
  write(() => window.sessionStorage, SESSION_CONFIRMED_KEY, null);
}

/** Generic per-viewer preference used for the editor view mode. */
export function readPreference(key: string): string | null {
  return read(() => window.localStorage, key);
}

export function writePreference(key: string, value: string) {
  write(() => window.localStorage, key, value);
}

// --- Save method (per environment) -------------------------------------------
// Stored in chrome.storage.local under `flowEditorSaveMode:<envId>` so it is
// shared by every editor tab; localStorage is the fallback when the extension
// storage API is unavailable or fails.

export type StoredSaveMode = 'flow' | 'dataverse';

export const saveModeKey = (envId: string) => `flowEditorSaveMode:${envId}`;

function chromeLocalStorage(): chrome.storage.LocalStorageArea | undefined {
  try {
    return typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : undefined;
  } catch {
    return undefined;
  }
}

const asSaveMode = (value: unknown): StoredSaveMode => (value === 'dataverse' ? 'dataverse' : 'flow');

/** The save method chosen for an environment; 'flow' unless the user picked Dataverse. */
export async function readSaveMode(envId: string): Promise<StoredSaveMode> {
  const key = saveModeKey(envId);
  const area = chromeLocalStorage();
  if (area) {
    try {
      const items = await area.get(key);
      if (items && key in items) return asSaveMode(items[key]);
    } catch {
      // fall through to localStorage
    }
  }
  return asSaveMode(read(() => window.localStorage, key));
}

export async function writeSaveMode(envId: string, mode: StoredSaveMode): Promise<void> {
  const key = saveModeKey(envId);
  const area = chromeLocalStorage();
  if (area) {
    try {
      await area.set({ [key]: mode });
      // Keep the fallback in step so a later failing chrome.storage read agrees.
      write(() => window.localStorage, key, mode);
      return;
    } catch {
      // fall through to localStorage
    }
  }
  write(() => window.localStorage, key, mode);
}
