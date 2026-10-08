import React, { useCallback, useEffect, useState, useRef } from 'react';
import { DefaultButton, IconButton, PrimaryButton, ChoiceGroup, IChoiceGroupOption, Icon, Label, MessageBar, MessageBarType, SpinButton, Stack, Text, TextField, Toggle, TooltipHost } from '@fluentui/react';
import { IStorageService } from '../services/interfaces';
import { actionSanitizer } from '../services/ActionSanitizer';
import { FunctionKeyMode } from '../services/UtilityActionsService';
import { ISettingsModel, defaultSettings, IActionModel, ViewMode, ThemeMode } from '../models';
import { IAnalysisConfig, IRatingThresholds, defaultAnalysisConfig, IAnalysisConfigExport, ANALYSIS_CONFIG_VERSION } from '../config/AnalysisConfig';
import { GlobalPlaceholders, PlaceholderService } from '../services/PlaceholderService';

export type SettingsSectionKey = 'general' | 'recording' | 'library' | 'placeholders' | 'favorites' | 'analysis' | 'naming';
/** A section, or 'utility' for the Function App block inside Library. */
export type SettingsFocus = SettingsSectionKey | 'utility';

type FeedbackKey = 'favorites' | 'config' | 'thresholds' | 'reset';
type Feedback = { text: string; type: MessageBarType };

interface SettingsProps {
  storageService: IStorageService;
  onSettingsChange?: (settings: ISettingsModel) => void;
  onFavoritesImported?: () => void;
  placeholderService?: PlaceholderService;
  /** Renders a Back button in the header. */
  onBack?: () => void;
  /** Section to open and scroll to on mount. */
  focusSection?: SettingsFocus | null;
  /** Sections open on mount; 'all' opens every one. Defaults to General. */
  defaultExpanded?: SettingsSectionKey[] | 'all';
}

interface ISettingsSectionProps {
  id: SettingsSectionKey;
  title: string;
  description: string;
  expanded: boolean;
  onToggle: (id: SettingsSectionKey) => void;
  children: React.ReactNode;
}

const SettingsSection: React.FC<ISettingsSectionProps> = ({ id, title, description, expanded, onToggle, children }) => (
  <section className={`settings-section${expanded ? ' is-expanded' : ''}`} id={`settings-${id}`}>
    <h3 className="settings-section-heading">
      <button
        type="button"
        className="settings-section-toggle"
        aria-expanded={expanded}
        aria-controls={`settings-${id}-body`}
        onClick={() => onToggle(id)}
      >
        <Icon iconName="ChevronRight" className="settings-section-chevron" aria-hidden="true" />
        <span className="settings-section-text">
          <span className="settings-section-title">{title}</span>
          <span className="settings-section-description">{description}</span>
        </span>
      </button>
    </h3>
    {expanded && (
      <div className="settings-section-body" id={`settings-${id}-body`}>
        <Stack tokens={{ childrenGap: 12 }}>{children}</Stack>
      </div>
    )}
  </section>
);

/** Small info glyph with a tooltip, keyboard-focusable. */
const InfoTip: React.FC<{ content: string; testId?: string }> = ({ content, testId }) => (
  <TooltipHost content={content} styles={{ root: { display: 'inline-flex' } }}>
    <Icon
      iconName="Info"
      className="settings-info-icon"
      data-testid={testId}
      tabIndex={0}
      aria-label={content}
      role="img"
    />
  </TooltipHost>
);

/** A labelled switch row with an optional one-line hint. */
const ToggleRow: React.FC<{
  label: string;
  hint?: string;
  info?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (event: React.MouseEvent<HTMLElement>, checked?: boolean) => void;
}> = ({ label, hint, info, checked, disabled, onChange }) => (
  <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
    <Stack styles={{ root: { flex: 1, minWidth: 0 } }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 6 }}>
        <Text>{label}</Text>
        {info && <InfoTip content={info} />}
      </Stack>
      {hint && <Text variant="small" className="settings-hint">{hint}</Text>}
    </Stack>
    <Toggle checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} styles={{ root: { marginBottom: 0 } }} />
  </Stack>
);

const InlineFeedback: React.FC<{ feedback?: Feedback; onDismiss: () => void }> = ({ feedback, onDismiss }) => (
  feedback ? (
    <MessageBar
      messageBarType={feedback.type}
      isMultiline={true}
      onDismiss={onDismiss}
      dismissButtonAriaLabel="Close"
      className="settings-feedback"
    >
      {feedback.text}
    </MessageBar>
  ) : null
);

const ALL_SECTIONS: SettingsSectionKey[] = ['general', 'recording', 'library', 'placeholders', 'favorites', 'analysis', 'naming'];

