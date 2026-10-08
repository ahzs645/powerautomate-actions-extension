import { ActionType, AppElement, ICommunicationChromeMessage } from "../models";
import { IBackgroundService, IStorageService, IExtensionCommunicationService, IActionService } from "./interfaces";

export class BackgroundService implements IBackgroundService {
    private actionsWithBody: chrome.webRequest.WebRequestBodyDetails[] = [];
    private previousUrlByTab = new Map<number, string>();
    private isRecordingPageByTab = new Map<number, boolean>();

    constructor(private storageService: IStorageService, private communicationService: IExtensionCommunicationService, private actionsService: IActionService) {
    }

    public handleBackgroundAction = (message: ICommunicationChromeMessage, sender: chrome.runtime.MessageSender | null, sendResponse: (response?: any) => void) => {
        if (!this.isCorrectReceiver(message)) { console.log('Incorrect Background Action'); }
        switch (message.actionType) {
            case ActionType.StartRecording:
                this.storageService.setIsRecordingValue(true);
                sendResponse(true);
                break;
            case ActionType.StopRecording:
                this.storageService.setIsRecordingValue(false);
                sendResponse(false);
                break;
            case ActionType.DeleteAction:
                this.storageService.deleteRecordedAction(message.message);
                break;
            case ActionType.UpdateAction:
                this.storageService.updateRecordedAction(message.message).then((updatedActions) => {
                    sendResponse(updatedActions);
                });
                return true;
            case ActionType.DeleteMyClipboardAction:
                this.storageService.deleteMyClipboardAction(message.message);
                break;
            case ActionType.UpdateMyClipboardAction:
                this.storageService.updateMyClipboardAction(message.message).then((updatedActions) => {
                    sendResponse(updatedActions);
                });
                return true;
            default:
                console.log('Incorrect Action Type')
        }
    }

    private handleRequest = async (req: chrome.webRequest.WebRequestHeadersDetails) => {
        try {
            const isRecording = await this.storageService.getIsRecordingValue();
            if (isRecording) {
                // Requests without an associated tab (tabId -1) can never be a recording page
                if (req.tabId < 0) { return; }
                const isRecordingPage = await this.checkIfPageIsRecordingPage(req.tabId);
                if (!isRecordingPage) { return; }

                const foundAction = this.actionsWithBody.find((action) => action.requestId === req.requestId);
                const newAction = this.actionsService.getCorrectAction(req, foundAction);
                if (!newAction) { return; }

                this.storageService.addNewRecordedAction(newAction);
                const actions = await this.storageService.getRecordedActions();
                this.communicationService.sendRequest(
                    { actionType: ActionType.ActionUpdated, message: actions },
                    AppElement.Background,
                    AppElement.ReactApp);

            }
        } catch (e) {
            console.log(e);
        }
    }

    public recordActions = () => {
        chrome.webRequest.onBeforeRequest.addListener((req) => {
            if (this.actionsWithBody.length >= 10) {
                this.actionsWithBody.shift();
            }

            this.actionsWithBody.push(req);
        }, {
            urls: ["<all_urls>"],
            types: ["xmlhttprequest"]
        },
            ["requestBody"]);

        chrome.webRequest.onBeforeSendHeaders.addListener((req) => {
            this.handleRequest(req);
        }, {
            urls: ["<all_urls>"],
            types: ["xmlhttprequest"]
        }, [
            'requestHeaders',
        ]);
    }

    private isCorrectReceiver = (message: ICommunicationChromeMessage) => {
        return message.to === AppElement.Background;
    }

    public getTabUrl(tabId: number): Promise<string> {
        return new Promise((resolve) => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    resolve('');
                    return;
                }
                resolve(tab.url ? tab.url : '');
            });
        });
    }

    public isRecordingPage(tabId: number): Promise<boolean> {
        return new Promise((resolve) => {
            // Ask the content script in the request's own tab — not the active
            // tab, which may be a different page entirely.
            chrome.tabs.sendMessage(tabId, {
                actionType: ActionType.CheckRecordingPage,
                message: "Check Recording Page",
                from: AppElement.Background,
                to: AppElement.Content,
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                resolve(!!response);
            });
        });
    }

    private checkUrlChange = async (tabId: number) => {
        const url = await this.getTabUrl(tabId);
        const hasChanged = this.previousUrlByTab.get(tabId) !== url;
        this.previousUrlByTab.set(tabId, url);
        return hasChanged;
    }

    private checkIfPageIsRecordingPage = async (tabId: number) => {
        const urlHasChanged = await this.checkUrlChange(tabId);
        if (urlHasChanged || !this.isRecordingPageByTab.has(tabId)) {
            this.isRecordingPageByTab.set(tabId, await this.isRecordingPage(tabId));
        }

        return this.isRecordingPageByTab.get(tabId)!;
    }
}