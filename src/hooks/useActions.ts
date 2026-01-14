// useActions - Custom hook for action management
// Extracted from App.tsx

import { useState, useCallback } from 'react';
import { ActionType, IDataChromeMessage, AppElement, Mode } from '../models';
import { IActionModel } from '../models/IActionModel';
import { StorageService } from '../services/StorageService';
import { ExtensionCommunicationService, PredefinedActionsService } from '../services';

export interface UseActionsResult {
  // State
  actions: IActionModel[];
  myClipboardActions: IActionModel[];
  favoriteActions: IActionModel[];
  predefinedActions: IActionModel[];
  predefinedActionsLoading: boolean;

  // Setters (for external updates)
  setActions: React.Dispatch<React.SetStateAction<IActionModel[]>>;
  setMyClipboardActions: React.Dispatch<React.SetStateAction<IActionModel[]>>;
  setFavoriteActions: React.Dispatch<React.SetStateAction<IActionModel[]>>;
  setPredefinedActions: React.Dispatch<React.SetStateAction<IActionModel[]>>;

  // Actions
  loadActions: () => Promise<void>;
  loadPredefinedActions: (url: string) => Promise<void>;
  refreshPredefinedActions: (url: string) => Promise<void>;
  clearActionList: (mode: Mode) => void;
  copySelectedActions: (mode: Mode) => void;
  deleteRecordedAction: (action: IActionModel) => void;
  deleteMyClipboardAction: (action: IActionModel) => void;
  deleteFavoriteAction: (action: IActionModel) => void;
  toggleFavorite: (action: IActionModel, isFavorite: boolean) => void;
  selectAction: (action: IActionModel, mode: Mode, selected: boolean) => void;
  selectAllActions: (mode: Mode, selected: boolean) => void;
  copyAllActionsFromPage: () => void;
  getClipboardActions: () => void;
  insertToClipboardV3: () => void;

  // Helpers
  getActionsForMode: (mode: Mode) => IActionModel[];
  getSelectedActions: (mode: Mode) => IActionModel[];
}

