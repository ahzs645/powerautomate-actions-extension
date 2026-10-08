import { FunctionKeyMode } from '../services/UtilityActionsService';

export type ViewMode = 'popup' | 'sidepanel';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface ISettingsModel {
  isRecordingPage?: boolean | null;
  isClassicPowerAutomatePage?: boolean | null;
  isModernPowerAutomatePage?: boolean | null;
  maximumRecordingTimeMinutes?: number | null;
  /**
   * @deprecated Nothing reads it: the search bar is always shown. Kept so
   * stored settings from older versions still type-check.
   */
  showActionSearchBar?: boolean;
  recordingStartTime?: number | null;
  showPredefinedActions?: boolean;
  predefinedActionsUrl?: string;
  viewMode?: ViewMode;
  theme?: ThemeMode;

  /** Show the bundled utility function pack in the Predefined tab. */
  showUtilityActions?: boolean;
  /** Function App origin, e.g. https://my-utils.azurewebsites.net */
  utilityFunctionBaseUrl?: string;
  /**
   * Function key. Stored unencrypted in chrome.storage.local, so it is opt-in,
   * masked in the UI, and always stripped from exports. Prefer 'parameter' mode
   * for anything solution-bound.
   */
  utilityFunctionKey?: string;
  /** 'inline' writes the key into the URI; 'parameter' emits @{parameters(...)}. */
  utilityFunctionKeyMode?: FunctionKeyMode;
  utilityFunctionBaseUrlParameterName?: string;
  utilityFunctionKeyParameterName?: string;
  /** Include the four eval()-backed endpoints in the pack. */
  includeUnsafeUtilityActions?: boolean;
  /** Offer a companion Parse JSON action alongside each utility preset. */
  showUtilityParseJsonActions?: boolean;
  /** Scrub tenant metadata and secrets when exporting favorites. */
  sanitizeOnExport?: boolean;
  loadDefaultPredefinedActions?: boolean;
  /**
   * Master switch read by the background worker and content scripts as
   * `appSettings.extensionEnabled`. Absent means on. When off: no token
   * capture, no recording and no designer button.
   */
  extensionEnabled?: boolean;
  /** Show the "Edit JSON" button in the flow designer command bar. Absent means on. */
  showDesignerButton?: boolean;
}

export const defaultSettings: ISettingsModel = {
  isRecordingPage: null,
  isClassicPowerAutomatePage: null,
  isModernPowerAutomatePage: null,
  maximumRecordingTimeMinutes: null,
  showActionSearchBar: true,
  recordingStartTime: null,
  showPredefinedActions: true,
  predefinedActionsUrl: '',
  viewMode: 'popup',
  theme: 'system',

  showUtilityActions: true,
  utilityFunctionBaseUrl: '',
  utilityFunctionKey: '',
  utilityFunctionKeyMode: 'inline',
  utilityFunctionBaseUrlParameterName: 'AzureFunctionBaseUrl',
  utilityFunctionKeyParameterName: 'AzureFunctionKey',
  includeUnsafeUtilityActions: false,
  showUtilityParseJsonActions: false,
  sanitizeOnExport: true,
  loadDefaultPredefinedActions: true,
  extensionEnabled: true,
  showDesignerButton: true,
};
