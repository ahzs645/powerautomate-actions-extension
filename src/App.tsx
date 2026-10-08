import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton, DefaultButton, IButtonStyles, IconButton, MessageBarButton, PrimaryButton, Dialog, DialogFooter, DialogType, MessageBar, MessageBarType, Pivot, PivotItem, ThemeProvider, TooltipHost } from '@fluentui/react';
import './App.css';
import { ActionType, IDataChromeMessage, AppElement, ICommunicationChromeMessage, IInitialState, Mode } from './models';
import { IActionModel } from './models/IActionModel';
import { ISettingsModel, ThemeMode } from './models/ISettingsModel';
import { StorageService } from './services/StorageService';
import { ExtensionCommunicationService } from './services/ExtensionCommunicationService';
import { PredefinedActionsService } from './services/PredefinedActionsService';
import { PlaceholderService } from './services/PlaceholderService';
import { designerCopyService } from './services/DesignerCopyService';
import { ContentService } from './services/ContentService';
import { utilityActionsService } from './services/UtilityActionsService';
import { getFluentTheme, loadFluentTheme, resolveTheme } from './theme/fluentTheme';
import ActionsList from './components/ActionsList';
import Settings, { SettingsFocus } from './components/Settings';
import PredefinedActionsList from './components/PredefinedActionsList';
import { FlowEditorActions } from './services/interfaces/IFlowEditorActions';

interface IEnsureContentScriptResult {
  success: boolean;
  injected?: boolean;
  error?: string;
}

type NotificationKind = 'success' | 'warning';

const ENSURE_REUSE_MS = 1500;
const ENSURE_TIMEOUT_MS = 3000;
const SUCCESS_DISMISS_MS = 4000;

const TAB_KEYS: Record<string, Mode> = {
  recorded: Mode.Requests,
  copied: Mode.CopiedActions,
  favorites: Mode.Favorites,
  library: Mode.PredefinedActions,
};
const modeToTabKey = (mode: Mode): string =>
  Object.keys(TAB_KEYS).find(key => TAB_KEYS[key] === mode) || 'recorded';

/** Keeps the page bar and selection bar on one line in the 600px popup. */
const compactButtonStyles: IButtonStyles = {
  root: { height: 30, padding: '0 10px', minWidth: 0 },
  label: { whiteSpace: 'nowrap', margin: '0 0 0 4px' },
  icon: { margin: 0 },
};

/** Header / toolbar icon button: focusable, named, with a real tooltip. */
const ToolbarIconButton: React.FC<{
  label: string;
  iconName: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  checked?: boolean;
}> = ({ label, iconName, onClick, className, disabled, checked }) => (
  <TooltipHost content={label}>
    <IconButton
      className={className}
      iconProps={{ iconName }}
      ariaLabel={label}
      onClick={onClick}
      disabled={disabled}
      checked={checked}
    />
  </TooltipHost>
);

