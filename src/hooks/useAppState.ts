// useAppState - Custom hook for centralized app state management
// Handles settings, page detection, notifications, and mode switching

import { useState, useCallback, useEffect } from 'react';
import { ActionType, AppElement, Mode, ICommunicationChromeMessage } from '../models';
import { ISettingsModel } from '../models/ISettingsModel';
import { StorageService } from '../services/StorageService';
import { ExtensionCommunicationService } from '../services';
import { FlowEditorActions } from '../services/interfaces/IFlowEditorActions';

export interface UseAppStateResult {
  // Settings
  settings: ISettingsModel | null;
  setSettings: React.Dispatch<React.SetStateAction<ISettingsModel | null>>;

  // Mode
  currentMode: Mode;
  setCurrentMode: React.Dispatch<React.SetStateAction<Mode>>;
  showSettings: boolean;
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;

  // Page detection
  isRecordingPage: boolean;
  isPowerAutomatePage: boolean;
  isV3PowerAutomateEditor: boolean;
  isFlowPage: boolean;
  hasActionsOnPageToCopy: boolean;

  // Search
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;

  // Notifications
  notificationMessage: string | null;
  isSuccessNotification: boolean;
  setNotification: (message: string | null, isSuccess?: boolean) => void;
  clearNotification: () => void;

  // Hover message
  hoverMessage: string | null;
  setHoverMessage: React.Dispatch<React.SetStateAction<string | null>>;

  // Actions
  initializeApp: () => Promise<ISettingsModel>;
  updateSettings: (partialSettings: Partial<ISettingsModel>) => Promise<void>;
  openFlowEditor: () => void;
  checkPageStatus: () => void;
}

