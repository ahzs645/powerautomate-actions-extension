// AppNew.tsx - Refactored main app component
// Uses new hooks, layout components, and tab structure
// Can be renamed to App.tsx once verified

import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { Mode, IInitialState, ActionType, AppElement, ICommunicationChromeMessage } from './models';
import { ISettingsModel } from './models/ISettingsModel';
import { StorageService } from './services/StorageService';
import { ExtensionCommunicationService, PredefinedActionsService } from './services';

// Layout components
import { AppHeader, HeaderActionGroup } from './components/layout/AppHeader';
import { TabNavigation, TabConfig } from './components/layout/TabNavigation';
import { StatusBar, Notification } from './components/layout/StatusBar';

// Tab components
import {
  RecordedRequestsTab,
  CopiedActionsTab,
  FavoritesTab,
  PredefinedActionsTab,
  AnalysisTab,
  CompareTab,
  SolutionTab,
} from './components/tabs';

// Settings component
import Settings from './components/Settings';

// Hooks
import { useRecording } from './hooks/useRecording';
import { useActions } from './hooks/useActions';
import { useAppState } from './hooks/useAppState';

// Styles
import { designTokens } from './styles/theme';
import { mergeStyles } from '@fluentui/react';

const appContainerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  height: designTokens.layout.popupHeight,
  maxHeight: '600px',
  overflow: 'hidden',
  backgroundColor: designTokens.colors.neutralLighterAlt,
  fontFamily: designTokens.typography.fontFamily,
});