export function useActions(
  storageService: StorageService,
  communicationService: ExtensionCommunicationService,
  predefinedActionsService: PredefinedActionsService,
  onNotification?: (message: string, isSuccess: boolean) => void
): UseActionsResult {
  const [actions, setActions] = useState<IActionModel[]>([]);
  const [myClipboardActions, setMyClipboardActions] = useState<IActionModel[]>([]);
  const [favoriteActions, setFavoriteActions] = useState<IActionModel[]>([]);
  const [predefinedActions, setPredefinedActions] = useState<IActionModel[]>([]);
  const [predefinedActionsLoading, setPredefinedActionsLoading] = useState<boolean>(false);

  // Load all actions from storage
  const loadActions = useCallback(async () => {
    const [recorded, clipboard, favorites] = await Promise.all([
      storageService.getRecordedActions(),
      storageService.getMyClipboardActions(),
      storageService.getFavoriteActions(),
    ]);

    setActions(recorded);
    setMyClipboardActions(clipboard);
    setFavoriteActions(favorites);
  }, [storageService]);

  // Load predefined actions from URL
  const loadPredefinedActions = useCallback(async (url: string) => {
    if (!url || url.trim() === '') {
      setPredefinedActions([]);
      return;
    }

    setPredefinedActionsLoading(true);
    try {
      const actions = await predefinedActionsService.fetchPredefinedActions(url);
      setPredefinedActions(actions);
    } catch (error) {
      console.error('Failed to load predefined actions:', error);
      setPredefinedActions([]);
    } finally {
      setPredefinedActionsLoading(false);
    }
  }, [predefinedActionsService]);

  // Refresh predefined actions
  const refreshPredefinedActions = useCallback(async (url: string) => {
    if (!url) return;

    setPredefinedActionsLoading(true);
    try {
      const actions = await predefinedActionsService.refreshPredefinedActions(url);
      setPredefinedActions(actions);
      onNotification?.('Predefined actions refreshed successfully', true);
    } catch (error) {
      console.error('Failed to refresh predefined actions:', error);
      onNotification?.('Failed to refresh predefined actions', false);
    } finally {
      setPredefinedActionsLoading(false);
    }
  }, [predefinedActionsService, onNotification]);

  // Clear action list for a mode
  const clearActionList = useCallback((mode: Mode) => {
    switch (mode) {
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
  }, [storageService]);

  // Get actions for a specific mode
  const getActionsForMode = useCallback((mode: Mode): IActionModel[] => {
    switch (mode) {
      case Mode.Requests:
        return actions;
      case Mode.CopiedActions:
        return myClipboardActions;
      case Mode.Favorites:
        return favoriteActions;
      case Mode.PredefinedActions:
        return predefinedActions;
      default:
        return [];
    }
  }, [actions, myClipboardActions, favoriteActions, predefinedActions]);

  // Get selected actions for a mode
  const getSelectedActions = useCallback((mode: Mode): IActionModel[] => {
    return getActionsForMode(mode).filter((a) => a.isSelected);
  }, [getActionsForMode]);

  // Copy selected actions to clipboard
  const copySelectedActions = useCallback((mode: Mode) => {
    const selectedActions = getSelectedActions(mode);

    if (!selectedActions || selectedActions.length === 0) {
      onNotification?.('No actions selected', false);
      return;
    }

    const message: IDataChromeMessage = {
      actionType: ActionType.CopyAction,
      message: selectedActions,
    };
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content);
  }, [getSelectedActions, communicationService, onNotification]);

  // Delete action helper
  const deleteAction = useCallback((
    action: IActionModel,
    oldActions: IActionModel[],
    setActionsFunc: React.Dispatch<React.SetStateAction<IActionModel[]>>,
    actionType: ActionType
  ) => {
    const message: IDataChromeMessage = {
      actionType: actionType,
      message: action,
    };
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Background, () => {
      const myArray = [...(oldActions || [])];
      const index = myArray.findIndex((a) => a.id === action.id);
      if (index > -1) {
        myArray.splice(index, 1);
        setActionsFunc(myArray);
      }
    });
  }, [communicationService]);

  // Delete recorded action
  const deleteRecordedAction = useCallback((action: IActionModel) => {
    deleteAction(action, actions, setActions, ActionType.DeleteAction);
  }, [actions, deleteAction]);

  // Delete clipboard action
  const deleteMyClipboardAction = useCallback((action: IActionModel) => {
    deleteAction(action, myClipboardActions, setMyClipboardActions, ActionType.DeleteMyClipboardAction);
  }, [myClipboardActions, deleteAction]);

  // Update favorite status across all lists
  const updateFavoriteStatusInLists = useCallback((actionId: string, isFavorite: boolean) => {
    setActions((prevActions) =>
      (prevActions ?? []).map((action) =>
        action.id === actionId ? { ...action, isFavorite } : action
      )
    );

    setMyClipboardActions((prevActions) =>
      (prevActions ?? []).map((action) =>
        action.id === actionId ? { ...action, isFavorite } : action
      )
    );

    setPredefinedActions((prevActions) =>
      (prevActions ?? []).map((action) =>
        action.id === actionId ? { ...action, isFavorite } : action
      )
    );
  }, []);

  // Delete favorite action
  const deleteFavoriteAction = useCallback((action: IActionModel) => {
    storageService.removeFavoriteAction(action).then((updatedFavorites) => {
      setFavoriteActions(updatedFavorites);
      updateFavoriteStatusInLists(action.id, false);
    });
  }, [storageService, updateFavoriteStatusInLists]);

  // Toggle favorite status
  const toggleFavorite = useCallback((action: IActionModel, isFavorite: boolean) => {
    if (isFavorite) {
      storageService.addFavoriteAction(action).then((updatedFavorites) => {
        setFavoriteActions(updatedFavorites);
        updateFavoriteStatusInLists(action.id, true);
      });
    } else {
      deleteFavoriteAction(action);
    }
  }, [storageService, updateFavoriteStatusInLists, deleteFavoriteAction]);

  // Select/deselect action
  const selectAction = useCallback((action: IActionModel, mode: Mode, selected: boolean) => {
    const updateActions = (
      setFunc: React.Dispatch<React.SetStateAction<IActionModel[]>>
    ) => {
      setFunc((prevActions) =>
        prevActions.map((a) =>
          a.id === action.id ? { ...a, isSelected: selected } : a
        )
      );
    };

    switch (mode) {
      case Mode.Requests:
        updateActions(setActions);
        break;
      case Mode.CopiedActions:
        updateActions(setMyClipboardActions);
        break;
      case Mode.Favorites:
        updateActions(setFavoriteActions);
        break;
      case Mode.PredefinedActions:
        updateActions(setPredefinedActions);
        break;
    }
  }, []);

  // Select/deselect all actions
  const selectAllActions = useCallback((mode: Mode, selected: boolean) => {
    const updateActions = (
      setFunc: React.Dispatch<React.SetStateAction<IActionModel[]>>
    ) => {
      setFunc((prevActions) =>
        prevActions.map((a) => ({ ...a, isSelected: selected }))
      );
    };

    switch (mode) {
      case Mode.Requests:
        updateActions(setActions);
        break;
      case Mode.CopiedActions:
        updateActions(setMyClipboardActions);
        break;
      case Mode.Favorites:
        updateActions(setFavoriteActions);
        break;
      case Mode.PredefinedActions:
        updateActions(setPredefinedActions);
        break;
    }
  }, []);

  // Copy all actions from page
  const copyAllActionsFromPage = useCallback(() => {
    const message = {
      actionType: ActionType.CopyAllActionsFromPage,
      message: 'Copy All Actions From the Page',
    };
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content);
  }, [communicationService]);

  // Get clipboard actions
  const getClipboardActions = useCallback(() => {
    const message: IDataChromeMessage = {
      actionType: ActionType.GetElementsFromMyClipboard,
      message: 'Get Elements From My Clipboard',
    };
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content);
  }, [communicationService]);

  // Insert to clipboard V3
  const insertToClipboardV3 = useCallback(() => {
    const selectedActions = getSelectedActions(Mode.CopiedActionsV3);
    if (!selectedActions || selectedActions.length === 0) {
      onNotification?.('No actions selected', false);
      return;
    }

    const message: IDataChromeMessage = {
      actionType: ActionType.SetSelectedActionsIntoClipboardV3,
      message: selectedActions,
    };
    communicationService.sendRequest(message, AppElement.ReactApp, AppElement.Content, (response) => {
      if (response) {
        onNotification?.('Actions inserted into clipboard', true);
      }
    });
  }, [getSelectedActions, communicationService, onNotification]);

  return {
    actions,
    myClipboardActions,
    favoriteActions,
    predefinedActions,
    predefinedActionsLoading,
    setActions,
    setMyClipboardActions,
    setFavoriteActions,
    setPredefinedActions,
    loadActions,
    loadPredefinedActions,
    refreshPredefinedActions,
    clearActionList,
    copySelectedActions,
    deleteRecordedAction,
    deleteMyClipboardAction,
    deleteFavoriteAction,
    toggleFavorite,
    selectAction,
    selectAllActions,
    copyAllActionsFromPage,
    getClipboardActions,
    insertToClipboardV3,
    getActionsForMode,
    getSelectedActions,
  };
}

export default useActions;