const Settings: React.FC<SettingsProps> = ({ storageService, onSettingsChange, onFavoritesImported, placeholderService, onBack, focusSection, defaultExpanded }) => {
  const [settings, setSettings] = useState<ISettingsModel>(defaultSettings);
  const [analysisConfig, setAnalysisConfig] = useState<IAnalysisConfig>(defaultAnalysisConfig);
  const [feedback, setFeedback] = useState<Partial<Record<FeedbackKey, Feedback>>>({});
  const [globalPlaceholders, setGlobalPlaceholders] = useState<GlobalPlaceholders>({});
  const [newPlaceholderKey, setNewPlaceholderKey] = useState('');
  const [newPlaceholderValue, setNewPlaceholderValue] = useState('');
  const [newVariantInputs, setNewVariantInputs] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<SettingsSectionKey>>(() => {
    const initial = new Set<SettingsSectionKey>(defaultExpanded === 'all' ? ALL_SECTIONS : (defaultExpanded ?? ['general']));
    if (focusSection) { initial.add(focusSection === 'utility' ? 'library' : focusSection); }
    return initial;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configFileInputRef = useRef<HTMLInputElement>(null);

  const toggleSection = useCallback((id: SettingsSectionKey) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  // Opening at a section (e.g. from the "set the Function App URL" warning)
  // scrolls it into view once it has rendered.
  useEffect(() => {
    if (!focusSection) { return; }
    const target = document.getElementById(`settings-${focusSection}`);
    target?.scrollIntoView?.({ block: 'start' });
    const field = focusSection === 'utility' ? document.getElementById('settings-utility-url') : null;
    field?.focus?.();
  }, [focusSection]);

  const showFeedback = useCallback((key: FeedbackKey, value: Feedback) => {
    setFeedback(prev => ({ ...prev, [key]: value }));
  }, []);

  const dismissFeedback = useCallback((key: FeedbackKey) => {
    setFeedback(prev => ({ ...prev, [key]: undefined }));
  }, []);

  const loadGlobalPlaceholders = useCallback(async () => {
    if (!placeholderService) return;
    const globals = await placeholderService.getGlobalPlaceholders();
    setGlobalPlaceholders(globals);
  }, [placeholderService]);

  useEffect(() => {
    loadGlobalPlaceholders();
  }, [loadGlobalPlaceholders]);

  useEffect(() => {
    storageService.getSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
    });
    storageService.getAnalysisConfig().then((loadedConfig) => {
      setAnalysisConfig(loadedConfig);
    });
  }, [storageService]);

  const handlePageModeChange = useCallback(async (ev?: React.FormEvent<HTMLElement | HTMLInputElement>, option?: IChoiceGroupOption) => {
    if (!option) return;
    
    const updates: Partial<ISettingsModel> = {
      isRecordingPage: option.key === 'recording' ? true : false,
      isClassicPowerAutomatePage: option.key === 'classic' ? true : false,
      isModernPowerAutomatePage: option.key === 'modern' ? true : false,
    };
    
    if (option.key === 'none') {
      updates.isRecordingPage = false;
      updates.isClassicPowerAutomatePage = false;
      updates.isModernPowerAutomatePage = false;
    }
    
    const updatedSettings = await storageService.updateSettings(updates);
    setSettings(updatedSettings);
    
    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }
  }, [storageService, onSettingsChange]);

  const handleMaximumRecordingTimeChange = useCallback(async (value: string | undefined) => {
    const numValue = value ? parseInt(value, 10) : null;
    const newValue = (!isNaN(numValue!) && numValue! > 0) ? numValue : null;
    const updatedSettings = await storageService.updateSettings({ maximumRecordingTimeMinutes: newValue });
    setSettings(updatedSettings);
  }, [storageService]);

  const getCurrentPageMode = useCallback((): string => {
    if (settings.isRecordingPage === true) return 'recording';
    if (settings.isClassicPowerAutomatePage === true) return 'classic';
    if (settings.isModernPowerAutomatePage === true) return 'modern';
    return 'none';
  }, [settings]);

  const handleShowPredefinedActionsChange = useCallback(async (event: React.MouseEvent<HTMLElement>, checked?: boolean) => {
    const newValue = checked ?? true;
    const updatedSettings = await storageService.updateSettings({ showPredefinedActions: newValue });
    setSettings(updatedSettings);
    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }
  }, [storageService, onSettingsChange]);

  const handlePredefinedActionsUrlChange = useCallback(async (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
    const url = newValue || '';
    const updatedSettings = await storageService.updateSettings({ predefinedActionsUrl: url });
    setSettings(updatedSettings);
    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }
  }, [storageService, onSettingsChange]);

  // Utility function pack settings. Every one of these changes the generated
  // presets, so each notifies the app to re-materialize the list.
  const updateAndNotify = useCallback(async (partial: Partial<ISettingsModel>) => {
    const updatedSettings = await storageService.updateSettings(partial);
    setSettings(updatedSettings);
    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }
  }, [storageService, onSettingsChange]);

  const handleLoadDefaultPredefinedActionsChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ loadDefaultPredefinedActions: checked ?? true }),
    [updateAndNotify]);

  const handleShowUtilityActionsChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ showUtilityActions: checked ?? true }),
    [updateAndNotify]);

  const handleUtilityBaseUrlChange = useCallback(
    (_e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) =>
      updateAndNotify({ utilityFunctionBaseUrl: (newValue || '').trim() }),
    [updateAndNotify]);

  const handleUtilityKeyChange = useCallback(
    (_e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) =>
      updateAndNotify({ utilityFunctionKey: (newValue || '').trim() }),
    [updateAndNotify]);

  const handleUtilityKeyModeChange = useCallback(
    (_e?: React.FormEvent<HTMLElement | HTMLInputElement>, option?: IChoiceGroupOption) => {
      if (!option) return;
      return updateAndNotify({ utilityFunctionKeyMode: option.key as FunctionKeyMode });
    },
    [updateAndNotify]);

  const handleUtilityBaseUrlParameterChange = useCallback(
    (_e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) =>
      updateAndNotify({ utilityFunctionBaseUrlParameterName: (newValue || '').trim() }),
    [updateAndNotify]);

  const handleUtilityKeyParameterChange = useCallback(
    (_e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) =>
      updateAndNotify({ utilityFunctionKeyParameterName: (newValue || '').trim() }),
    [updateAndNotify]);

  const handleShowParseJsonChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ showUtilityParseJsonActions: checked ?? false }),
    [updateAndNotify]);

  const handleIncludeUnsafeChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ includeUnsafeUtilityActions: checked ?? false }),
    [updateAndNotify]);

  // Read by the background worker and content scripts as appSettings.*;
  // absent counts as on, so only an explicit false turns either off.
  const handleExtensionEnabledChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ extensionEnabled: checked ?? true }),
    [updateAndNotify]);

  const handleShowDesignerButtonChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ showDesignerButton: checked ?? true }),
    [updateAndNotify]);

  const handleSanitizeOnExportChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, checked?: boolean) =>
      updateAndNotify({ sanitizeOnExport: checked ?? true }),
    [updateAndNotify]);

  const [surfaceHint, setSurfaceHint] = useState<string | null>(null);
  const currentSurface = document.documentElement.dataset.surface as ViewMode | undefined;

  const handleViewModeChange = useCallback(async (ev?: React.FormEvent<HTMLElement | HTMLInputElement>, option?: IChoiceGroupOption) => {
    if (!option) return;
    const newMode = option.key as ViewMode;
    const updatedSettings = await storageService.updateSettings({ viewMode: newMode });
    setSettings(updatedSettings);

    // Notify the background script to switch surface mode
    chrome.runtime.sendMessage({ type: 'set-view-mode', mode: newMode });

    // Show migration hint
    const activeSurface = currentSurface || 'popup';
    if (newMode !== activeSurface) {
      if (activeSurface === 'sidepanel' && newMode === 'popup') {
        setSurfaceHint('Popup mode is on. Close this side panel and click the extension icon to open the popup.');
      } else if (activeSurface === 'popup' && newMode === 'sidepanel') {
        setSurfaceHint('Side panel mode is on. Close this popup and click the extension icon to open the side panel.');
      }
    } else {
      setSurfaceHint(null);
    }

    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }
  }, [storageService, onSettingsChange, currentSurface]);

  const handleThemeChange = useCallback(async (ev?: React.FormEvent<HTMLElement | HTMLInputElement>, option?: IChoiceGroupOption) => {
    if (!option) return;
    const newTheme = option.key as ThemeMode;
    const updatedSettings = await storageService.updateSettings({ theme: newTheme });
    setSettings(updatedSettings);

    // Apply theme to document immediately
    if (newTheme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = newTheme;
    }

    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }
  }, [storageService, onSettingsChange]);

  const handleDeleteGlobalPlaceholder = useCallback(async (key: string) => {
    if (!placeholderService) return;
    const updated = await placeholderService.deleteGlobalPlaceholder(key);
    setGlobalPlaceholders({ ...updated });
  }, [placeholderService]);

  const handleResetAllGlobalPlaceholders = useCallback(async () => {
    if (!placeholderService) return;
    await placeholderService.clearGlobalPlaceholders();
    setGlobalPlaceholders({});
  }, [placeholderService]);

  const handleRemoveGlobalPlaceholderVariant = useCallback(async (key: string, value: string) => {
    if (!placeholderService) return;
    const updated = await placeholderService.removeGlobalPlaceholderValue(key, value);
    setGlobalPlaceholders({ ...updated });
  }, [placeholderService]);

  const handleUpdateGlobalPlaceholderVariant = useCallback(async (key: string, oldValue: string, newValue: string) => {
    if (!placeholderService) return;
    const updated = await placeholderService.updateGlobalPlaceholderValue(key, oldValue, newValue);
    setGlobalPlaceholders({ ...updated });
  }, [placeholderService]);

  const handleAddGlobalPlaceholder = useCallback(async () => {
    const key = newPlaceholderKey.trim().toUpperCase().replace(/\s+/g, '_');
    const value = newPlaceholderValue.trim();
    if (!key || !value || !placeholderService) return;
    const updated = await placeholderService.addGlobalPlaceholderValue(key, value);
    setGlobalPlaceholders({ ...updated });
    setNewPlaceholderKey('');
    setNewPlaceholderValue('');
  }, [newPlaceholderKey, newPlaceholderValue, placeholderService]);

  const handleAddVariantToKey = useCallback(async (key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !placeholderService) return;
    const updated = await placeholderService.addGlobalPlaceholderValue(key, trimmed);
    setGlobalPlaceholders({ ...updated });
  }, [placeholderService]);

  const handleExport = useCallback(async () => {
    try {
      const favorites = await storageService.getFavoriteActions();
      
      if (!favorites || favorites.length === 0) {
        showFeedback('favorites', { text: 'No favorite actions to export', type: MessageBarType.warning });
        return;
      }

      // Recorded and copied actions carry drive item ids, filenames, tenant
      // emails and any function key in the URI. Scrub before the file leaves
      // the browser unless the user has explicitly opted out.
      const shouldSanitize = settings.sanitizeOnExport ?? true;
      const result = shouldSanitize
        ? actionSanitizer.sanitizeActions(favorites)
        : { value: favorites, report: null };

      const dataStr = JSON.stringify(result.value, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `power-automate-favorites-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const scrubSummary = result.report ? actionSanitizer.describeReport(result.report) : null;
      showFeedback('favorites', {
        text: `Successfully exported ${favorites.length} favorite action(s)`
          + (scrubSummary ? `. ${scrubSummary}.` : ''),
        type: MessageBarType.success,
      });
    } catch (error) {
      showFeedback('favorites', { text: 'Failed to export favorites', type: MessageBarType.error });
      console.error('Export error:', error);
    }
  }, [storageService, settings.sanitizeOnExport, showFeedback]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      showFeedback('favorites', { text: 'Please select a valid JSON file', type: MessageBarType.error });
      return;
    }

    try {
      const fileContent = await file.text();
      const importedActions: IActionModel[] = JSON.parse(fileContent);

      if (!Array.isArray(importedActions)) {
        showFeedback('favorites', { text: 'Invalid file format: Expected an array of actions', type: MessageBarType.error });
        return;
      }

      // Validate that each item has the required IActionModel properties
      const isValid = importedActions.every(action =>
        action.id && action.title && action.actionJson
      );

      if (!isValid) {
        showFeedback('favorites', { text: 'Invalid file format: Missing required action properties', type: MessageBarType.error });
        return;
      }

      const existingFavorites = await storageService.getFavoriteActions();
      // Merge rather than replace: skip ids already stored and repeats within the file.
      const seenIds = new Set(existingFavorites.map(a => a.id));
      const newActions = importedActions.filter(a => {
        if (seenIds.has(a.id)) { return false; }
        seenIds.add(a.id);
        return true;
      });
      await storageService.setFavoriteActions([...existingFavorites, ...newActions]);
      showFeedback('favorites', { text: `Successfully imported ${newActions.length} new favorite action(s) (${importedActions.length - newActions.length} duplicate(s) skipped)`, type: MessageBarType.success });

      // Trigger favorites list refresh
      if (onFavoritesImported) {
        onFavoritesImported();
      }
    } catch (error) {
      showFeedback('favorites', { text: 'Failed to import favorites: Invalid JSON format', type: MessageBarType.error });
      console.error('Import error:', error);
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [storageService, onFavoritesImported, showFeedback]);

  // Analysis Configuration Handlers
  const handleThresholdChange = useCallback(async (field: keyof IRatingThresholds, value: string | undefined) => {
    const numValue = value ? parseInt(value, 10) : 0;
    if (isNaN(numValue)) return;

    const newThresholds = {
      ...analysisConfig.ratingThresholds,
      [field]: numValue
    };

    const updatedConfig = await storageService.updateAnalysisConfig({
      ratingThresholds: newThresholds
    });
    setAnalysisConfig(updatedConfig);
    showFeedback('thresholds', { text: 'Analysis threshold updated', type: MessageBarType.success });
  }, [analysisConfig, storageService, showFeedback]);

  const handleNamingPrefixChange = useCallback(async (type: string, newPrefix: string) => {
    const newConventions = analysisConfig.namingConfig.conventions.map(conv =>
      conv.type === type ? { ...conv, prefix: newPrefix } : conv
    );

    const updatedConfig = await storageService.updateAnalysisConfig({
      namingConfig: {
        ...analysisConfig.namingConfig,
        conventions: newConventions
      }
    });
    setAnalysisConfig(updatedConfig);
  }, [analysisConfig, storageService]);

  const handleResetAnalysisConfig = useCallback(async () => {
    const resetConfig = await storageService.resetAnalysisConfig();
    setAnalysisConfig(resetConfig);
    showFeedback('reset', { text: 'Analysis configuration reset to defaults', type: MessageBarType.success });
  }, [storageService, showFeedback]);

  // Config Export Handler
  const handleConfigExport = useCallback(async () => {
    try {
      const config = await storageService.getAnalysisConfig();
      const placeholders = placeholderService ? await placeholderService.getGlobalPlaceholders() : {};

      const exportData: IAnalysisConfigExport = {
        version: ANALYSIS_CONFIG_VERSION,
        exportDate: new Date().toISOString(),
        config: config,
        ...(Object.keys(placeholders).length > 0 ? { globalPlaceholders: placeholders } : {}),
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `analysis-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showFeedback('config', { text: 'Analysis configuration exported successfully', type: MessageBarType.success });
    } catch (error) {
      showFeedback('config', { text: 'Failed to export configuration', type: MessageBarType.error });
      console.error('Config export error:', error);
    }
  }, [storageService, placeholderService, showFeedback]);

  // Config Import Handler
  const handleConfigImport = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);

  const handleConfigFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      showFeedback('config', { text: 'Please select a valid JSON file', type: MessageBarType.error });
      return;
    }

    try {
      const fileContent = await file.text();
      const importedData: IAnalysisConfigExport = JSON.parse(fileContent);

      // Validate structure
      if (!importedData.config || !importedData.config.ratingThresholds) {
        showFeedback('config', { text: 'Invalid configuration file format', type: MessageBarType.error });
        return;
      }

      await storageService.updateAnalysisConfig(importedData.config);
      const updatedConfig = await storageService.getAnalysisConfig();
      setAnalysisConfig(updatedConfig);

      // Placeholder values are merged in as extra variants, never replacing
      // what the user already has.
      let importedPlaceholderCount = 0;
      if (placeholderService && importedData.globalPlaceholders && typeof importedData.globalPlaceholders === 'object') {
        for (const [key, values] of Object.entries(importedData.globalPlaceholders)) {
          if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !Array.isArray(values)) { continue; }
          for (const value of values) {
            if (typeof value === 'string' && value.trim() !== '') {
              await placeholderService.addGlobalPlaceholderValue(key, value.trim());
              importedPlaceholderCount++;
            }
          }
        }
        if (importedPlaceholderCount > 0) {
          await loadGlobalPlaceholders();
        }
      }

      showFeedback('config', {
        text: 'Analysis configuration imported successfully'
          + (importedPlaceholderCount > 0 ? ` (with ${importedPlaceholderCount} placeholder value(s))` : ''),
        type: MessageBarType.success,
      });
    } catch (error) {
      showFeedback('config', { text: 'Failed to import configuration: Invalid JSON format', type: MessageBarType.error });
      console.error('Config import error:', error);
    } finally {
      if (configFileInputRef.current) {
        configFileInputRef.current.value = '';
      }
    }
  }, [storageService, placeholderService, loadGlobalPlaceholders, showFeedback]);

  const sectionProps = (id: SettingsSectionKey) => ({ id, expanded: expanded.has(id), onToggle: toggleSection });

  const renderPlaceholderKeys = () => {
    if (!placeholderService) { return null; }
    const knownKeys = placeholderService.getKnownPlaceholderKeys();
    const allKeys = Array.from(new Set([...knownKeys, ...Object.keys(globalPlaceholders)])).sort();
    if (allKeys.length === 0) {
      return (
        <Text variant="small" className="settings-hint" styles={{ root: { fontStyle: 'italic' } }}>
          No global placeholders yet. Add one below.
        </Text>
      );
    }
    return allKeys.map((key) => {
      const isBuiltIn = placeholderService.hasKnownPlaceholderOptions(key);
      const builtInOptions = isBuiltIn ? placeholderService.getPlaceholderOptions(key, {}) : [];
      const userVariants = globalPlaceholders[key] ?? [];
      const builtInValues = new Set(builtInOptions.map(o => o.value));
      const editableVariants = userVariants.filter(v => !builtInValues.has(v));

      return (
        <Stack key={key} tokens={{ childrenGap: 6 }} className="settings-placeholder">
          <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
            <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 6 }}>
              <Label className="settings-placeholder-key">{`{{${key}}}`}</Label>
              {isBuiltIn && (
                <Text variant="small" className="settings-hint" styles={{ root: { fontStyle: 'italic' } }}>(built-in)</Text>
              )}
            </Stack>
            {!isBuiltIn && (
              <IconButton
                iconProps={{ iconName: 'Delete' }}
                title={`Remove {{${key}}} and all its variants`}
                ariaLabel={`Remove ${key}`}
                onClick={() => handleDeleteGlobalPlaceholder(key)}
                styles={{ root: { height: 24, width: 24 } }}
              />
            )}
          </Stack>

          {builtInOptions.map((option) => (
            <TooltipHost key={option.value} content={option.tooltip}>
              <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
                <Text variant="small" className="settings-placeholder-chip">{option.label}</Text>
                <TextField
                  value={option.value}
                  readOnly
                  ariaLabel={`${key} ${option.label}`}
                  styles={{ root: { flex: 1, minWidth: 0 }, field: { backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-fg-secondary)' } }}
                />
              </Stack>
            </TooltipHost>
          ))}

          {editableVariants.map((variant) => (
            <Stack key={variant} horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
              <TextField
                value={variant}
                ariaLabel={`${key} value`}
                onChange={(_e, val) => handleUpdateGlobalPlaceholderVariant(key, variant, val ?? '')}
                styles={{ root: { flex: 1, minWidth: 0 } }}
              />
              <IconButton
                iconProps={{ iconName: 'Cancel' }}
                ariaLabel={`Remove variant ${variant} from ${key}`}
                title="Remove variant"
                onClick={() => handleRemoveGlobalPlaceholderVariant(key, variant)}
                styles={{ root: { height: 28, width: 28 } }}
              />
            </Stack>
          ))}

          <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
            <TextField
              placeholder="Add another variant..."
              ariaLabel={`Add another value for ${key}`}
              value={newVariantInputs[key] ?? ''}
              onChange={(_e, val) => setNewVariantInputs(prev => ({ ...prev, [key]: val ?? '' }))}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleAddVariantToKey(key, newVariantInputs[key] ?? '');
                  setNewVariantInputs(prev => ({ ...prev, [key]: '' }));
                }
              }}
              styles={{ root: { flex: 1, minWidth: 0 } }}
            />
            <DefaultButton
              text="Add variant"
              iconProps={{ iconName: 'Add' }}
              onClick={() => {
                handleAddVariantToKey(key, newVariantInputs[key] ?? '');
                setNewVariantInputs(prev => ({ ...prev, [key]: '' }));
              }}
              disabled={!(newVariantInputs[key] ?? '').trim()}
            />
          </Stack>
        </Stack>
      );
    });
  };

  const threshold = (field: keyof IRatingThresholds, label: string, max: number, step: number) => (
    <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
      <Label htmlFor={`threshold-${field}`}>{label}</Label>
      <SpinButton
        inputProps={{ id: `threshold-${field}` }}
        value={String(analysisConfig.ratingThresholds[field])}
        min={0}
        max={max}
        step={step}
        onChange={(e, val) => handleThresholdChange(field, val)}
        styles={{ root: { width: 100 } }}
      />
    </Stack>
  );

  return (
    <div className="settings">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={configFileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleConfigFileChange}
      />

      <div className="settings-header">
        {onBack && (
          <TooltipHost content="Back to actions">
            <IconButton
              iconProps={{ iconName: 'Back' }}
              ariaLabel="Back to actions"
              onClick={onBack}
              className="settings-back"
            />
          </TooltipHost>
        )}
        <div className="settings-header-text">
          <h2 className="settings-title">Settings</h2>
          <Text variant="small" className="settings-hint">
            Configure how Power Automate Toolkit behaves
          </Text>
        </div>
      </div>

      <div className="settings-sections">
        <SettingsSection {...sectionProps('general')} title="General" description="Theme, surface and where the toolkit runs">
          <ToggleRow
            label="Enable toolkit on Power Automate pages"
            hint="Turns off token capture, recording and the designer button"
            checked={settings.extensionEnabled !== false}
            onChange={handleExtensionEnabledChange}
          />
          <ToggleRow
            label="Show 'Edit JSON' button in the flow designer"
            checked={settings.showDesignerButton !== false}
            disabled={settings.extensionEnabled === false}
            onChange={handleShowDesignerButtonChange}
          />
          <ChoiceGroup
            label="Theme"
            selectedKey={settings.theme || 'system'}
            onChange={handleThemeChange}
            options={[
              { key: 'system', text: 'System' },
              { key: 'light', text: 'Light' },
              { key: 'dark', text: 'Dark' },
            ]}
            styles={{ flexContainer: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', columnGap: '16px' } }}
          />
          <ChoiceGroup
            label="Open as"
            selectedKey={settings.viewMode || 'popup'}
            onChange={handleViewModeChange}
            options={[
              { key: 'popup', text: 'Popup' },
              { key: 'sidepanel', text: 'Side Panel' },
            ]}
            styles={{ flexContainer: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', columnGap: '16px' } }}
          />
          {surfaceHint && (
            <MessageBar
              messageBarType={MessageBarType.info}
              isMultiline={true}
              onDismiss={() => setSurfaceHint(null)}
              dismissButtonAriaLabel="Close"
            >
              {surfaceHint}
            </MessageBar>
          )}
        </SettingsSection>

        <SettingsSection {...sectionProps('recording')} title="Recording" description="Page detection and recording limits">
          <ChoiceGroup
            label="Page Detection Mode"
            selectedKey={getCurrentPageMode()}
            onChange={handlePageModeChange}
            options={[
              { key: 'none', text: 'Automatic Detection' },
              { key: 'recording', text: 'Recording Page Override' },
              { key: 'classic', text: 'Classic Power Automate Editor' },
              { key: 'modern', text: 'Modern Power Automate Editor' },
            ]}
          />
          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
            <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 6 }} styles={{ root: { flex: 1, minWidth: 0 } }}>
              <Label htmlFor="settings-max-recording">Maximum recording time (minutes)</Label>
              <InfoTip
                testId="recording-time-info-icon"
                content="Set a maximum duration for recording sessions. Leave empty for unlimited recording."
              />
            </Stack>
            <TextField
              id="settings-max-recording"
              value={settings.maximumRecordingTimeMinutes?.toString() || ''}
              onChange={(event, newValue) => handleMaximumRecordingTimeChange(newValue)}
              placeholder="No limit"
              type="number"
              min={1}
              styles={{ root: { width: 100 } }}
            />
          </Stack>
        </SettingsSection>

        <SettingsSection {...sectionProps('library')} title="Library" description="Predefined action packs and the utility function pack">
          <ToggleRow
            label="Show Predefined Actions"
            info="Display the Library tab with predefined action templates."
            checked={settings.showPredefinedActions ?? true}
            onChange={handleShowPredefinedActionsChange}
          />
          <ToggleRow
            label="Load Default Actions"
            info="Load the community catalog of predefined actions from the upstream project's GitHub folder (cached for 1 hour)."
            checked={settings.loadDefaultPredefinedActions ?? true}
            onChange={handleLoadDefaultPredefinedActionsChange}
          />
          <TextField
            label="Action pack URLs"
            value={settings.predefinedActionsUrl || ''}
            onChange={handlePredefinedActionsUrlChange}
            placeholder="https://gist.githubusercontent.com/username/gist-id/raw/predefined-actions.json"
            description="One raw JSON URL per line. Each source is cached for 1 hour. Tip: GitHub Gists are easy to edit."
            multiline
            rows={3}
          />

          <div className="settings-subsection" id="settings-utility">
            <h4 className="settings-subsection-title">Utility function pack</h4>
            <Text variant="small" className="settings-hint">
              Bundled HTTP presets for the File &amp; Utility Azure Functions app (PDF, Word, Excel, JSON and image operations)
            </Text>
          </div>

          <ToggleRow
            label="Show utility actions"
            checked={settings.showUtilityActions ?? true}
            onChange={handleShowUtilityActionsChange}
          />

          <TextField
            id="settings-utility-url"
            label="Function App URL"
            value={settings.utilityFunctionBaseUrl || ''}
            onChange={handleUtilityBaseUrlChange}
            placeholder="https://my-utils.azurewebsites.net"
            description="Origin only, no trailing slash. Presets append /api/<route>."
          />

          <ChoiceGroup
            label="Function key handling"
            selectedKey={settings.utilityFunctionKeyMode || 'inline'}
            options={[
              { key: 'inline', text: 'Store the key and write it into the URL' },
              { key: 'parameter', text: 'Emit @{parameters(...)} references instead' },
            ]}
            onChange={handleUtilityKeyModeChange}
          />

          {(settings.utilityFunctionKeyMode || 'inline') === 'inline' ? (
            <>
              <TextField
                label="Function key"
                type="password"
                canRevealPassword
                revealPasswordAriaLabel="Show function key"
                value={settings.utilityFunctionKey || ''}
                onChange={handleUtilityKeyChange}
                placeholder="Paste the function or host key"
              />
              <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                The key is stored unencrypted in extension storage and is written into
                every pasted action. It is always stripped from exports. For anything
                solution-bound, prefer the parameter option above.
              </MessageBar>
            </>
          ) : (
            <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
              <TextField
                label="Base URL parameter"
                value={settings.utilityFunctionBaseUrlParameterName || 'AzureFunctionBaseUrl'}
                onChange={handleUtilityBaseUrlParameterChange}
                styles={{ root: { flex: '1 1 140px' } }}
              />
              <TextField
                label="Key parameter"
                value={settings.utilityFunctionKeyParameterName || 'AzureFunctionKey'}
                onChange={handleUtilityKeyParameterChange}
                styles={{ root: { flex: '1 1 140px' } }}
              />
            </Stack>
          )}

          <ToggleRow
            label="Add companion Parse JSON actions"
            checked={settings.showUtilityParseJsonActions ?? false}
            onChange={handleShowParseJsonChange}
          />
          <ToggleRow
            label="Include eval-backed endpoints"
            hint="py_transform_array, py_filter, for_each_lookup, for_each_filter"
            checked={settings.includeUnsafeUtilityActions ?? false}
            onChange={handleIncludeUnsafeChange}
          />
          {settings.includeUnsafeUtilityActions && (
            <MessageBar messageBarType={MessageBarType.severeWarning} isMultiline>
              These four endpoints pass your expression to Python <code>eval()</code> with
              no sandbox. Anyone who can call them can run arbitrary code on the Function
              App. Only enable this for a function you control.
            </MessageBar>
          )}
        </SettingsSection>

        {placeholderService && (
          <SettingsSection {...sectionProps('placeholders')} title="Placeholders" description="Global values for {{PLACEHOLDER}} tokens in actions">
            <Stack horizontal horizontalAlign="space-between" verticalAlign="center" tokens={{ childrenGap: 8 }}>
              <Text variant="small" className="settings-hint" styles={{ root: { flex: 1, minWidth: 0 } }}>
                Values automatically used to fill in placeholders (e.g. <code>{'{{SITE_NAME}}'}</code>) across all actions
              </Text>
              <DefaultButton
                text="Reset all"
                iconProps={{ iconName: 'Delete' }}
                onClick={handleResetAllGlobalPlaceholders}
                disabled={Object.keys(globalPlaceholders).length === 0}
              />
            </Stack>

            {renderPlaceholderKeys()}

            <Stack tokens={{ childrenGap: 4 }}>
              <Text variant="small" styles={{ root: { fontWeight: 600 } }}>Add new placeholder</Text>
              <Stack horizontal wrap tokens={{ childrenGap: 8 }} verticalAlign="end">
                <TextField
                  label="Key"
                  placeholder="SITE_NAME"
                  value={newPlaceholderKey}
                  onChange={(_e, val) => setNewPlaceholderKey(val ?? '')}
                  styles={{ root: { flex: '1 1 120px' } }}
                />
                <TextField
                  label="Value"
                  placeholder="AcceleratorComm"
                  value={newPlaceholderValue}
                  onChange={(_e, val) => setNewPlaceholderValue(val ?? '')}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddGlobalPlaceholder(); }}
                  styles={{ root: { flex: '1 1 120px' } }}
                />
                <DefaultButton
                  text="Add"
                  iconProps={{ iconName: 'Add' }}
                  onClick={handleAddGlobalPlaceholder}
                  disabled={!newPlaceholderKey.trim() || !newPlaceholderValue.trim()}
                />
              </Stack>
              <Text variant="small" className="settings-hint" styles={{ root: { fontStyle: 'italic' } }}>
                Tip: using a key that already exists adds another variant to it instead of replacing it.
              </Text>
            </Stack>
          </SettingsSection>
        )}

        <SettingsSection {...sectionProps('favorites')} title="Favorites import/export" description="Move favorite actions between browsers as JSON">
          <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
            <PrimaryButton text="Import Favorites" onClick={handleImport} iconProps={{ iconName: 'Download' }} />
            <DefaultButton text="Export Favorites" onClick={handleExport} iconProps={{ iconName: 'Upload' }} />
          </Stack>
          <InlineFeedback feedback={feedback.favorites} onDismiss={() => dismissFeedback('favorites')} />
          <ToggleRow
            label="Scrub tenant data on export"
            hint="Removes drive item ids, file names, email addresses and function keys"
            checked={settings.sanitizeOnExport ?? true}
            onChange={handleSanitizeOnExportChange}
          />
          {(settings.sanitizeOnExport ?? true) === false && (
            <MessageBar messageBarType={MessageBarType.warning} isMultiline>
              Exports will include the designer metadata attached to each action, which
              can contain document names, drive item ids and any key present in a URL.
            </MessageBar>
          )}
        </SettingsSection>

        <SettingsSection {...sectionProps('analysis')} title="Flow editor analysis" description="Thresholds the flow editor uses to rate a flow">
          <Stack tokens={{ childrenGap: 8 }}>
            <Text variant="small" styles={{ root: { fontWeight: 600 } }}>Configuration templates</Text>
            <Text variant="small" className="settings-hint">
              Export your analysis settings (and global placeholder variables) to share with your team, or import from a template
            </Text>
            <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
              <PrimaryButton text="Import Configuration" onClick={handleConfigImport} iconProps={{ iconName: 'Download' }} />
              <DefaultButton text="Export Configuration" onClick={handleConfigExport} iconProps={{ iconName: 'Upload' }} />
            </Stack>
            <InlineFeedback feedback={feedback.config} onDismiss={() => dismissFeedback('config')} />
          </Stack>

          <Stack tokens={{ childrenGap: 8 }}>
            <Text variant="small" styles={{ root: { fontWeight: 600 } }}>Rating thresholds</Text>
            <Text variant="small" className="settings-hint">
              Set amber (warning) and red (critical) thresholds for each metric
            </Text>
            <Stack horizontal wrap tokens={{ childrenGap: 16 }}>
              {threshold('complexityAmber', 'Complexity Amber', 500, 5)}
              {threshold('complexityRed', 'Complexity Red', 500, 5)}
            </Stack>
            <Stack horizontal wrap tokens={{ childrenGap: 16 }}>
              {threshold('actionsAmber', 'Actions Amber', 200, 5)}
              {threshold('actionsRed', 'Actions Red', 200, 5)}
            </Stack>
            <Stack horizontal wrap tokens={{ childrenGap: 16 }}>
              {threshold('variablesAmber', 'Variables Amber', 50, 1)}
              {threshold('variablesRed', 'Variables Red', 50, 1)}
            </Stack>
            <InlineFeedback feedback={feedback.thresholds} onDismiss={() => dismissFeedback('thresholds')} />
          </Stack>

          <Stack horizontal wrap verticalAlign="center" tokens={{ childrenGap: 8 }}>
            <DefaultButton text="Reset to Defaults" onClick={handleResetAnalysisConfig} iconProps={{ iconName: 'Refresh' }} />
            <Text variant="small" className="settings-hint">Resets thresholds and naming conventions</Text>
          </Stack>
          <InlineFeedback feedback={feedback.reset} onDismiss={() => dismissFeedback('reset')} />
        </SettingsSection>

        <SettingsSection {...sectionProps('naming')} title="Naming conventions" description="Variable prefixes the flow editor checks">
          <Text variant="small" className="settings-hint">
            Set the prefix character for each variable type (e.g., b for boolean, s for string)
          </Text>
          <Stack horizontal wrap tokens={{ childrenGap: 12 }}>
            {analysisConfig.namingConfig.conventions.map((conv) => (
              <Stack key={conv.type} tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 80 } }}>
                <Label htmlFor={`naming-${conv.type}`}>{conv.type}</Label>
                <TextField
                  id={`naming-${conv.type}`}
                  value={conv.prefix}
                  maxLength={2}
                  onChange={(e, val) => handleNamingPrefixChange(conv.type, val || '')}
                  styles={{ root: { width: 50 } }}
                />
              </Stack>
            ))}
          </Stack>
        </SettingsSection>
      </div>
    </div>
  );
};

export default Settings;
