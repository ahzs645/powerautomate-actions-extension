import { IActionModel, ISettingsModel } from "../../models";
import { IAnalysisConfig } from "../../config/AnalysisConfig";
import { SavedFlowAnalysis } from "../FlowAnalyzer";

export interface IStorageService {
    getRecordedActions(): Promise<IActionModel[]>;
    addNewRecordedAction(action: IActionModel): Promise<IActionModel[]>;
    deleteRecordedAction(action: IActionModel): Promise<IActionModel[]>;
    updateRecordedAction(action: IActionModel): Promise<IActionModel[]>;
    clearRecordedActions(): void;
    getMyClipboardActions(): Promise<IActionModel[]>;
    addNewMyClipboardAction(action: IActionModel): Promise<IActionModel[]>;
    setNewMyClipboardActions(actions: IActionModel[]): Promise<IActionModel[]>;
    deleteMyClipboardAction(action: IActionModel): Promise<IActionModel[]>
    updateMyClipboardAction(action: IActionModel): Promise<IActionModel[]>;
    clearMyClipboardActions(): Promise<void>
    getIsRecordingValue(): Promise<boolean>;
    setIsRecordingValue(isRecording: boolean): Promise<boolean>;

    getFavoriteActions(): Promise<IActionModel[]>;
    addFavoriteAction(action: IActionModel): Promise<IActionModel[]>;
    removeFavoriteAction(action: IActionModel): Promise<IActionModel[]>;
    updateFavoriteAction(action: IActionModel): Promise<IActionModel[]>;
    clearFavoriteActions(): Promise<void>;
    setFavoriteActions(actions: IActionModel[]): Promise<IActionModel[]>;
    
    getSettings(): Promise<ISettingsModel>;
    updateSettings(partialSettings: Partial<ISettingsModel>): Promise<ISettingsModel>;
    resetSettings(): Promise<ISettingsModel>;

    // Analysis configuration
    getAnalysisConfig(): Promise<IAnalysisConfig>;
    updateAnalysisConfig(config: Partial<IAnalysisConfig>): Promise<IAnalysisConfig>;
    resetAnalysisConfig(): Promise<IAnalysisConfig>;

    // Saved flow analysis
    getSavedFlowAnalysis(): Promise<SavedFlowAnalysis | null>;
    saveFlowAnalysis(analysis: SavedFlowAnalysis): Promise<void>;
    clearSavedFlowAnalysis(): Promise<void>;
}