import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Stack, Text, Separator, Toggle, TooltipHost, TextField, ChoiceGroup, IChoiceGroupOption, PrimaryButton, DefaultButton, MessageBar, MessageBarType, SpinButton, Label } from '@fluentui/react';
import { IStorageService } from '../services/interfaces';
import { ISettingsModel, defaultSettings, IActionModel } from '../models';
import { IAnalysisConfig, IRatingThresholds, defaultAnalysisConfig, IAnalysisConfigExport, ANALYSIS_CONFIG_VERSION } from '../config/AnalysisConfig';

interface SettingsProps {
  storageService: IStorageService;
  onSettingsChange?: (settings: ISettingsModel) => void;
  onFavoritesImported?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ storageService, onSettingsChange, onFavoritesImported }) => {
  const [settings, setSettings] = useState<ISettingsModel>(defaultSettings);
  const [analysisConfig, setAnalysisConfig] = useState<IAnalysisConfig>(defaultAnalysisConfig);
  const [message, setMessage] = useState<{ text: string; type: MessageBarType } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configFileInputRef = useRef<HTMLInputElement>(null);

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

  const handleShowActionSearchBarChange = useCallback(async (event: React.MouseEvent<HTMLElement>, checked?: boolean) => {
    const newValue = checked ?? true;
    const updatedSettings = await storageService.updateSettings({ showActionSearchBar: newValue });
    setSettings(updatedSettings);
  }, [storageService]);

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

  const handleExport = useCallback(async () => {
    try {
      const favorites = await storageService.getFavoriteActions();
      
      if (!favorites || favorites.length === 0) {
        setMessage({ text: 'No favorite actions to export', type: MessageBarType.warning });
        return;
      }

      const dataStr = JSON.stringify(favorites, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `power-automate-favorites-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setMessage({ text: `Successfully exported ${favorites.length} favorite action(s)`, type: MessageBarType.success });
    } catch (error) {
      setMessage({ text: 'Failed to export favorites', type: MessageBarType.error });
      console.error('Export error:', error);
    }
  }, [storageService]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setMessage({ text: 'Please select a valid JSON file', type: MessageBarType.error });
      return;
    }

    try {
      const fileContent = await file.text();
      const importedActions: IActionModel[] = JSON.parse(fileContent);

      if (!Array.isArray(importedActions)) {
        setMessage({ text: 'Invalid file format: Expected an array of actions', type: MessageBarType.error });
        return;
      }

      // Validate that each item has the required IActionModel properties
      const isValid = importedActions.every(action =>
        action.id && action.title && action.actionJson
      );

      if (!isValid) {
        setMessage({ text: 'Invalid file format: Missing required action properties', type: MessageBarType.error });
        return;
      }

      await storageService.setFavoriteActions(importedActions);
      setMessage({ text: `Successfully imported ${importedActions.length} favorite action(s)`, type: MessageBarType.success });

      // Trigger favorites list refresh
      if (onFavoritesImported) {
        onFavoritesImported();
      }
    } catch (error) {
      setMessage({ text: 'Failed to import favorites: Invalid JSON format', type: MessageBarType.error });
      console.error('Import error:', error);
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [storageService, onFavoritesImported]);

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
    setMessage({ text: 'Analysis threshold updated', type: MessageBarType.success });
  }, [analysisConfig, storageService]);

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
    setMessage({ text: 'Analysis configuration reset to defaults', type: MessageBarType.success });
  }, [storageService]);

  // Config Export Handler
  const handleConfigExport = useCallback(async () => {
    try {
      const config = await storageService.getAnalysisConfig();

      const exportData: IAnalysisConfigExport = {
        version: ANALYSIS_CONFIG_VERSION,
        exportDate: new Date().toISOString(),
        config: config,
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

      setMessage({ text: 'Analysis configuration exported successfully', type: MessageBarType.success });
    } catch (error) {
      setMessage({ text: 'Failed to export configuration', type: MessageBarType.error });
      console.error('Config export error:', error);
    }
  }, [storageService]);

  // Config Import Handler
  const handleConfigImport = useCallback(() => {
    configFileInputRef.current?.click();
  }, []);

  const handleConfigFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setMessage({ text: 'Please select a valid JSON file', type: MessageBarType.error });
      return;
    }

    try {
      const fileContent = await file.text();
      const importedData: IAnalysisConfigExport = JSON.parse(fileContent);

      // Validate structure
      if (!importedData.config || !importedData.config.ratingThresholds) {
        setMessage({ text: 'Invalid configuration file format', type: MessageBarType.error });
        return;
      }

      await storageService.updateAnalysisConfig(importedData.config);
      const updatedConfig = await storageService.getAnalysisConfig();
      setAnalysisConfig(updatedConfig);

      setMessage({ text: 'Analysis configuration imported successfully', type: MessageBarType.success });
    } catch (error) {
      setMessage({ text: 'Failed to import configuration: Invalid JSON format', type: MessageBarType.error });
      console.error('Config import error:', error);
    } finally {
      if (configFileInputRef.current) {
        configFileInputRef.current.value = '';
      }
    }
  }, [storageService]);

  return (
    <Stack tokens={{ childrenGap: 24 }}>
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

      <Stack tokens={{ childrenGap: 8 }}>
        <Text variant="xLarge" styles={{ root: { fontWeight: 600, color: '#323130' } }}>
          Extension Settings
        </Text>
        <Text variant="medium" styles={{ root: { color: '#605e5c' } }}>
          Configure how the Power Automate Actions extension behaves
        </Text>
      </Stack>

      {message && (
        <MessageBar
          messageBarType={message.type}
          isMultiline={false}
          onDismiss={() => setMessage(null)}
          dismissButtonAriaLabel="Close"
        >
          {message.text}
        </MessageBar>
      )}

      <Stack tokens={{ childrenGap: 12 }}>
        <Text variant="medium" styles={{ root: { fontWeight: 600 } }}>
          Favorite Actions Management
        </Text>
        <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
          Import or export your favorite actions as a JSON file
        </Text>
        
        <Stack horizontal tokens={{ childrenGap: 12 }}>
          <PrimaryButton
            text="Import Favorites"
            onClick={handleImport}
            iconProps={{ iconName: 'Download' }}
          />
          <DefaultButton
            text="Export Favorites"
            onClick={handleExport}
            iconProps={{ iconName: 'Upload' }}
          />
        </Stack>
      </Stack>
      <Separator />
      
      <Stack tokens={{ childrenGap: 12 }}>
        <Text variant="medium" styles={{ root: { fontWeight: 600 } }}>
          Page Detection Mode
        </Text>
        
        <ChoiceGroup
          selectedKey={getCurrentPageMode()}
          onChange={handlePageModeChange}
          options={[
            {
              key: 'none',
              text: 'Automatic Detection'
            },
            {
              key: 'recording',
              text: 'Recording Page Override'
            },
            {
              key: 'classic',
              text: 'Classic Power Automate Editor'
            },
            {
              key: 'modern',
              text: 'Modern Power Automate Editor'
            }
          ]}
          styles={{
            root: { marginLeft: '16px' },
            label: { fontWeight: 'normal' }
          }}
        />
      </Stack>

      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} styles={{ root: { flex: 1 } }}>
          <Text>Maximum Recording Time (minutes)</Text>
          <TooltipHost
            content="Set a maximum duration for recording sessions. Leave empty for unlimited recording."
            styles={{ root: { display: 'inline-block' } }}
          >
            <span
              data-testid="recording-time-info-icon"
              style={{
                fontSize: 14,
                color: '#0078d4',
                cursor: 'help'
              }}
            >
              ℹ️
            </span>
          </TooltipHost>
        </Stack>
        <TextField
          value={settings.maximumRecordingTimeMinutes?.toString() || ''}
          onChange={(event, newValue) => handleMaximumRecordingTimeChange(newValue)}
          placeholder="No limit"
          type="number"
          min={1}
          styles={{ root: { width: 100 } }}
        />
      </Stack>

      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} styles={{ root: { flex: 1 } }}>
          <Text>Show Action Search Bar</Text>
          <TooltipHost
            content="Control whether the action search bar appears in the main interface."
            styles={{ root: { display: 'inline-block' } }}
          >
            <span
              data-testid="search-bar-info-icon"
              style={{
                fontSize: 14,
                color: '#0078d4',
                cursor: 'help'
              }}
            >
              ℹ️
            </span>
          </TooltipHost>
        </Stack>
        <Toggle
          checked={settings.showActionSearchBar ?? true}
          onChange={handleShowActionSearchBarChange}
        />
      </Stack>

      <Separator />

      <Stack tokens={{ childrenGap: 12 }}>
        <Text variant="medium" styles={{ root: { fontWeight: 600 } }}>
          Predefined Actions
        </Text>
        <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
          Load template actions from a GitHub JSON file for easy reuse
        </Text>

        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} styles={{ root: { flex: 1 } }}>
            <Text>Show Predefined Actions</Text>
            <TooltipHost
              content="Display a section with predefined action templates loaded from GitHub."
              styles={{ root: { display: 'inline-block' } }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: '#0078d4',
                  cursor: 'help'
                }}
              >
                ℹ️
              </span>
            </TooltipHost>
          </Stack>
          <Toggle
            checked={settings.showPredefinedActions ?? true}
            onChange={handleShowPredefinedActionsChange}
          />
        </Stack>

        <Stack tokens={{ childrenGap: 8 }}>
          <Text variant="small">GitHub JSON URL</Text>
          <TextField
            value={settings.predefinedActionsUrl || ''}
            onChange={handlePredefinedActionsUrlChange}
            placeholder="https://gist.githubusercontent.com/username/gist-id/raw/predefined-actions.json"
            description="Enter the raw URL to your GitHub Gist or repository JSON file"
            multiline={false}
          />
          <Text variant="small" styles={{ root: { color: '#605e5c', fontStyle: 'italic' } }}>
            Tip: Use GitHub Gist for easy editing. Actions are cached for 1 hour.
          </Text>
        </Stack>
      </Stack>

      <Separator />

      {/* Analysis Configuration Section */}
      <Stack tokens={{ childrenGap: 12 }}>
        <Text variant="medium" styles={{ root: { fontWeight: 600 } }}>
          Flow Analysis Configuration
        </Text>
        <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
          Customize thresholds and scoring rules for flow quality analysis
        </Text>

        {/* Config Templates */}
        <Stack tokens={{ childrenGap: 8 }} styles={{ root: { marginTop: 12 } }}>
          <Text variant="small" styles={{ root: { fontWeight: 600 } }}>
            Configuration Templates
          </Text>
          <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
            Export your analysis settings to share with team or import from a template
          </Text>

          <Stack horizontal tokens={{ childrenGap: 12 }}>
            <PrimaryButton
              text="Import Configuration"
              onClick={handleConfigImport}
              iconProps={{ iconName: 'Download' }}
            />
            <DefaultButton
              text="Export Configuration"
              onClick={handleConfigExport}
              iconProps={{ iconName: 'Upload' }}
            />
          </Stack>
        </Stack>

        {/* Rating Thresholds */}
        <Stack tokens={{ childrenGap: 8 }} styles={{ root: { marginTop: 12 } }}>
          <Text variant="small" styles={{ root: { fontWeight: 600 } }}>
            Rating Thresholds
          </Text>
          <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
            Set amber (warning) and red (critical) thresholds for each metric
          </Text>

          <Stack horizontal tokens={{ childrenGap: 16 }} wrap>
            <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
              <Label>Complexity Amber</Label>
              <SpinButton
                value={String(analysisConfig.ratingThresholds.complexityAmber)}
                min={0}
                max={500}
                step={5}
                onChange={(e, val) => handleThresholdChange('complexityAmber', val)}
                styles={{ root: { width: 100 } }}
              />
            </Stack>
            <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
              <Label>Complexity Red</Label>
              <SpinButton
                value={String(analysisConfig.ratingThresholds.complexityRed)}
                min={0}
                max={500}
                step={5}
                onChange={(e, val) => handleThresholdChange('complexityRed', val)}
                styles={{ root: { width: 100 } }}
              />
            </Stack>
          </Stack>

          <Stack horizontal tokens={{ childrenGap: 16 }} wrap>
            <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
              <Label>Actions Amber</Label>
              <SpinButton
                value={String(analysisConfig.ratingThresholds.actionsAmber)}
                min={0}
                max={200}
                step={5}
                onChange={(e, val) => handleThresholdChange('actionsAmber', val)}
                styles={{ root: { width: 100 } }}
              />
            </Stack>
            <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
              <Label>Actions Red</Label>
              <SpinButton
                value={String(analysisConfig.ratingThresholds.actionsRed)}
                min={0}
                max={200}
                step={5}
                onChange={(e, val) => handleThresholdChange('actionsRed', val)}
                styles={{ root: { width: 100 } }}
              />
            </Stack>
          </Stack>

          <Stack horizontal tokens={{ childrenGap: 16 }} wrap>
            <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
              <Label>Variables Amber</Label>
              <SpinButton
                value={String(analysisConfig.ratingThresholds.variablesAmber)}
                min={0}
                max={50}
                step={1}
                onChange={(e, val) => handleThresholdChange('variablesAmber', val)}
                styles={{ root: { width: 100 } }}
              />
            </Stack>
            <Stack tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 120 } }}>
              <Label>Variables Red</Label>
              <SpinButton
                value={String(analysisConfig.ratingThresholds.variablesRed)}
                min={0}
                max={50}
                step={1}
                onChange={(e, val) => handleThresholdChange('variablesRed', val)}
                styles={{ root: { width: 100 } }}
              />
            </Stack>
          </Stack>
        </Stack>

        {/* Naming Conventions */}
        <Stack tokens={{ childrenGap: 8 }} styles={{ root: { marginTop: 12 } }}>
          <Text variant="small" styles={{ root: { fontWeight: 600 } }}>
            Variable Naming Conventions
          </Text>
          <Text variant="small" styles={{ root: { color: '#605e5c' } }}>
            Set the prefix character for each variable type (e.g., b for boolean, s for string)
          </Text>

          <Stack horizontal tokens={{ childrenGap: 12 }} wrap>
            {analysisConfig.namingConfig.conventions.map((conv) => (
              <Stack key={conv.type} tokens={{ childrenGap: 4 }} styles={{ root: { minWidth: 80 } }}>
                <Label>{conv.type}</Label>
                <TextField
                  value={conv.prefix}
                  maxLength={2}
                  onChange={(e, val) => handleNamingPrefixChange(conv.type, val || '')}
                  styles={{ root: { width: 50 } }}
                />
              </Stack>
            ))}
          </Stack>
        </Stack>

        {/* Reset Button */}
        <Stack horizontal tokens={{ childrenGap: 12 }} styles={{ root: { marginTop: 16 } }}>
          <DefaultButton
            text="Reset to Defaults"
            onClick={handleResetAnalysisConfig}
            iconProps={{ iconName: 'Refresh' }}
          />
        </Stack>
      </Stack>
    </Stack>
  );
};

export default Settings;