export function useAppState(
  storageService: StorageService,
  communicationService: ExtensionCommunicationService
): UseAppStateResult {
  // Settings
  const [settings, setSettings] = useState<ISettingsModel | null>(null);

  // Mode
  const [currentMode, setCurrentMode] = useState<Mode>(Mode.Requests);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Page detection
  const [isRecordingPage, setIsRecordingPage] = useState<boolean>(false);
  const [isPowerAutomatePage, setIsPowerAutomatePage] = useState<boolean>(false);
  const [isV3PowerAutomateEditor, setIsV3PowerAutomateEditor] = useState<boolean>(false);
  const [isFlowPage, setIsFlowPage] = useState<boolean>(false);
  const [hasActionsOnPageToCopy, setHasActionsOnPageToCopy] = useState<boolean>(false);

  // Search
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Notifications
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [isSuccessNotification, setIsSuccessNotification] = useState<boolean>(false);

  // Hover message
  const [hoverMessage, setHoverMessage] = useState<string | null>(null);

  // Set notification helper
  const setNotification = useCallback((message: string | null, isSuccess: boolean = false) => {
    setNotificationMessage(message);
    setIsSuccessNotification(isSuccess);
  }, []);

  // Clear notification
  const clearNotification = useCallback(() => {
    setNotificationMessage(null);
  }, []);

  // Check recording page setting
  const checkRecordingPage = useCallback((settingValue: boolean | null) => {
    if (settingValue !== null) {
      setIsRecordingPage(settingValue);
    } else {
      communicationService.sendRequest(
        { actionType: ActionType.CheckRecordingPage, message: 'Check Recording Page' },
        AppElement.ReactApp,
        AppElement.Content,
        (response) => {
          setIsRecordingPage(response);
        }
      );
    }
  }, [communicationService]);

  // Check classic PA setting
  const checkClassicPA = useCallback((settingValue: boolean | null) => {
    if (settingValue !== null) {
      setIsPowerAutomatePage(settingValue);
    } else {
      communicationService.sendRequest(
        { actionType: ActionType.CheckPowerAutomatePage, message: 'Check PowerAutomate Page' },
        AppElement.ReactApp,
        AppElement.Content,
        (response) => {
          setIsPowerAutomatePage(response);
        }
      );
    }
  }, [communicationService]);

  // Check new PA V3 setting
  const checkNewPAV3 = useCallback((settingValue: boolean | null) => {
    if (settingValue !== null) {
      setIsV3PowerAutomateEditor(settingValue);
    } else {
      communicationService.sendRequest(
        {
          actionType: ActionType.CheckIsNewPowerAutomateEditorV3,
          message: 'Check If Page is a new Power Automate editor',
        },
        AppElement.ReactApp,
        AppElement.Content,
        (response) => {
          setIsV3PowerAutomateEditor(response);
        }
      );
    }
  }, [communicationService]);

  // Check flow page
  const checkFlowPage = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'check-flow-page' } as FlowEditorActions, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to check flow page:', chrome.runtime.lastError);
        setIsFlowPage(false);
        return;
      }
      setIsFlowPage(response?.isFlowPage || false);
    });
  }, []);

  // Check if page has actions to copy
  const checkActionsOnPage = useCallback(() => {
    communicationService.sendRequest(
      { actionType: ActionType.CheckIfPageHasActionsToCopy, message: 'Check If Page has actions to copy' },
      AppElement.ReactApp,
      AppElement.Content,
      (response) => {
        setHasActionsOnPageToCopy(response);
      }
    );
  }, [communicationService]);

  // Check all page status
  const checkPageStatus = useCallback(() => {
    checkRecordingPage(null);
    checkClassicPA(null);
    checkNewPAV3(null);
    checkFlowPage();
    checkActionsOnPage();
  }, [checkRecordingPage, checkClassicPA, checkNewPAV3, checkFlowPage, checkActionsOnPage]);

  // Initialize app
  const initializeApp = useCallback(async (): Promise<ISettingsModel> => {
    const loadedSettings = await storageService.getSettings();
    setSettings(loadedSettings);

    // Check page status with settings values
    checkRecordingPage(loadedSettings.isRecordingPage ?? null);
    checkClassicPA(loadedSettings.isClassicPowerAutomatePage ?? null);
    checkNewPAV3(loadedSettings.isModernPowerAutomatePage ?? null);
    checkFlowPage();
    checkActionsOnPage();

    return loadedSettings;
  }, [storageService, checkRecordingPage, checkClassicPA, checkNewPAV3, checkFlowPage, checkActionsOnPage]);

  // Update settings
  const updateSettings = useCallback(async (partialSettings: Partial<ISettingsModel>) => {
    const updatedSettings = await storageService.updateSettings(partialSettings);
    setSettings(updatedSettings);
  }, [storageService]);

  // Open flow editor
  const openFlowEditor = useCallback(() => {
    chrome.runtime.sendMessage(
      { type: 'open-flow-editor' } as FlowEditorActions,
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to open flow editor:', chrome.runtime.lastError);
          setNotification('Failed to open flow editor', false);
          return;
        }
        if (!response?.success) {
          setNotification(response?.error || 'Failed to open flow editor', false);
        }
      }
    );
  }, [setNotification]);

  // Listen for messages from background
  useEffect(() => {
    const messageListener = (
      message: ICommunicationChromeMessage,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: any) => void
    ) => {
      if (message.to !== AppElement.ReactApp) return;

      // Additional message handling can be added here
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  return {
    settings,
    setSettings,
    currentMode,
    setCurrentMode,
    showSettings,
    setShowSettings,
    isRecordingPage,
    isPowerAutomatePage,
    isV3PowerAutomateEditor,
    isFlowPage,
    hasActionsOnPageToCopy,
    searchTerm,
    setSearchTerm,
    notificationMessage,
    isSuccessNotification,
    setNotification,
    clearNotification,
    hoverMessage,
    setHoverMessage,
    initializeApp,
    updateSettings,
    openFlowEditor,
    checkPageStatus,
  };
}

export default useAppState;