function App(initialState?: IInitialState | undefined) {
  const storageService = useMemo(() => { return new StorageService(); }, []);
  const communicationService = useMemo(() => { return new ExtensionCommunicationService(); }, []);
  const predefinedActionsService = useMemo(() => { return new PredefinedActionsService(); }, []);
  const placeholderService = useMemo(() => new PlaceholderService(), []);
  // Only its pure clipboard builder is used here; nothing touches the page.
  const clipboardBuilder = useMemo(() => new ContentService(storageService, communicationService), [storageService, communicationService]);
  const [isRecording, setIsRecording] = useState<boolean>(initialState?.isRecording || false);
  const [isPowerAutomatePage, setIsPowerAutomatePage] = useState<boolean>(initialState?.isPowerAutomatePage || false);
  const [isRecordingPage, setIsRecordingPage] = useState<boolean>(initialState?.isRecordingPage || false);
  const [hasActionsOnPageToCopy, setHasActionsOnPageToCopy] = useState<boolean>(initialState?.hasActionsOnPageToCopy || false);
  const [actions, setActions] = useState<IActionModel[]>(initialState?.actions || []);
  const [myClipboardActions, setMyClipboardActions] = useState<IActionModel[]>(initialState?.myClipboardActions || []);
  const [currentMode, setCurrentMode] = useState<Mode>(
    initialState?.currentMode !== undefined && initialState.currentMode !== Mode.Settings ? initialState.currentMode : Mode.Requests);
  const [favoriteActions, setFavoriteActions] = useState<IActionModel[]>(initialState?.favoriteActions || []);
  const [predefinedActions, setPredefinedActions] = useState<IActionModel[]>([]);
  const [predefinedActionsLoading, setPredefinedActionsLoading] = useState<boolean>(false);
  const [isV3PowerAutomateEditor, setIsV3PowerAutomateEditor] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ text: string; kind: NotificationKind } | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [settings, setSettings] = useState<ISettingsModel | null>(null);
  const [recordingTimeLeft, setRecordingTimeLeft] = useState<number | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isFlowPage, setIsFlowPage] = useState<boolean>(false);
  const [isEnvironmentPage, setIsEnvironmentPage] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<ThemeMode>('system');
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  const notify = useCallback((text: string, kind: NotificationKind) => {
    setNotification({ text, kind });
  }, []);

  // Success messages are confirmations; let them go on their own.
  useEffect(() => {
    if (notification?.kind !== 'success') { return; }
    const timer = setTimeout(() => setNotification(null), SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification]);

  // Content scripts are only declared for Power Platform / SharePoint hosts.
  // Everywhere else (community blogs with copyable actions) the background
  // injects one on demand using the activeTab grant. Every message to the page
  // goes through sendToContent so it never races the injection. Calls made
  // close together share one probe.
  const ensureRef = useRef<{ at: number; promise: Promise<IEnsureContentScriptResult | undefined> } | null>(null);
  const ensureContentScript = useCallback((): Promise<IEnsureContentScriptResult | undefined> => {
    const now = Date.now();
    if (ensureRef.current && now - ensureRef.current.at < ENSURE_REUSE_MS) {
      return ensureRef.current.promise;
    }
    const request = (async () => {
      try {
        return await chrome.runtime.sendMessage({ type: 'ensure-content-script' }) as IEnsureContentScriptResult | undefined;
      } catch (error) {
        console.log('ensure-content-script failed, continuing', error);
        return undefined;
      }
    })();
    // Never block the popup on a worker that does not answer.
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ENSURE_TIMEOUT_MS));
    const promise = Promise.race([request, timeout]);
    ensureRef.current = { at: now, promise };
    return promise;
  }, []);

  const sendToContent = useCallback(async (message: IDataChromeMessage, callback?: (response: any) => void) => {
    await ensureContentScript();
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content, callback);
  }, [communicationService, ensureContentScript]);

  const applyTheme = useCallback((mode: ThemeMode) => {
    setActiveTheme(mode);
    if (mode === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = mode;
    }
    // Portalled surfaces (dialogs, callouts) miss the ThemeProvider tree
    loadFluentTheme(resolveTheme(mode));
  }, []);

  const resolvedTheme = useMemo(() => {
    const prefersDark = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return activeTheme === 'system' ? (prefersDark ? 'dark' : 'light') : activeTheme;
  }, [activeTheme]);

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await storageService.updateSettings({ theme: next });
  }, [resolvedTheme, applyTheme, storageService]);

  const listenToMessage = useCallback((message: ICommunicationChromeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.to !== AppElement.ReactApp) { return console.log('Incorrect message destination'); }
    switch (message.actionType) {
      case ActionType.ActionUpdated:
        message.message && setActions(message.message);
        break;
      case ActionType.MyClipboardActionsUpdated:
        message.message && setMyClipboardActions(message.message);
        break;
    }
  }, []);

  const getRecordingPageSetting = useCallback(async (isRecordingPageSetting: boolean | null) => {
    if (isRecordingPageSetting !== null) {
      setIsRecordingPage(isRecordingPageSetting);
    } else {
      sendToContent({ actionType: ActionType.CheckRecordingPage, message: "Check Recording Page" }, (response) => {
        setIsRecordingPage(!!response);
      });
    }
  }, [sendToContent]);

  const getClassicPASetting = useCallback(async (isPAEditorPage: boolean | null) => {
    if (isPAEditorPage !== null) {
      setIsPowerAutomatePage(isPAEditorPage);
    } else {
      sendToContent({ actionType: ActionType.CheckPowerAutomatePage, message: "Check PowerAutomate Page" }, (response) => {
        setIsPowerAutomatePage(!!response);
      });
    }
  }, [sendToContent]);

  const getNewPASetting = useCallback(async (isNewPAEditorPage: boolean | null) => {
    if (isNewPAEditorPage !== null) {
      setIsV3PowerAutomateEditor(isNewPAEditorPage);
    } else {
      sendToContent({ actionType: ActionType.CheckIsNewPowerAutomateEditorV3, message: "Check If Page is a new Power Automate editor" }, (response) => {
        setIsV3PowerAutomateEditor(!!response);
      });
    }
  }, [sendToContent]);

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
    const maxTimeMs = maxRecordingTimeMinutes * 60 * 1000;
    const remainingMs = startTime ? maxTimeMs - (Date.now() - startTime) : maxTimeMs;
    setRecordingTimeLeft(Math.ceil(remainingMs / 1000));

    recordingTimerRef.current = setTimeout(() => {
      const message: IDataChromeMessage = {
        actionType: ActionType.StopRecording,
        message: "Stop recording - time limit reached"
      };
      communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
        setIsRecording(response);
        notify(`Recording stopped automatically after ${maxRecordingTimeMinutes} minutes`, 'warning');
        stopRecordingTimer();
      });
    }, remainingMs);

    if (!startTime) {
      await storageService.setRecordingStartTime(Date.now());
    }

    countdownTimerRef.current = setInterval(() => {
      setRecordingTimeLeft(prevTime => {
        if (prevTime === null || prevTime <= 1) {
          return null;
        }
        return prevTime - 1;
      });
    }, 1000);
  }, [communicationService, stopRecordingTimer, storageService, notify]);

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

  /**
   * Builds the new designer's clipboard payload in the popup itself, so copying
   * works on any tab (it never needed the page) and writes it to the clipboard.
   */
  const copyForNewDesigner = useCallback(async (selected: IActionModel[]): Promise<boolean> => {
    const payload = clipboardBuilder.setSelectedActionsIntoClipboardV3({
      actionType: ActionType.SetSelectedActionsIntoClipboardV3,
      message: selected,
      from: AppElement.ReactApp,
      to: AppElement.Content,
    });
    if (!payload) {
      notify(selected.length === 1
        ? "Could not build the clipboard payload for this action"
        : "Could not build the clipboard payload from the selected actions", 'warning');
      return false;
    }
    try {
      await navigator.clipboard.writeText(payload);
    } catch (error) {
      console.error('Clipboard write failed', error);
      notify('Could not write to the clipboard', 'warning');
      return false;
    }
    return true;
  }, [clipboardBuilder, notify]);

  // Single-action copy used by the "copy with options" dialog once the user has
  // filled in the action's {{PLACEHOLDER}} values.
  const handleCopyPredefinedAction = useCallback(async (action: IActionModel) => {
    const unresolved = utilityActionsService.hasUnresolvedTokens(action);
    if (isPowerAutomatePage && !isV3PowerAutomateEditor) {
      sendToContent({ actionType: ActionType.CopyAction, message: [action] });
      notify("Action copied - paste it in the Power Automate editor", 'success');
      return;
    }
    if (!(await copyForNewDesigner([action]))) { return; }
    if (unresolved) {
      notify("Copied. The action still uses placeholder URLs - set the Function App URL in Settings.", 'warning');
      return;
    }
    notify("Action copied - paste it in the Power Automate editor", 'success');
  }, [isPowerAutomatePage, isV3PowerAutomateEditor, sendToContent, copyForNewDesigner, notify]);

  const refreshPredefinedActions = useCallback(async () => {
    if (!settings) { return; }

    setPredefinedActionsLoading(true);
    try {
      const actions = await predefinedActionsService.refreshAll(settings);
      setPredefinedActions(actions);
      notify('Predefined actions refreshed successfully', 'success');
    } catch (error) {
      console.error('Failed to refresh predefined actions:', error);
      notify('Failed to refresh predefined actions', 'warning');
    } finally {
      setPredefinedActionsLoading(false);
    }
  }, [settings, predefinedActionsService, notify]);

  const checkFlowPage = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'check-flow-page' } as FlowEditorActions, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to check flow page:', chrome.runtime.lastError);
        setIsFlowPage(false);
        setIsEnvironmentPage(false);
        return;
      }
      setIsFlowPage(response?.isFlowPage || false);
      setIsEnvironmentPage(response?.isEnvironmentPage || false);
    });
  }, []);

  const initData = useCallback(async () => {
    const settings = await storageService.getSettings();
    setSettings(settings);

    // Apply stored theme
    applyTheme(settings.theme || 'system');

    // Make sure the page has a content script before asking it anything;
    // a failure (chrome:// pages, the Web Store) just means no page features.
    await ensureContentScript();

    getRecordingPageSetting(settings.isRecordingPage ?? null);
    getClassicPASetting(settings.isClassicPowerAutomatePage ?? null);
    getNewPASetting(settings.isModernPowerAutomatePage ?? null);
    checkFlowPage();

    sendToContent({ actionType: ActionType.CheckIfPageHasActionsToCopy, message: "Check If Page has actions to copy" }, (response) => {
      setHasActionsOnPageToCopy(!!response);
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
          startRecordingTimer(settings.maximumRecordingTimeMinutes, settings.recordingStartTime);
        } else {
          const message: IDataChromeMessage = {
            actionType: ActionType.StopRecording,
            message: "Stop recording - time limit already reached"
          };
          communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
            setIsRecording(response);
            notify(`Recording was stopped automatically - time limit exceeded`, 'warning');
            stopRecordingTimer();
          });
        }
      }
    });

  }, [communicationService, storageService, getRecordingPageSetting, getClassicPASetting, getNewPASetting, startRecordingTimer, stopRecordingTimer, loadPredefinedActions, checkFlowPage, applyTheme, ensureContentScript, sendToContent, notify]);

  useEffect(() => {
    initData();
  }, [initData]);

  useEffect(() => {
    chrome.runtime.onMessage.addListener(listenToMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(listenToMessage);
    };
  }, [listenToMessage]);

  useEffect(() => {
    return () => {
      stopRecordingTimer();
    };
  }, [stopRecordingTimer]);

  const copyAllActionsFromPage = useCallback(() => {
    sendToContent({
      actionType: ActionType.CopyAllActionsFromPage,
      message: "Copy All Actions From the Page",
    });
  }, [sendToContent]);

  const getListForMode = useCallback((mode: Mode): IActionModel[] => {
    switch (mode) {
      case Mode.Requests: return actions || [];
      case Mode.CopiedActions: return myClipboardActions || [];
      case Mode.Favorites: return favoriteActions || [];
      case Mode.PredefinedActions: return predefinedActions || [];
      default: return [];
    }
  }, [actions, myClipboardActions, favoriteActions, predefinedActions]);

  const setListForMode = useCallback((mode: Mode, update: (prev: IActionModel[]) => IActionModel[]) => {
    switch (mode) {
      case Mode.Requests: setActions(prev => update(prev || [])); break;
      case Mode.CopiedActions: setMyClipboardActions(prev => update(prev || [])); break;
      case Mode.Favorites: setFavoriteActions(prev => update(prev || [])); break;
      case Mode.PredefinedActions: setPredefinedActions(prev => update(prev || [])); break;
    }
  }, []);

  const updateFavoriteStatusInLists = useCallback((actionId: string, isFavorite: boolean) => {
    const apply = (prev: IActionModel[]) => (prev ?? []).map(action =>
      action.id === actionId ? { ...action, isFavorite } : action);
    setActions(apply);
    setMyClipboardActions(apply);
    setPredefinedActions(apply);
  }, [])

  // Clear is only offered on stored lists (the library just reloads), and only
  // after the user confirms in a dialog.
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
      case Mode.Favorites: {
        const cleared = favoriteActions || [];
        storageService.clearFavoriteActions();
        setFavoriteActions([]);
        cleared.forEach(action => updateFavoriteStatusInLists(action.id, false));
        break;
      }
    }
    setIsClearDialogOpen(false);
  }, [currentMode, storageService, favoriteActions, updateFavoriteStatusInLists])

  const copyItems = useCallback(() => {
    const selectedActions = getListForMode(currentMode).filter(a => a.isSelected);

    if (selectedActions.length === 0) {
      notify("No actions selected", 'warning');
      return;
    }

    sendToContent({
      actionType: ActionType.CopyAction,
      message: selectedActions,
    });
    notify(`${selectedActions.length} action(s) sent to My Clipboard`, 'success');
  }, [getListForMode, currentMode, sendToContent, notify])

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

  const editAction = useCallback((action: IActionModel, setActionsFunc: (value: React.SetStateAction<IActionModel[]>)
    => void, actionType: ActionType) => {
    const message: IDataChromeMessage = {
      actionType: actionType,
      message: action,
    }
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, (response) => {
      if (response) {
        setActionsFunc(response);
      }
    });
  }, [communicationService])

  const editRecordedAction = useCallback((action: IActionModel) => {
    editAction(action, setActions, ActionType.UpdateAction);
  }, [setActions, editAction])

  const editMyClipboardAction = useCallback((action: IActionModel) => {
    editAction(action, setMyClipboardActions, ActionType.UpdateMyClipboardAction);
  }, [setMyClipboardActions, editAction])

  const editFavoriteAction = useCallback((action: IActionModel) => {
    storageService.updateFavoriteAction(action).then((updatedFavorites) => {
      setFavoriteActions(updatedFavorites);
    });
  }, [storageService])

  const deleteFavoriteAction = useCallback((action: IActionModel) => {
    storageService.removeFavoriteAction(action).then((updatedFavorites) => {
      setFavoriteActions(updatedFavorites);
      updateFavoriteStatusInLists(action.id, false);
    });
  }, [storageService, updateFavoriteStatusInLists])

  const getMyClipboardActions = useCallback(() => {
    sendToContent({
      actionType: ActionType.GetElementsFromMyClipboard,
      message: "Get My Clipboard Actions",
    });
  }, [sendToContent])

  const changeSelection = useCallback((mode: Mode, action: IActionModel) => {
    setListForMode(mode, prev => prev.map(a => a.id === action.id ? { ...a, isSelected: !a.isSelected } : a));
  }, [setListForMode])

  const toggleFavorite = useCallback((action: IActionModel) => {
    if (action.isFavorite) {
      storageService.removeFavoriteAction(action).then((updatedFavorites) => {
        setFavoriteActions(updatedFavorites);
        updateFavoriteStatusInLists(action.id, false);
      });
    } else {
      const favoriteAction = { ...action, isFavorite: true, isSelected: false };
      storageService.addFavoriteAction(favoriteAction).then((updatedFavorites) => {
        setFavoriteActions(updatedFavorites);
        updateFavoriteStatusInLists(action.id, true);
      });
    }
  }, [storageService, updateFavoriteStatusInLists])

  const changeSelectionRecordedAction = useCallback((action: IActionModel) => changeSelection(Mode.Requests, action), [changeSelection]);
  const changeCopiedActionSelection = useCallback((action: IActionModel) => changeSelection(Mode.CopiedActions, action), [changeSelection]);
  const changeFavoriteActionSelection = useCallback((action: IActionModel) => changeSelection(Mode.Favorites, action), [changeSelection]);
  const changePredefinedActionSelection = useCallback((action: IActionModel) => changeSelection(Mode.PredefinedActions, action), [changeSelection]);

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
    notify(`${configured.title} configured and selected`, 'success');
  }, [notify]);

  const insertSelectedActionsToClipboard = useCallback(async () => {
    const selectedActions = getListForMode(currentMode).filter(a => a.isSelected);

    if (selectedActions.length === 0) {
      notify("No actions selected", 'warning');
      return;
    }

    // A utility preset with no function URL configured still pastes, but the URI
    // is a placeholder - say so rather than letting it fail at runtime.
    const unresolved = selectedActions.filter(a => utilityActionsService.hasUnresolvedTokens(a));

    if (!(await copyForNewDesigner(selectedActions))) { return; }

    if (unresolved.length > 0) {
      notify(`Copied. ${unresolved.length} action(s) still use placeholder URLs - set the Function App URL in Settings.`, 'warning');
      return;
    }

    notify("Actions have been copied - now you can paste them in the Power Automate editor", 'success');
  }, [getListForMode, currentMode, copyForNewDesigner, notify])

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

  const openSettings = useCallback((focus: SettingsFocus | null = null) => {
    setSettingsFocus(focus);
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsFocus(null);
  }, []);

  const tryImportDesignerCopy = useCallback(async (text: string | null): Promise<boolean> => {
    const action = designerCopyService.parse(text);
    if (!action) { return false; }

    const updated = await storageService.addNewMyClipboardAction(action);
    setMyClipboardActions(updated);
    notify(`Imported "${action.title}" from the designer`, 'success');
    return true;
  }, [storageService, notify]);

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

    sendToContent(
      { actionType: ActionType.GetDesignerClipboardFallback, message: 'Get designer clipboard fallback' },
      async (response) => {
        if (!(await tryImportDesignerCopy(response))) {
          notify('No copied designer action found. Copy an action in the designer first.', 'warning');
        }
      });
  }, [tryImportDesignerCopy, sendToContent, notify]);

  const openFlowTool = useCallback((type: 'open-flow-editor' | 'open-flows-list', failure: string) => {
    chrome.runtime.sendMessage({ type } as FlowEditorActions, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`${failure}:`, chrome.runtime.lastError);
        notify(failure, 'warning');
        return;
      }
      if (!response?.success) {
        notify(response?.error || failure, 'warning');
      }
    });
  }, [notify]);

  const openFlowEditor = useCallback(() => openFlowTool('open-flow-editor', 'Failed to open flow editor'), [openFlowTool]);
  const openFlowsList = useCallback(() => openFlowTool('open-flows-list', 'Failed to open flows list'), [openFlowTool]);

  const turnToolkitOn = useCallback(async () => {
    const updated = await storageService.updateSettings({ extensionEnabled: true });
    setSettings(updated);
    // An open Settings view keeps its own copy; remount it so the toggle follows.
    setSettingsRevision(r => r + 1);
  }, [storageService]);

  const isToolkitOff = settings?.extensionEnabled === false;
  const isClassicDesigner = isPowerAutomatePage && !isV3PowerAutomateEditor;

  const detectedPage = useMemo(() => {
    if (isV3PowerAutomateEditor) { return 'Modern designer'; }
    // The classic designer has no marker of its own: a flow URL, or the
    // user's "Classic Power Automate Editor" override, identifies it.
    if (isPowerAutomatePage && (isFlowPage || settings?.isClassicPowerAutomatePage === true)) { return 'Classic designer'; }
    if (isPowerAutomatePage) { return 'Power Automate'; }
    if (isRecordingPage) { return settings?.isRecordingPage === true ? 'Recording page' : 'SharePoint page'; }
    if (hasActionsOnPageToCopy) { return 'Page with actions'; }
    return 'Other';
  }, [isV3PowerAutomateEditor, isPowerAutomatePage, isFlowPage, isRecordingPage, hasActionsOnPageToCopy, settings?.isRecordingPage, settings?.isClassicPowerAutomatePage]);

  const recordingLabel = isRecording
    ? (recordingTimeLeft ? `Stop recording (${formatTimeLeft(recordingTimeLeft)} left)` : 'Stop recording')
    : 'Start recording';

  const selectedInCurrentList = getListForMode(currentMode).filter(a => a.isSelected);
  const currentListCount = getListForMode(currentMode).length;

  const clearSelection = useCallback(() => {
    setListForMode(currentMode, prev => prev.map(a => a.isSelected ? { ...a, isSelected: false } : a));
  }, [currentMode, setListForMode]);

  const addSelectionToFavorites = useCallback(async () => {
    const toAdd = getListForMode(currentMode).filter(a => a.isSelected && !a.isFavorite);
    if (toAdd.length === 0) {
      notify('The selected actions are already favorites', 'success');
      return;
    }
    let updated: IActionModel[] = [];
    for (const action of toAdd) {
      updated = await storageService.addFavoriteAction({ ...action, isFavorite: true, isSelected: false });
      updateFavoriteStatusInLists(action.id, true);
    }
    setFavoriteActions(updated);
    notify(`Added ${toAdd.length} action(s) to favorites`, 'success');
  }, [getListForMode, currentMode, storageService, updateFavoriteStatusInLists, notify]);

  const clearNoun: Partial<Record<Mode, string>> = {
    [Mode.Requests]: 'recorded actions',
    [Mode.CopiedActions]: 'copied actions',
    [Mode.Favorites]: 'favorites',
  };

  const renderPrimaryArea = () => {
    const hasFlowContext = isFlowPage || isEnvironmentPage;
    return (
      <div className="App-pagebar" role="toolbar" aria-label="Page actions">
        <div className="App-pagebar-context">
          <span className="page-chip" title="What the toolkit detected on the active tab">
            Detected: <strong>{detectedPage}</strong>
          </span>
          {!hasFlowContext && <span className="page-hint">Open a flow in Power Automate</span>}
          <span className="recording-status" role="status" aria-live="polite">
            {isRecording && (
              <>
                <span className="recording-dot" aria-hidden="true" />
                Recording…{recordingTimeLeft ? <span className="recording-time"> {formatTimeLeft(recordingTimeLeft)} left</span> : null}
              </>
            )}
          </span>
        </div>
        <div className="App-pagebar-actions">
          {isFlowPage || !isEnvironmentPage ? (
            <PrimaryButton
              text="Edit flow JSON"
              styles={compactButtonStyles}
              iconProps={{ iconName: 'Code' }}
              onClick={openFlowEditor}
              disabled={!isFlowPage}
              allowDisabledFocus
            />
          ) : null}
          {isFlowPage || !isEnvironmentPage ? (
            <DefaultButton
              text="Browse flows"
              styles={compactButtonStyles}
              iconProps={{ iconName: 'BulletedList2' }}
              onClick={openFlowsList}
              disabled={!isEnvironmentPage}
              allowDisabledFocus
            />
          ) : (
            <PrimaryButton
              text="Browse flows"
              styles={compactButtonStyles}
              iconProps={{ iconName: 'BulletedList2' }}
              onClick={openFlowsList}
            />
          )}
          <div className="App-pagebar-tools">
            {isRecordingPage && !isPowerAutomatePage && (
              <ToolbarIconButton
                label={recordingLabel}
                iconName={isRecording ? 'CircleStopSolid' : 'Record2'}
                onClick={sendRecordingStatus}
                className={`record-button${isRecording ? ' recording-active' : ''}`}
                disabled={isToolkitOff && !isRecording}
              />
            )}
            {isClassicDesigner && (
              <ToolbarIconButton
                label="Copy to My Clipboard (classic designer)"
                iconName="Copy"
                onClick={copyItems}
              />
            )}
            {isClassicDesigner && (
              <ToolbarIconButton
                label="Get actions from My Clipboard (classic designer)"
                iconName="Download"
                onClick={getMyClipboardActions}
              />
            )}
            {hasActionsOnPageToCopy && !isPowerAutomatePage && (
              <ToolbarIconButton
                label="Copy all actions from this page"
                iconName="SetAction"
                onClick={copyAllActionsFromPage}
              />
            )}
            {isV3PowerAutomateEditor && (
              <ToolbarIconButton
                label="Copy selected for new designer"
                iconName="PasteAsCode"
                onClick={insertSelectedActionsToClipboard}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSelectionBar = () => {
    const count = selectedInCurrentList.length;
    if (showSettings || count === 0) { return null; }
    return (
      <div className="selection-bar" role="region" aria-label="Selected actions">
        <span className="selection-bar-count" aria-live="polite">{count} selected</span>
        <PrimaryButton
          text={isClassicDesigner ? 'Copy to My Clipboard' : 'Copy for new designer'}
          iconProps={{ iconName: isClassicDesigner ? 'Copy' : 'PasteAsCode' }}
          onClick={isClassicDesigner ? copyItems : insertSelectedActionsToClipboard}
          styles={compactButtonStyles}
        />
        {currentMode !== Mode.Favorites && (
          <DefaultButton
            text="Add to favorites"
            onClick={addSelectionToFavorites}
            styles={compactButtonStyles}
          />
        )}
        <ActionButton
          text="Clear selection"
          onClick={clearSelection}
          styles={compactButtonStyles}
        />
      </div>
    );
  };

  const listEmptyStates = {
    [Mode.Requests]: {
      iconName: 'Record2',
      title: 'No recorded requests yet',
      hint: 'Click Record, then use SharePoint — requests appear here.',
    },
    [Mode.CopiedActions]: {
      iconName: 'Copy',
      title: 'No copied actions yet',
      hint: 'Copy an action in the designer, then click Import from designer.',
    },
    [Mode.Favorites]: {
      iconName: 'FavoriteStar',
      title: 'No favorites yet',
      hint: 'Star any action to keep it here.',
    },
  };

  const renderTabContent = () => {
    const clearProps = {
      onClearAll: () => setIsClearDialogOpen(true),
      clearLabel: `Clear all ${clearNoun[currentMode] ?? 'actions'}`,
    };
    switch (currentMode) {
      case Mode.CopiedActions:
        return (
          <ActionsList
            actions={filteredMyClipboardActions}
            totalCount={myClipboardActions?.length ?? 0}
            mode={Mode.CopiedActions}
            changeSelectionFunc={changeCopiedActionSelection}
            deleteActionFunc={deleteMyClipboardAction}
            editActionFunc={editMyClipboardAction}
            showButton={false}
            toggleFavoriteFunc={toggleFavorite}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            placeholderService={placeholderService}
            emptyState={listEmptyStates[Mode.CopiedActions]}
            toolbar={
              <DefaultButton
                text="Import from designer"
                iconProps={{ iconName: 'Download' }}
                title="Import the action last copied inside the Power Automate designer"
                onClick={importFromDesigner}
              />
            }
            {...clearProps}
          />
        );
      case Mode.Favorites:
        return (
          <ActionsList
            actions={filteredFavoriteActions}
            totalCount={favoriteActions?.length ?? 0}
            mode={Mode.Favorites}
            changeSelectionFunc={changeFavoriteActionSelection}
            deleteActionFunc={deleteFavoriteAction}
            editActionFunc={editFavoriteAction}
            showButton={false}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            placeholderService={placeholderService}
            emptyState={listEmptyStates[Mode.Favorites]}
            {...clearProps}
          />
        );
      case Mode.PredefinedActions:
        return (
          <PredefinedActionsList
            actions={predefinedActions}
            isLoading={predefinedActionsLoading}
            onRefresh={refreshPredefinedActions}
            changeSelectionFunc={changePredefinedActionSelection}
            toggleFavoriteFunc={toggleFavorite}
            onCopyAction={handleCopyPredefinedAction}
            placeholderService={placeholderService}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            utilityConfig={utilityConfig}
            onConfiguredAction={addConfiguredAction}
            onOpenSettings={openSettings}
          />
        );
      case Mode.Requests:
      default:
        return (
          <ActionsList
            actions={filteredActions}
            totalCount={actions?.length ?? 0}
            mode={Mode.Requests}
            changeSelectionFunc={changeSelectionRecordedAction}
            deleteActionFunc={deleteRecordedAction}
            editActionFunc={editRecordedAction}
            showButton={false}
            toggleFavoriteFunc={toggleFavorite}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            placeholderService={placeholderService}
            emptyState={listEmptyStates[Mode.Requests]}
            {...clearProps}
          />
        );
    }
  };

  const showLibraryTab = !!(settings?.showPredefinedActions || settings?.showUtilityActions);
  const tabCount = (n: number | undefined) => (n && n > 0 ? n : undefined);

  return (
    <ThemeProvider theme={getFluentTheme(resolveTheme(activeTheme))} className="App">
      <header className="App-header">
        <span className="App-header-title">Power Automate Toolkit</span>
        <span className="App-header-spacer" />
        <ToolbarIconButton
          className="App-icon"
          label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          iconName={resolvedTheme === 'dark' ? 'Sunny' : 'ClearNight'}
          onClick={toggleTheme}
        />
        <ToolbarIconButton
          className="App-icon"
          label="Settings"
          iconName="Settings"
          onClick={() => (showSettings ? closeSettings() : openSettings())}
          checked={showSettings}
        />
      </header>

      {isToolkitOff && (
        <MessageBar
          messageBarType={MessageBarType.warning}
          isMultiline={false}
          actions={<MessageBarButton onClick={turnToolkitOn}>Turn on</MessageBarButton>}
        >
          Toolkit is turned off
        </MessageBar>
      )}

      {!showSettings && renderPrimaryArea()}

      {notification && (
        <MessageBar
          className="App-notification-bar"
          messageBarType={notification.kind === 'success' ? MessageBarType.success : MessageBarType.warning}
          isMultiline={true}
          onDismiss={() => setNotification(null)}
          dismissButtonAriaLabel="Dismiss"
        >
          {notification.text}
        </MessageBar>
      )}

      {showSettings ? (
        <div className="settings-panel">
          <Settings
            key={settingsRevision}
            storageService={storageService}
            onSettingsChange={onSettingsChanged}
            placeholderService={placeholderService}
            onBack={closeSettings}
            focusSection={settingsFocus}
            onFavoritesImported={async () => {
              const favorites = await storageService.getFavoriteActions();
              setFavoriteActions(favorites);
            }}
          />
        </div>
      ) : (
        <>
          <Pivot
            className="App-tabs"
            headersOnly={true}
            selectedKey={modeToTabKey(currentMode)}
            overflowBehavior="menu"
            overflowAriaLabel="More tabs"
            onLinkClick={(item?: PivotItem) => {
              const key = item?.props.itemKey;
              if (key && TAB_KEYS[key] !== undefined) {
                setCurrentMode(TAB_KEYS[key]);
              }
            }}
          >
            <PivotItem itemKey="recorded" headerText="Recorded" itemCount={tabCount(actions?.length)} />
            <PivotItem itemKey="copied" headerText="Copied" itemCount={tabCount(myClipboardActions?.length)} />
            <PivotItem itemKey="favorites" headerText="Favorites" itemCount={tabCount(favoriteActions?.length)} />
            {showLibraryTab && (
              <PivotItem itemKey="library" headerText="Library" itemCount={tabCount(predefinedActions?.length)} />
            )}
          </Pivot>
          <main className="App-content">
            {renderTabContent()}
          </main>
          {renderSelectionBar()}
        </>
      )}

      <Dialog
        hidden={!isClearDialogOpen}
        onDismiss={() => setIsClearDialogOpen(false)}
        dialogContentProps={{
          type: DialogType.normal,
          title: `Clear ${currentListCount} ${clearNoun[currentMode] ?? 'actions'}?`,
          subText: "This removes them from the extension's storage and cannot be undone.",
        }}
        modalProps={{ isBlocking: false }}
      >
        <DialogFooter>
          <PrimaryButton text="Clear" onClick={clearActionList} />
          <DefaultButton text="Cancel" onClick={() => setIsClearDialogOpen(false)} />
        </DialogFooter>
      </Dialog>
    </ThemeProvider>
  );
}

export default App;
