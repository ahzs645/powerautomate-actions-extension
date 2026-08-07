import { ICommunicationChromeMessage } from "../../models";

export interface IBackgroundService {
    handleBackgroundAction(message: ICommunicationChromeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): void;
    recordActions(): void;
    getTabUrl(tabId: number): Promise<string>;
    isRecordingPage(tabId: number): Promise<boolean>;
}