const contentContainerStyles = mergeStyles({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

function AppNew(initialState?: IInitialState | undefined) {
  // Services
  const storageService = useMemo(() => new StorageService(), []);
  const communicationService = useMemo(() => new ExtensionCommunicationService(), []);
  const predefinedActionsService = useMemo(() => new PredefinedActionsService(), []);

  // Notification state
  const [notification, setNotification] = useState<Notification | null>(null);

  // Notification helper
  const showNotification = useCallback((message: string, type: 'success' | 'warning' | 'error' | 'info') => {
    setNotification({ message, type, autoDismiss: true, autoDismissMs: 4000 });
  }, []);

  // App state hook
  const appState = useAppState(storageService, communicationService);

  // Recording hook
  const recording = useRecording(
    storageService,
    communicationService,
    (message, isSuccess) => showNotification(message, isSuccess ? 'success' : 'warning')
  );

  // Actions hook
  const actionsHook = useActions(
    storageService,
    communicationService,
    predefinedActionsService,
    (message, isSuccess) => showNotification(message, isSuccess ? 'success' : 'warning')
  );

  // Settings state (for the panel)
  const [settings, setSettings] = useState<ISettingsModel | null>(null);

  // Initialize app
  useEffect(() => {
    const init = async () => {
      const loadedSettings = await appState.initializeApp();
      setSettings(loadedSettings);
      await actionsHook.loadActions();

      // Load predefined actions if enabled
      if (loadedSettings.showPredefinedActions && loadedSettings.predefinedActionsUrl) {
        actionsHook.loadPredefinedActions(loadedSettings.predefinedActionsUrl);
      }

      // Resume recording timer
      recording.resumeRecordingTimer(loadedSettings);
    };
    init();

    // Listen for action updates
    const handleMessage = (
      message: ICommunicationChromeMessage,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: any) => void
    ) => {
      if (message.to !== AppElement.ReactApp) return;

      switch (message.actionType) {
        case ActionType.ActionUpdated:
          if (message.message) actionsHook.setActions(message.message);
          break;
        case ActionType.MyClipboardActionsUpdated:
          if (message.message) actionsHook.setMyClipboardActions(message.message);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle settings change
  const handleSettingsChange = useCallback(async (newSettings: ISettingsModel) => {
    setSettings(newSettings);
    appState.checkPageStatus();

    if (newSettings.showPredefinedActions && newSettings.predefinedActionsUrl) {
      await actionsHook.loadPredefinedActions(newSettings.predefinedActionsUrl);
    } else {
      actionsHook.setPredefinedActions([]);
    }
  }, [appState, actionsHook]);

  // Build header action groups
  const headerActionGroups: HeaderActionGroup[] = useMemo(() => {
    const groups: HeaderActionGroup[] = [];

    // Recording group
    if (appState.isRecordingPage && !appState.isPowerAutomatePage) {
      groups.push({
        key: 'recording',
        label: 'Record',
        actions: [
          {
            key: 'record',
            iconName: recording.isRecording ? 'CircleStopSolid' : 'Record2',
            title: recording.isRecording ? 'Stop Recording' : 'Start Recording',
            hoverMessage: recording.isRecording
              ? `Stop Action Recording${recording.formattedTimeLeft ? ` (${recording.formattedTimeLeft} left)` : ''}`
              : 'Start Action Recording',
            onClick: recording.toggleRecording,
            isRecording: recording.isRecording,
          },
        ],
      });
    }

    // Clipboard group (for classic PA)
    if (appState.isPowerAutomatePage && !appState.isV3PowerAutomateEditor) {
      groups.push({
        key: 'clipboard',
        label: 'Clipboard',
        actions: [
          {
            key: 'copy',
            iconName: 'Copy',
            title: 'Copy Items',
            hoverMessage: "Copy Items to 'My Clipboard' Section",
            onClick: () => actionsHook.copySelectedActions(appState.currentMode),
          },
          {
            key: 'paste',
            iconName: 'DoubleChevronDown12',
            title: "Get 'My Clipboard Actions'",
            hoverMessage: "Retrieve Actions from 'My Clipboard' Section",
            onClick: actionsHook.getClipboardActions,
          },
        ],
      });
    }

    // V3 clipboard (modern editor)
    if (appState.isV3PowerAutomateEditor) {
      groups.push({
        key: 'clipboard-v3',
        label: 'Clipboard',
        actions: [
          {
            key: 'insert-clipboard',
            iconName: 'Copy',
            title: 'Add to Clipboard',
            hoverMessage: 'Add Selected Actions to Clipboard',
            onClick: actionsHook.insertToClipboardV3,
          },
        ],
      });
    }

    // Page actions
    if (appState.hasActionsOnPageToCopy && !appState.isPowerAutomatePage) {
      groups.push({
        key: 'page-actions',
        actions: [
          {
            key: 'copy-all',
            iconName: 'SetAction',
            title: 'Copy All Actions',
            hoverMessage: 'Copy All Actions from the Page',
            onClick: actionsHook.copyAllActionsFromPage,
          },
        ],
      });
    }

    // Clear action (always available when on appropriate page)
    if (appState.isRecordingPage || appState.isPowerAutomatePage || appState.hasActionsOnPageToCopy) {
      groups.push({
        key: 'actions',
        actions: [
          {
            key: 'clear',
            iconName: 'Clear',
            title: 'Clear Items',
            hoverMessage: 'Remove All Items from the Current List',
            onClick: () => actionsHook.clearActionList(appState.currentMode),
          },
        ],
      });
    }

    // Flow editor
    if (appState.isFlowPage) {
      groups.push({
        key: 'flow-editor',
        actions: [
          {
            key: 'edit-flow',
            iconName: 'Edit',
            title: 'Edit Flow JSON',
            hoverMessage: 'Open Flow JSON Editor',
            onClick: appState.openFlowEditor,
          },
        ],
      });
    }

    // Settings (always last)
    groups.push({
      key: 'settings',
      actions: [
        {
          key: 'settings',
          iconName: 'Settings',
          title: 'Settings',
          hoverMessage: 'Open Extension Settings',
          onClick: () => appState.setShowSettings(!appState.showSettings),
          isActive: appState.showSettings,
        },
      ],
    });

    return groups;
  }, [appState, recording, actionsHook]);

  // Build tab configuration
  const tabs: TabConfig[] = useMemo(() => {
    const tabList: TabConfig[] = [
      { key: 'recorded', mode: Mode.Requests, label: 'Recorded', icon: 'Record2', badge: actionsHook.actions.length },
      { key: 'copied', mode: Mode.CopiedActions, label: 'Copied', icon: 'Copy', badge: actionsHook.myClipboardActions.length },
      { key: 'favorites', mode: Mode.Favorites, label: 'Favorites', icon: 'FavoriteStar', badge: actionsHook.favoriteActions.length },
      {
        key: 'predefined',
        mode: Mode.PredefinedActions,
        label: 'Predefined',
        icon: 'CloudDownload',
        hidden: !settings?.showPredefinedActions,
        badge: actionsHook.predefinedActions.length,
      },
      // Analysis tabs - always visible
      { key: 'analysis', mode: Mode.Analysis, label: 'Analysis', icon: 'Analytics' },
      { key: 'compare', mode: Mode.Compare, label: 'Compare', icon: 'BranchCompare' },
      { key: 'solution', mode: Mode.Solution, label: 'Solution', icon: 'Archive' },
    ];
    return tabList;
  }, [settings?.showPredefinedActions, actionsHook.actions.length, actionsHook.myClipboardActions.length, actionsHook.favoriteActions.length, actionsHook.predefinedActions.length]);

  // Render current tab content
  const renderTabContent = useCallback(() => {
    // Settings panel
    if (appState.showSettings) {
      return (
        <div style={{ flex: 1, overflowY: 'auto', padding: designTokens.spacing.lg }}>
          <Settings
            storageService={storageService}
            onSettingsChange={handleSettingsChange}
            onFavoritesImported={async () => {
              const favorites = await storageService.getFavoriteActions();
              actionsHook.setFavoriteActions(favorites);
            }}
          />
        </div>
      );
    }

    // Tab content
    switch (appState.currentMode) {
      case Mode.Requests:
        return (
          <RecordedRequestsTab
            actions={actionsHook.actions}
            searchTerm={appState.searchTerm}
            onSearchChange={appState.setSearchTerm}
            onSelectAction={(action) => actionsHook.selectAction(action, Mode.Requests, !action.isSelected)}
            onDeleteAction={actionsHook.deleteRecordedAction}
            onToggleFavorite={(action) => actionsHook.toggleFavorite(action, !action.isFavorite)}
            onStartRecording={recording.startRecording}
          />
        );

      case Mode.CopiedActions:
        return (
          <CopiedActionsTab
            actions={actionsHook.myClipboardActions}
            searchTerm={appState.searchTerm}
            onSearchChange={appState.setSearchTerm}
            onSelectAction={(action) => actionsHook.selectAction(action, Mode.CopiedActions, !action.isSelected)}
            onDeleteAction={actionsHook.deleteMyClipboardAction}
            onToggleFavorite={(action) => actionsHook.toggleFavorite(action, !action.isFavorite)}
            onPasteFromClipboard={actionsHook.getClipboardActions}
          />
        );

      case Mode.Favorites:
        return (
          <FavoritesTab
            actions={actionsHook.favoriteActions}
            searchTerm={appState.searchTerm}
            onSearchChange={appState.setSearchTerm}
            onSelectAction={(action) => actionsHook.selectAction(action, Mode.Favorites, !action.isSelected)}
            onDeleteAction={actionsHook.deleteFavoriteAction}
          />
        );

      case Mode.PredefinedActions:
        return (
          <PredefinedActionsTab
            actions={actionsHook.predefinedActions}
            isLoading={actionsHook.predefinedActionsLoading}
            searchTerm={appState.searchTerm}
            onSearchChange={appState.setSearchTerm}
            onSelectAction={(action) => actionsHook.selectAction(action, Mode.PredefinedActions, !action.isSelected)}
            onToggleFavorite={(action) => actionsHook.toggleFavorite(action, !action.isFavorite)}
            onRefresh={() => settings?.predefinedActionsUrl && actionsHook.refreshPredefinedActions(settings.predefinedActionsUrl)}
            onConfigureUrl={() => appState.setShowSettings(true)}
          />
        );

      case Mode.Analysis:
        return (
          <AnalysisTab
            isFlowPage={appState.isFlowPage}
            onOpenFullAnalysis={appState.openFlowEditor}
          />
        );

      case Mode.Compare:
        return (
          <CompareTab
            isFlowPage={appState.isFlowPage}
            onOpenFullComparison={appState.openFlowEditor}
          />
        );

      case Mode.Solution:
        return (
          <SolutionTab
            onOpenFullAnalysis={appState.openFlowEditor}
          />
        );

      default:
        return null;
    }
  }, [
    appState,
    actionsHook,
    recording,
    storageService,
    handleSettingsChange,
    settings?.predefinedActionsUrl,
  ]);

  return (
    <div className={appContainerStyles}>
      {/* Header */}
      <AppHeader
        actionGroups={headerActionGroups}
        recordingTimeLeft={recording.formattedTimeLeft}
        onHoverMessageChange={appState.setHoverMessage}
      />

      {/* Status Bar */}
      <StatusBar
        notification={notification}
        hoverMessage={appState.hoverMessage}
        onDismiss={() => setNotification(null)}
        compact
      />

      {/* Tab Navigation */}
      <TabNavigation
        currentMode={appState.currentMode}
        onModeChange={appState.setCurrentMode}
        tabs={tabs}
        showSettings={appState.showSettings}
      />

      {/* Content */}
      <div className={contentContainerStyles}>
        {renderTabContent()}
      </div>
    </div>
  );
}

export default AppNew;
