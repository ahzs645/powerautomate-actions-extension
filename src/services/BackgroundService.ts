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
            case ActionType.DeleteMyClipboardAction:
                this.storageService.deleteMyClipboardAction(message.message);
                break;
            default:
                console.log('Incorrect Action Type')
        }
    }

    private handleRequest = async (req: chrome.webRequest.WebRequestHeadersDetails) => {
        try {
            const isRecording = await this.storageService.getIsRecordingValue();
            if (isRecording && this.platformEnabled) {
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

    /**
     * Only SharePoint REST (`_api`, `_vti_bin`) and Microsoft Graph requests can
     * become recorded actions (see ActionsService.getCorrectAction), so the
     * listeners never need to see any other host.
     */
    public static readonly RECORDING_URL_PATTERNS = [
        "https://*.sharepoint.com/*",
        "https://*.sharepoint.us/*",
        "https://*.sharepoint-mil.us/*",
        "https://graph.microsoft.com/*",
    ];
    /** Mirrors StorageService.IS_RECORDING_KEY. */
    public static readonly RECORDING_FLAG_KEY = "isRecordingActions";

    private recordingListenersAttached = false;
    private isRecordingFlag = false;
    private platformEnabled = true;

    private onBeforeRequestListener = (req: chrome.webRequest.WebRequestBodyDetails) => {
        if (this.actionsWithBody.length >= 10) {
            this.actionsWithBody.shift();
        }
        this.actionsWithBody.push(req);
        return undefined;
    }

    private onBeforeSendHeadersListener = (req: chrome.webRequest.WebRequestHeadersDetails) => {
        this.handleRequest(req);
        return undefined;
    }

    private attachRecordingListeners() {
        if (this.recordingListenersAttached || typeof chrome === 'undefined' || !chrome.webRequest) { return; }
        const filter: chrome.webRequest.RequestFilter = {
            urls: BackgroundService.RECORDING_URL_PATTERNS,
            types: ["xmlhttprequest"]
        };
        chrome.webRequest.onBeforeRequest.addListener(this.onBeforeRequestListener, filter, ["requestBody"]);
        chrome.webRequest.onBeforeSendHeaders.addListener(this.onBeforeSendHeadersListener, filter, ['requestHeaders']);
        this.recordingListenersAttached = true;
    }

    private detachRecordingListeners() {
        if (!this.recordingListenersAttached || typeof chrome === 'undefined' || !chrome.webRequest) { return; }
        chrome.webRequest.onBeforeRequest.removeListener(this.onBeforeRequestListener);
        chrome.webRequest.onBeforeSendHeaders.removeListener(this.onBeforeSendHeadersListener);
        this.recordingListenersAttached = false;
        // Drop buffered request bodies as soon as recording stops.
        this.actionsWithBody = [];
    }

    private syncRecordingListeners() {
        if (this.isRecordingFlag && this.platformEnabled) {
            this.attachRecordingListeners();
        } else {
            this.detachRecordingListeners();
        }
    }

    public isRecordingListenerAttached(): boolean {
        return this.recordingListenersAttached;
    }

    /** Master switch (appSettings.extensionEnabled): no recording while disabled. */
    public setPlatformEnabled = (enabled: boolean) => {
        this.platformEnabled = enabled;
        this.syncRecordingListeners();
    }

    /**
     * Observe XHRs only while recording is on. The listeners are attached
     * synchronously first so an event that woke the service worker is not lost
     * (MV3 only delivers it to listeners registered in the first turn); they
     * are removed as soon as storage says recording is off, so request bodies
     * are not buffered (and the worker is not woken) while idle.
     */
    public recordActions = () => {
        this.isRecordingFlag = true;
        this.syncRecordingListeners();

        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes[BackgroundService.RECORDING_FLAG_KEY]) { return; }
                this.isRecordingFlag = !!changes[BackgroundService.RECORDING_FLAG_KEY].newValue;
                this.syncRecordingListeners();
            });
        }

        Promise.resolve(this.storageService.getIsRecordingValue())
            .then((isRecording) => {
                this.isRecordingFlag = !!isRecording;
                this.syncRecordingListeners();
            })
            .catch(() => {
                this.isRecordingFlag = false;
                this.syncRecordingListeners();
            });
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