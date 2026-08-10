import { useEffect, useState } from 'react';
import { ThemeMode } from '../models/ISettingsModel';
import { applyThemeAttribute, loadFluentTheme, ResolvedTheme, resolveTheme } from './fluentTheme';

const SETTINGS_KEY = 'appSettings';

/**
 * Theme for surfaces that are not the popup (the flow editor and flows list open
 * as their own tabs). Reads the stored preference, follows the OS when it is set
 * to "system", and reacts to the popup changing it while the tab is open.
 */
export const useResolvedTheme = (): ResolvedTheme => {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme('system'));

  // Load the stored preference once
  useEffect(() => {
    let cancelled = false;

    chrome.storage?.local?.get(SETTINGS_KEY, (result) => {
      if (cancelled || chrome.runtime.lastError) {
        return;
      }
      const stored = result?.[SETTINGS_KEY]?.theme as ThemeMode | undefined;
      if (stored) {
        setMode(stored);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Follow changes made from the popup's settings pane
  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) {
        return;
      }
      const next = changes[SETTINGS_KEY].newValue?.theme as ThemeMode | undefined;
      if (next) {
        setMode(next);
      }
    };

    chrome.storage?.onChanged?.addListener(onChanged);
    return () => chrome.storage?.onChanged?.removeListener(onChanged);
  }, []);

  // Re-resolve whenever the preference changes, and while on "system" follow the OS
  useEffect(() => {
    applyThemeAttribute(mode);
    setResolved(resolveTheme(mode));

    if (mode !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => setResolved(resolveTheme('system'));
    query.addEventListener('change', onSystemChange);
    return () => query.removeEventListener('change', onSystemChange);
  }, [mode]);

  // Portalled surfaces (panels, callouts) miss the ThemeProvider tree
  useEffect(() => {
    loadFluentTheme(resolved);
  }, [resolved]);

  return resolved;
};
