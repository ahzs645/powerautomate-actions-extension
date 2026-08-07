import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { ActionType, IDataChromeMessage, AppElement, ICommunicationChromeMessage, IInitialState, Mode } from './models';
import { IActionModel } from './models/IActionModel';
import { ISettingsModel, ThemeMode } from './models/ISettingsModel';
import { StorageService } from './services/StorageService';
import { ExtensionCommunicationService, PredefinedActionsService, designerCopyService } from './services';
import { utilityActionsService } from './services/UtilityActionsService';
import { DefaultButton, Icon, MessageBar, MessageBarType, Pivot, PivotItem } from '@fluentui/react';
import ActionsList from './components/ActionsList';
import Settings from './components/Settings';
import PredefinedActionsList from './components/PredefinedActionsList';
import { FlowEditorActions } from './services/interfaces/IFlowEditorActions';

function App(initialState?: IInitialState | undefined) {
  const storageService = useMemo(() => { return new StorageService(); }, []);
  const communicationService = useMemo(() => { return new ExtensionCommunicationService(); }, []);
  const predefinedActionsService = useMemo(() => { return new PredefinedActionsService(); }, []);
  const [isRecording, setIsRecording] = useState<boolean>(initialState?.isRecording || false);
  const [isPowerAutomatePage, setIsPowerAutomatePage] = useState<boolean>(initialState?.isPowerAutomatePage || false);
  const [isRecordingPage, setIsRecordingPage] = useState<boolean>(initialState?.isRecordingPage || false);
  const [hasActionsOnPageToCopy, setHasActionsOnPageToCopy] = useState<boolean>(initialState?.hasActionsOnPageToCopy || false);
  const [actions, setActions] = useState<IActionModel[]>(initialState?.actions || []);
  const [myClipboardActions, setMyClipboardActions] = useState<IActionModel[]>(initialState?.myClipboardActions || []);
  const [currentMode, setCurrentMode] = useState<Mode>(initialState?.currentMode || Mode.Requests);
  const [favoriteActions, setFavoriteActions] = useState<IActionModel[]>(initialState?.favoriteActions || []);
  const [predefinedActions, setPredefinedActions] = useState<IActionModel[]>([]);
  const [predefinedActionsLoading, setPredefinedActionsLoading] = useState<boolean>(false);
  const [isV3PowerAutomateEditor, setIsV3PowerAutomateEditor] = useState<boolean>(false);
  const [hoverMessage, setHoverMessage] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [isSuccessNotification, setIsSuccessNotification] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settings, setSettings] = useState<ISettingsModel | null>(null);
  const [recordingTimeLeft, setRecordingTimeLeft] = useState<number | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isFlowPage, setIsFlowPage] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<ThemeMode>('system');

  const applyTheme = useCallback((mode: ThemeMode) => {
    setActiveTheme(mode);
    if (mode === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = mode;
    }
  }, []);

  const toggleTheme = useCallback(async () => {
    const prefersDark = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolvedCurrent = activeTheme === 'system'
      ? (prefersDark ? 'dark' : 'light')
      : activeTheme;
    const next: ThemeMode = resolvedCurrent === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await storageService.updateSettings({ theme: next });
  }, [activeTheme, applyTheme, storageService]);

  const listenToMessage = (message: ICommunicationChromeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.to !== AppElement.ReactApp) { return console.log('Incorrect message destination'); }
    switch (message.actionType) {
      case ActionType.ActionUpdated:
        message.message && setActions(message.message);
        break;
      case ActionType.MyClipboardActionsUpdated:
        message.message && setMyClipboardActions(message.message);
        break;
    }
  }

  const getRecordingPageSetting = useCallback(async (isRecordingPageSetting: boolean | null) => {
    if (isRecordingPageSetting !== null) {
      setIsRecordingPage(isRecordingPageSetting);
    } else {
      communicationService.sendRequest({ actionType: ActionType.CheckRecordingPage, message: "Check Recording Page" }, AppElement.ReactApp, AppElement.Content, (response) => {
        setIsRecordingPage(response);
      });
    }
  }, [communicationService]);

  const getClassicPASetting = useCallback(async (isPAEditorPage: boolean | null) => {
    if (isPAEditorPage !== null) {
      setIsPowerAutomatePage(isPAEditorPage);
    } else {
      communicationService.sendRequest({ actionType: ActionType.CheckPowerAutomatePage, message: "Check PowerAutomate Page" }, AppElement.ReactApp, AppElement.Content, (response) => {
        setIsPowerAutomatePage(response)
      });
    }
  }, [communicationService]);

  const getNewPASetting = useCallback(async (isNewPAEditorPage: boolean | null) => {
    if (isNewPAEditorPage !== null) {
      setIsV3PowerAutomateEditor(isNewPAEditorPage);
    } else {
      communicationService.sendRequest({ actionType: ActionType.CheckIsNewPowerAutomateEditorV3, message: "Check If Page is a new Power Automate editor" }, AppElement.ReactApp, AppElement.Content, (response) => {
        setIsV3PowerAutomateEditor(response);
      });
    }
  }, [communicationService]);

  const stopRecordingTimer = useCallback(async () => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setRecordingTimeLeft(null);
    
    await storageService.setRecordingStartTime(null);
  }, [storageService]);

  const startRecordingTimer = useCallback(async (maxRecordingTimeMinutes: number, startTime?: number) => {
    const currentStartTime = startTime || Date.now();
    const maxTimeMs = maxRecordingTimeMinutes * 60 * 1000;
    
    if (startTime) {
      const elapsedMs = Date.now() - startTime;
      const remainingMs = maxTimeMs - elapsedMs;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setRecordingTimeLeft(remainingSeconds);
      
      recordingTimerRef.current = setTimeout(() => {
        const message: IDataChromeMessage = { 
          actionType: ActionType.StopRecording, 
          message: "Stop recording - time limit reached" 
        };
        communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
          setIsRecording(response);
          setNotificationMessage(`Recording stopped automatically after ${maxRecordingTimeMinutes} minutes`);
          setIsSuccessNotification(false);
          stopRecordingTimer();
        });
      }, remainingMs);
    } else {
      setRecordingTimeLeft(maxRecordingTimeMinutes * 60);
      
      recordingTimerRef.current = setTimeout(() => {
        const message: IDataChromeMessage = { 
          actionType: ActionType.StopRecording, 
          message: "Stop recording - time limit reached" 
        };
        communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
          setIsRecording(response);
          setNotificationMessage(`Recording stopped automatically after ${maxRecordingTimeMinutes} minutes`);
          setIsSuccessNotification(false);
          stopRecordingTimer();
        });
      }, maxTimeMs);
      
      await storageService.setRecordingStartTime(currentStartTime);
    }

    countdownTimerRef.current = setInterval(() => {
      setRecordingTimeLeft(prevTime => {
        if (prevTime === null || prevTime <= 1) {
          return null;
        }
        return prevTime - 1;
      });
    }, 1000);
  }, [communicationService, stopRecordingTimer, storageService]);

  const sendRecordingStatus = useCallback(async () => {
    if (isRecording) {
      const message: IDataChromeMessage = { 
        actionType: ActionType.StopRecording, 
        message: "Stop recording" 
      };
      communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, async (response) => {
        setIsRecording(response);
        await stopRecordingTimer();
      });
    } else {
      const settings = await storageService.getSettings();
      const message: IDataChromeMessage = { 
        actionType: ActionType.StartRecording, 
        message: "Start recording" 
      };
      
      communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
        setIsRecording(response);
        
        if (response && settings.maximumRecordingTimeMinutes && settings.maximumRecordingTimeMinutes > 0) {
          startRecordingTimer(settings.maximumRecordingTimeMinutes);
        }
      });
    }
  }, [communicationService, isRecording, storageService, stopRecordingTimer, startRecordingTimer]);

  // Loads the bundled utility pack plus every configured remote source.
  const loadPredefinedActions = useCallback(async (currentSettings: ISettingsModel) => {
    setPredefinedActionsLoading(true);
    try {
      const actions = await predefinedActionsService.getAllActions(currentSettings);
      setPredefinedActions(actions);
    } catch (error) {
      console.error('Failed to load predefined actions:', error);
      setPredefinedActions([]);
    } finally {
      setPredefinedActionsLoading(false);
    }
  }, [predefinedActionsService]);

  const handleSettingsChange = useCallback(async (updatedSettings: ISettingsModel) => {
    setSettings(updatedSettings);
    // The utility pack is rebuilt from settings (base URL, key mode, unsafe
    // opt-in), so any settings change has to re-materialize the list.
    loadPredefinedActions(updatedSettings);
  }, [loadPredefinedActions]);

  const refreshPredefinedActions = useCallback(async () => {
    if (!settings) { return; }

    setPredefinedActionsLoading(true);
    try {
      const actions = await predefinedActionsService.refreshAll(settings);
      setPredefinedActions(actions);
      setNotificationMessage('Predefined actions refreshed successfully');
      setIsSuccessNotification(true);
    } catch (error) {
      console.error('Failed to refresh predefined actions:', error);
      setNotificationMessage('Failed to refresh predefined actions');
      setIsSuccessNotification(false);
    } finally {
      setPredefinedActionsLoading(false);
    }
  }, [settings, predefinedActionsService]);

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

  const initData = useCallback(async () => {
    const settings = await storageService.getSettings();
    setSettings(settings);

    // Apply stored theme
    applyTheme(settings.theme || 'system');

    getRecordingPageSetting(settings.isRecordingPage ?? null);
    getClassicPASetting(settings.isClassicPowerAutomatePage ?? null);
    getNewPASetting(settings.isModernPowerAutomatePage ?? null);
    checkFlowPage();

    communicationService.sendRequest({ actionType: ActionType.CheckIfPageHasActionsToCopy, message: "Check If Page has actions to copy" }, AppElement.ReactApp, AppElement.Content, (response) => {
      setHasActionsOnPageToCopy(response)
    });

    storageService.getRecordedActions().then((actions) => {
      setActions(actions);
    });

    storageService.getMyClipboardActions().then((actions) => {
      setMyClipboardActions(actions);
    });

    storageService.getFavoriteActions().then((actions) => {
      setFavoriteActions(actions);
    });

    // Load predefined actions (bundled utility pack + any remote sources)
    loadPredefinedActions(settings);

    storageService.getIsRecordingValue().then((isRecording) => {
      setIsRecording(isRecording);
      
      if (isRecording && settings.recordingStartTime && settings.maximumRecordingTimeMinutes) {
        const elapsedMs = Date.now() - settings.recordingStartTime;
        const maxTimeMs = settings.maximumRecordingTimeMinutes * 60 * 1000;
        const remainingMs = maxTimeMs - elapsedMs;
        
        if (remainingMs > 0) {
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          setRecordingTimeLeft(remainingSeconds);
          startRecordingTimer(settings.maximumRecordingTimeMinutes, settings.recordingStartTime);
        } else {
          const message: IDataChromeMessage = { 
            actionType: ActionType.StopRecording, 
            message: "Stop recording - time limit already reached" 
          };
          communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
            setIsRecording(response);
            setNotificationMessage(`Recording was stopped automatically - time limit exceeded`);
            setIsSuccessNotification(false);
            stopRecordingTimer();
          });
        }
      }
    });

    chrome.runtime.onMessage.addListener(listenToMessage);
  }, [communicationService, storageService, getRecordingPageSetting, getClassicPASetting, getNewPASetting, startRecordingTimer, stopRecordingTimer, loadPredefinedActions, checkFlowPage, applyTheme]);

  useEffect(() => {
    initData();
  }, [initData]);

  useEffect(() => {
    return () => {
      stopRecordingTimer();
    };
  }, [stopRecordingTimer]);

  const copyAllActionsFromPage = useCallback(() => {
    const message = {
      actionType: ActionType.CopyAllActionsFromPage,
      message: "Copy All Actions From the Page",
    }
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content);
  }, [communicationService])

  const clearActionList = useCallback(() => {
    switch (currentMode) {
      case Mode.Requests:
        storageService.clearRecordedActions();
        setActions([]);
        break;
      case Mode.CopiedActions:
        storageService.clearMyClipboardActions();
        setMyClipboardActions([]);
        break;
      case Mode.Favorites:
        storageService.clearFavoriteActions();
        setFavoriteActions([]);
        break;
      case Mode.PredefinedActions:
        setPredefinedActions([]);
        break;
    }
  }, [currentMode, storageService])

  const copyItems = useCallback(() => {
    const selectedActions = currentMode === Mode.Requests ? actions?.filter(a => a.isSelected) :
      currentMode === Mode.CopiedActions ? myClipboardActions?.filter(a => a.isSelected) :
        currentMode === Mode.Favorites ? favoriteActions?.filter(a => a.isSelected) :
          currentMode === Mode.PredefinedActions ? predefinedActions?.filter(a => a.isSelected) :
            [];

    if (!selectedActions || selectedActions.length === 0) {
      setNotificationMessage("No actions selected");
      setIsSuccessNotification(false);
      return;
    }

    const message: IDataChromeMessage = {
      actionType: ActionType.CopyAction,
      message: selectedActions,
    }
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content);
  }, [actions, myClipboardActions, favoriteActions, predefinedActions, currentMode, communicationService])

  const deleteAction = useCallback((action: IActionModel, oldActions: IActionModel[], setActionsFunc: (value: React.SetStateAction<IActionModel[]>)
    => void, actionType: ActionType) => {
    const message: IDataChromeMessage = {
      actionType: actionType,
      message: action,
    }
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
      const myArray = [...(oldActions || [])];
      const index = myArray.findIndex((a) => a.id === action.id);
      myArray.splice(index, 1);
      setActionsFunc(myArray);
    });
  }, [communicationService])

  const deleteRecordedAction = useCallback((action: IActionModel) => {
    deleteAction(action, actions, setActions, ActionType.DeleteAction);
  }, [actions, setActions, deleteAction])

  const deleteMyClipboardAction = useCallback((action: IActionModel) => {
    deleteAction(action, myClipboardActions, setMyClipboardActions, ActionType.DeleteMyClipboardAction);
  }, [myClipboardActions, setMyClipboardActions, deleteAction])

  const updateFavoriteStatusInLists = useCallback((actionId: string, isFavorite: boolean) => {
    setActions(prevActions =>
      (prevActions ?? []).map(action =>
        action.id === actionId ? { ...action, isFavorite } : action
      )
    );

    setMyClipboardActions(prevActions =>
      (prevActions ?? []).map(action =>
        action.id === actionId ? { ...action, isFavorite } : action
      )
    );

    setPredefinedActions(prevActions =>
      (prevActions ?? []).map(action =>
        action.id === actionId ? { ...action, isFavorite } : action
      )
    );
  }, [])

  const deleteFavoriteAction = useCallback((action: IActionModel) => {
    storageService.removeFavoriteAction(action).then((updatedFavorites) => {
      setFavoriteActions(updatedFavorites);
      updateFavoriteStatusInLists(action.id, false);
    });
  }, [storageService, updateFavoriteStatusInLists])

  const getMyClipboardActions = useCallback(() => {
    const message: IDataChromeMessage = {
      actionType: ActionType.GetElementsFromMyClipboard,
      message: "Get My Clipboard Actions",
    }
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content);
  }, [communicationService])

  const changeSelection = useCallback((action: IActionModel, oldActions: IActionModel[], setActionsFunc: (value: React.SetStateAction<IActionModel[]>) => void) => {
    const allActions = [...(oldActions || [])];
    const index = allActions.findIndex(a => a.id === action.id);
    allActions[index].isSelected = !action.isSelected;
    setActionsFunc(allActions);
  }, [])

  const toggleFavorite = useCallback((action: IActionModel) => {
    if (action.isFavorite) {
      storageService.removeFavoriteAction(action).then((updatedFavorites) => {
        setFavoriteActions(updatedFavorites);
        updateFavoriteStatusInLists(action.id, false);
      });
    } else {
      const favoriteAction = { ...action, isFavorite: true };
      storageService.addFavoriteAction(favoriteAction).then((updatedFavorites) => {
        setFavoriteActions(updatedFavorites);
        updateFavoriteStatusInLists(action.id, true);
      });
    }
  }, [storageService, updateFavoriteStatusInLists])

  const changeSelectionRecordedAction = useCallback((action: IActionModel) => {
    changeSelection(action, actions, setActions);
  }, [actions, changeSelection])

  const changeCopiedActionSelection = useCallback((action: IActionModel) => {
    changeSelection(action, myClipboardActions, setMyClipboardActions);
  }, [changeSelection, myClipboardActions])

  const changeFavoriteActionSelection = useCallback((action: IActionModel) => {
    changeSelection(action, favoriteActions, setFavoriteActions);
  }, [changeSelection, favoriteActions])

  const changePredefinedActionSelection = useCallback((action: IActionModel) => {
    changeSelection(action, predefinedActions, setPredefinedActions);
  }, [changeSelection, predefinedActions])

  const utilityConfig = useMemo(
    () => settings ? predefinedActionsService.toFunctionConfig(settings) : {},
    [settings, predefinedActionsService]
  );

  /**
   * Replace a preset with the version built by the parameter form and select it,
   * so the user can insert it straight into the editor.
   */
  const addConfiguredAction = useCallback((configured: IActionModel) => {
    setPredefinedActions(prev => {
      const next = prev.map(action => action.id === configured.id
        ? { ...configured, isFavorite: action.isFavorite, isSelected: true }
        : action);
      return next.some(action => action.id === configured.id)
        ? next
        : [{ ...configured, isSelected: true }, ...next];
    });
    setNotificationMessage(`${configured.title} configured and selected`);
    setIsSuccessNotification(true);
  }, []);

  const insertSelectedActionsToClipboard = useCallback(() => {
    const selectedActions = currentMode === Mode.Requests ? actions?.filter(a => a.isSelected) :
      currentMode === Mode.CopiedActions ? myClipboardActions?.filter(a => a.isSelected) :
        currentMode === Mode.Favorites ? favoriteActions?.filter(a => a.isSelected) :
          currentMode === Mode.PredefinedActions ? predefinedActions?.filter(a => a.isSelected) :
            [];

    if (!selectedActions || selectedActions.length === 0) {
      setNotificationMessage("No actions selected");
      setIsSuccessNotification(false);
      return;
    }

    // A utility preset with no function URL configured still pastes, but the URI
    // is a placeholder - say so rather than letting it fail at runtime.
    const unresolved = selectedActions.filter(a => utilityActionsService.hasUnresolvedTokens(a));

    communicationService.sendRequest({ actionType: ActionType.SetSelectedActionsIntoClipboardV3, message: selectedActions }, AppElement.ReactApp, AppElement.Content, (response) => {
      if (!response) {
        setNotificationMessage("Could not build the clipboard payload from the selected actions");
        setIsSuccessNotification(false);
        return;
      }

      navigator.clipboard.writeText(response);

      if (unresolved.length > 0) {
        setNotificationMessage(`Copied. ${unresolved.length} action(s) still use placeholder URLs - set the Function App URL in Settings.`);
        setIsSuccessNotification(false);
        return;
      }

      setNotificationMessage("Actions have been copied - now you can paste them in the Power Automate editor");
      setIsSuccessNotification(true);
    });
  }, [actions, myClipboardActions, favoriteActions, predefinedActions, currentMode, communicationService])

  const filterActionsBySearch = useCallback((actionsToFilter: IActionModel[]) => {
    if (!searchTerm || searchTerm.trim() === '') {
      return actionsToFilter;
    }
    return actionsToFilter?.filter(action =>
      action.title.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];
  }, [searchTerm])

  const filteredActions = useMemo(() => filterActionsBySearch(actions), [actions, filterActionsBySearch]);
  const filteredMyClipboardActions = useMemo(() => filterActionsBySearch(myClipboardActions), [myClipboardActions, filterActionsBySearch]);
  const filteredFavoriteActions = useMemo(() => filterActionsBySearch(favoriteActions), [favoriteActions, filterActionsBySearch]);

  const formatTimeLeft = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  const renderRecordButton = useCallback(() => {
    const recordingTitle = isRecording 
      ? (recordingTimeLeft ? `Stop Recording (${formatTimeLeft(recordingTimeLeft)} left)` : "Stop Recording")
      : "Start Recording";
    
    const hoverText = isRecording 
      ? (recordingTimeLeft ? `Stop Action Recording (${formatTimeLeft(recordingTimeLeft)} remaining)` : "Stop Action Recording")
      : "Start Action Recording";

    return isRecordingPage && !isPowerAutomatePage && <>{isRecording ?
      <Icon
        className="App-icon"
        iconName='CircleStopSolid'
        title={recordingTitle}
        onClick={sendRecordingStatus}
        onMouseEnter={() => { setHoverMessage(hoverText) }}
        onMouseLeave={() => { setHoverMessage(null) }}>
      </Icon> :
      <Icon
        className="App-icon"
        iconName='Record2'
        title={recordingTitle}
        onClick={sendRecordingStatus}
        onMouseEnter={() => { setHoverMessage(hoverText) }}
        onMouseLeave={() => { setHoverMessage(null) }}>
      </Icon>
    }</>
  }, [isRecording, isRecordingPage, isPowerAutomatePage, sendRecordingStatus, recordingTimeLeft, formatTimeLeft])

  const renderClearButton = useCallback(() => {
    return (isRecordingPage || isPowerAutomatePage || hasActionsOnPageToCopy) && <Icon
      className="App-icon"
      iconName='Clear'
      title="Clear Items"
      onClick={clearActionList}
      onMouseEnter={() => { setHoverMessage("Remove All Items from the Current List") }}
      onMouseLeave={() => { setHoverMessage(null) }}
    ></Icon>;
  }, [clearActionList, isPowerAutomatePage, isRecordingPage, hasActionsOnPageToCopy])

  const renderCopyButton = useCallback(() => {
    return isPowerAutomatePage && !isV3PowerAutomateEditor && <Icon
      className="App-icon"
      iconName='Copy'
      title="Copy Items"
      onClick={copyItems}
      onMouseEnter={() => { setHoverMessage("Copy Items to the 'My Clipboard' Section") }}
      onMouseLeave={() => { setHoverMessage(null) }}
    ></Icon>;
  }, [copyItems, isPowerAutomatePage, isV3PowerAutomateEditor])

  const renderGetClipboardActions = useCallback(() => {
    return isPowerAutomatePage && !isV3PowerAutomateEditor && <Icon
      className="App-icon"
      iconName='DoubleChevronDown12'
      title="Get 'My Clipboard Actions'"
      onClick={getMyClipboardActions}
      onMouseEnter={() => { setHoverMessage("Retrieve Actions from the 'My Clipboard' Section") }}
      onMouseLeave={() => { setHoverMessage(null) }}
    ></Icon>;
  }, [getMyClipboardActions, isPowerAutomatePage, isV3PowerAutomateEditor])

  const renderCopyAllActionsFromPage = useCallback(() => {
    return hasActionsOnPageToCopy && !isPowerAutomatePage && <Icon
      className="App-icon"
      iconName='SetAction'
      title="Copy All Actions from the Page"
      onClick={copyAllActionsFromPage}
      onMouseEnter={() => { setHoverMessage("Copy All Actions from the Page") }}
      onMouseLeave={() => { setHoverMessage(null) }}
    ></Icon>;
  }, [copyAllActionsFromPage, hasActionsOnPageToCopy, isPowerAutomatePage])

  const renderInsertToClipboardV3Button = useCallback(() => {
    return isV3PowerAutomateEditor && <Icon
      className="App-icon"
      iconName='Copy'
      title="Add Selected Actions to Clipboard"
      onClick={insertSelectedActionsToClipboard}
      onMouseEnter={() => { setHoverMessage("Add Selected Actions to Clipboard") }}
      onMouseLeave={() => { setHoverMessage(null) }}
    ></Icon>;
  }, [insertSelectedActionsToClipboard, isV3PowerAutomateEditor])

  const onSettingsChanged = useCallback((newSettings: ISettingsModel) => {
    getRecordingPageSetting(newSettings.isRecordingPage ?? null);
    getClassicPASetting(newSettings.isClassicPowerAutomatePage ?? null);
    getNewPASetting(newSettings.isModernPowerAutomatePage ?? null);

    // Sync theme if changed from settings
    if (newSettings.theme) {
      applyTheme(newSettings.theme);
    }

    // Handle predefined actions settings change
    handleSettingsChange(newSettings);
  }, [getRecordingPageSetting, getClassicPASetting, getNewPASetting, handleSettingsChange, applyTheme]);

  const renderSettingsButton = useCallback(() => {
    return <Icon
      className="App-icon"
      iconName='Settings'
      title="Settings"
      onClick={() => setShowSettings(!showSettings)}
      onMouseEnter={() => { setHoverMessage("Open Extension Settings") }}
      onMouseLeave={() => { setHoverMessage(null) }}
      styles={{
        root: {
          color: showSettings ? '#0078d4' : 'white',
          backgroundColor: showSettings ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
          borderRadius: '4px'
        }
      }}
    ></Icon>;
  }, [showSettings])

  const tryImportDesignerCopy = useCallback(async (text: string | null): Promise<boolean> => {
    const action = designerCopyService.parse(text);
    if (!action) { return false; }

    const updated = await storageService.addNewMyClipboardAction(action);
    setMyClipboardActions(updated);
    setNotificationMessage(`Imported "${action.title}" from the designer`);
    setIsSuccessNotification(true);
    return true;
  }, [storageService]);

  // Clipboard-first import, mirroring the designer's write order: its copy
  // handler uses navigator.clipboard.writeText and only falls back to the
  // msla-clipboard localStorage key when the async clipboard API is missing.
  const importFromDesigner = useCallback(async () => {
    let clipboardText: string | null = null;
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (e) {
      console.log('Clipboard read unavailable, falling back to localStorage', e);
    }

    if (await tryImportDesignerCopy(clipboardText)) { return; }

    communicationService.sendRequest(
      { actionType: ActionType.GetDesignerClipboardFallback, message: 'Get designer clipboard fallback' },
      AppElement.ReactApp,
      AppElement.Content,
      async (response) => {
        if (!(await tryImportDesignerCopy(response))) {
          setNotificationMessage('No copied designer action found. Copy an action in the designer first.');
          setIsSuccessNotification(false);
        }
      });
  }, [communicationService, tryImportDesignerCopy]);

  const openFlowEditor = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'open-flow-editor' } as FlowEditorActions, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to open flow editor:', chrome.runtime.lastError);
        setNotificationMessage('Failed to open flow editor');
        setIsSuccessNotification(false);
        return;
      }
      if (!response?.success) {
        setNotificationMessage(response?.error || 'Failed to open flow editor');
        setIsSuccessNotification(false);
      }
    });
  }, []);

  const renderFlowEditorButton = useCallback(() => {
    return isFlowPage && <Icon
      className="App-icon"
      iconName='Edit'
      title="Edit Flow JSON"
      onClick={openFlowEditor}
      onMouseEnter={() => { setHoverMessage("Open Flow JSON Editor") }}
      onMouseLeave={() => { setHoverMessage(null) }}
    ></Icon>;
  }, [isFlowPage, openFlowEditor])

  const renderThemeToggle = useCallback(() => {
    const prefersDark = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolvedTheme = activeTheme === 'system'
      ? (prefersDark ? 'dark' : 'light')
      : activeTheme;
    const iconName = resolvedTheme === 'dark' ? 'Sunny' : 'ClearNight';
    const title = resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';

    return <Icon
      className="App-icon"
      iconName={iconName}
      title={title}
      onClick={toggleTheme}
      onMouseEnter={() => { setHoverMessage(title) }}
      onMouseLeave={() => { setHoverMessage(null) }}
    />;
  }, [activeTheme, toggleTheme]);

  return (
    <div className="App">
      <header className="App-header">
        {renderRecordButton()}
        {renderClearButton()}
        {renderCopyButton()}
        {renderGetClipboardActions()}
        {renderCopyAllActionsFromPage()}
        {renderInsertToClipboardV3Button()}
        {renderFlowEditorButton()}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {renderThemeToggle()}
          {renderSettingsButton()}
        </div>
      </header>
      {notificationMessage ? <MessageBar
        messageBarType={isSuccessNotification ? MessageBarType.success : MessageBarType.warning}
        isMultiline={false}
        onDismiss={() => setNotificationMessage(null)}
        messageBarIconProps={{ iconName: isSuccessNotification ? 'Completed' : 'Warning' }}
      >{notificationMessage}
      </MessageBar> : <MessageBar
        messageBarType={MessageBarType.info}
        messageBarIconProps={{ iconName: 'Info', styles: { root: { display: !hoverMessage ? 'none' : 'block' } } }}
      >{hoverMessage}
      </MessageBar>}

      {showSettings ? (
        <div className="settings-panel">
          <Settings 
            storageService={storageService} 
            onSettingsChange={onSettingsChanged}
            onFavoritesImported={async () => {
              const favorites = await storageService.getFavoriteActions();
              setFavoriteActions(favorites);
            }}
          />
        </div>
      ) : (
        <Pivot onLinkClick={(item: PivotItem | undefined) => {
          switch (item?.props.headerText) {
            case "Recorded Requests":
              setCurrentMode(Mode.Requests);
              break;
            case "Copied Actions":
              setCurrentMode(Mode.CopiedActions);
              break;
            case "Favorites":
              setCurrentMode(Mode.Favorites);
              break;
            case "Predefined Actions":
              setCurrentMode(Mode.PredefinedActions);
              break;
          }
        }}>
          {<PivotItem
            headerText="Recorded Requests"
          >
            <ActionsList
              actions={filteredActions}
              mode={Mode.Requests}
              changeSelectionFunc={changeSelectionRecordedAction}
              deleteActionFunc={deleteRecordedAction}
              showButton={false}
              toggleFavoriteFunc={toggleFavorite}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
            />
          </PivotItem>}
          {<PivotItem
            headerText="Copied Actions"
          >
            <DefaultButton
              text="Import from designer"
              iconProps={{ iconName: 'Download' }}
              title="Import the action last copied inside the Power Automate designer"
              styles={{ root: { margin: '8px 0 0 8px' } }}
              onClick={importFromDesigner}
            />
            <ActionsList
              actions={filteredMyClipboardActions}
              mode={Mode.CopiedActions}
              changeSelectionFunc={changeCopiedActionSelection}
              deleteActionFunc={deleteMyClipboardAction}
              showButton={false}
              toggleFavoriteFunc={toggleFavorite}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
            />
          </PivotItem>}
          {<PivotItem
            headerText="Favorites"
          >
            <ActionsList
              actions={filteredFavoriteActions}
              mode={Mode.Favorites}
              changeSelectionFunc={changeFavoriteActionSelection}
              deleteActionFunc={deleteFavoriteAction}
              showButton={false}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
            />
          </PivotItem>}
          {(settings?.showPredefinedActions || settings?.showUtilityActions) && (
            <PivotItem headerText="Predefined Actions">
              <PredefinedActionsList
                actions={predefinedActions}
                isLoading={predefinedActionsLoading}
                onRefresh={refreshPredefinedActions}
                changeSelectionFunc={changePredefinedActionSelection}
                toggleFavoriteFunc={toggleFavorite}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                utilityConfig={utilityConfig}
                onConfiguredAction={addConfiguredAction}
              />
            </PivotItem>
          )}
        </Pivot>
      )}
    </div >
  );
}

export default App;
