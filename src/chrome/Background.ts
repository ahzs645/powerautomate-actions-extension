import { ActionsService, BackgroundService, ExtensionCommunicationService, StorageService } from "../services";
import { FlowEditorActions } from "../services/interfaces/IFlowEditorActions";
import jwtDecode from "jwt-decode";

const storageService = new StorageService();
const actionsService = new ActionsService();
const communicationService = new ExtensionCommunicationService();

const backgroundService = new BackgroundService(storageService, communicationService, actionsService);

// Flow Editor State
interface FlowEditorState {
    token?: string;
    apiUrl?: string;
    tokenExpires?: Date;
    lastMatchedRequest?: { envId: string; flowId: string } | null;
    initiatorTabId?: number;
    flowEditorTabId?: number;
}

// Per-tab state: keyed by initiator (Power Automate) tab ID
const tabStates = new Map<number, FlowEditorState>();
// Reverse lookup: flow editor tab ID → initiator tab ID
const editorToInitiator = new Map<number, number>();

function getOrCreateTabState(tabId: number): FlowEditorState {
    if (!tabStates.has(tabId)) {
        tabStates.set(tabId, {});
    }
    return tabStates.get(tabId)!;
}

function getStateForEditorTab(editorTabId: number): FlowEditorState | undefined {
    const initiatorId = editorToInitiator.get(editorTabId);
    if (initiatorId !== undefined) {
        return tabStates.get(initiatorId);
    }
    return undefined;
}

const DEBUG = true;

function debugLog(...args: any[]) {
    if (DEBUG) {
        console.log('[PA-Toolkit Background]', ...args);
    }
}

function debugError(...args: any[]) {
    if (DEBUG) {
        console.error('[PA-Toolkit Background Error]', ...args);
    }
}

// Token management functions
function isTokenExpired(state: FlowEditorState): boolean {
    if (!state.tokenExpires) return true;
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    return new Date().getTime() > (state.tokenExpires.getTime() - bufferTime);
}

function showNotification(message: string) {
    chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'logo48.png',
        title: 'Power Automate Toolkit',
        message: message
    });
}

function sendTokenChanged(state: FlowEditorState) {
    if (!state.token || !state.apiUrl) {
        debugError('Cannot send token - missing token or apiUrl');
        return;
    }

    if (isTokenExpired(state)) {
        debugError('Token expired, not sending');
        showNotification('Authentication token expired. Please refresh the Power Automate page.');
        return;
    }

    debugLog('Sending token changed message');
    sendMessageToFlowEditorTab(state, {
        type: "token-changed",
        token: state.token,
        apiUrl: state.apiUrl,
    });
}

function refreshInitiator(state: FlowEditorState) {
    if (state.initiatorTabId) {
        debugLog('Refreshing initiator tab:', state.initiatorTabId);
        chrome.tabs.reload(state.initiatorTabId, {}, () => {
            if (chrome.runtime.lastError) {
                debugError('Failed to refresh tab:', chrome.runtime.lastError);
            } else {
                debugLog('Tab refreshed successfully');
            }
        });
    } else {
        debugLog('No initiator tab to refresh');
    }
}

function sendMessageToFlowEditorTab(state: FlowEditorState, action: FlowEditorActions) {
    if (state.flowEditorTabId) {
        debugLog('Sending message to flow editor tab:', action.type, 'tab:', state.flowEditorTabId);
        chrome.tabs.sendMessage(state.flowEditorTabId, action, (response) => {
            if (chrome.runtime.lastError) {
                debugError('Failed to send message to flow editor tab:', chrome.runtime.lastError);
            } else {
                debugLog('Message sent successfully');
            }
        });
    } else {
        debugLog('No flow editor tab to send message to');
    }
}

// URL pattern matching for flow data extraction
function extractFlowDataFromTabUrl(url?: string): { envId: string; flowId: string } | null {
    if (!url) {
        return null;
    }

    debugLog('Extracting flow data from tab URL:', url);

    const envPatterns = [
        /\/environments\/([a-zA-Z0-9\-]*)\//i,
        /environment\/([a-zA-Z0-9\-]*)\//i,
        /\/environment=([a-zA-Z0-9\-]*)/i,
        /envid=([a-zA-Z0-9\-]*)/i,
        /[?&]environmentId=([a-zA-Z0-9\-]*)/i,
        /[?&]env=([a-zA-Z0-9\-]*)/i,
        /environments%2F([a-zA-Z0-9\-]*)/i,
    ];

    let envResult: RegExpExecArray | null = null;

    for (const pattern of envPatterns) {
        envResult = pattern.exec(url);
        if (envResult) {
            debugLog('Environment ID found:', envResult[1]);
            break;
        }
    }

    if (!envResult) {
        debugLog('No environment ID found in URL');
        return null;
    }

    const flowPatterns = [
        /flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /flows\/shared\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /flows\/([0-9a-f]{8}%2D[0-9a-f]{4}%2D[0-9a-f]{4}%2D[0-9a-f]{4}%2D[0-9a-f]{12})/i,
        /flow\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /flowid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /[?&]flowId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /[?&]id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /#.*flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    ];

    let flowResult: RegExpExecArray | null = null;

    for (const pattern of flowPatterns) {
        flowResult = pattern.exec(url);
        if (flowResult) {
            flowResult[1] = decodeURIComponent(flowResult[1]);
            debugLog('Flow ID found:', flowResult[1]);
            break;
        }
    }

    if (!flowResult) {
        debugLog('No flow ID found in URL');
        return null;
    }

    return {
        envId: envResult[1],
        flowId: flowResult[1],
    };
}

function extractFlowDataFromApiUrl(url: string): { envId: string; flowId: string } | null {
    const patterns = [
        /\/providers\/Microsoft\.ProcessSimple\/environments\/(.*)\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        /\/environments\/(.*)\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    ];

    for (const pattern of patterns) {
        const result = pattern.exec(url);
        if (result) {
            return {
                envId: result[1],
                flowId: result[2],
            };
        }
    }

    return null;
}

// Listen for Flow API requests to capture token
function listenFlowApiRequests(details: chrome.webRequest.WebRequestHeadersDetails) {
    // Skip requests from any known flow editor tab
    if (editorToInitiator.has(details.tabId)) {
        return;
    }

    debugLog('Intercepted API request from tab:', details.tabId, details.url);

    const state = getOrCreateTabState(details.tabId);

    const flowData = extractFlowDataFromApiUrl(details.url);
    if (flowData) {
        state.lastMatchedRequest = flowData;
        state.initiatorTabId = details.tabId;
    }

    const authHeader = details.requestHeaders?.find(
        (x) => x.name.toLowerCase() === "authorization"
    );

    const token = authHeader?.value;

    if (!token) {
        debugLog('No authorization token found in request');
        return;
    }

    if (state.token !== token) {
        debugLog('New token detected for tab:', details.tabId);
        state.token = token;

        try {
            const decodedToken = jwtDecode(token) as any;
            state.tokenExpires = new Date(decodedToken.exp * 1000);
            debugLog('Token expires at:', state.tokenExpires);

            const url = new URL(details.url);
            state.apiUrl = `${url.protocol}//${url.hostname}/`;
            debugLog('API URL set to:', state.apiUrl);

            // Only push token to the editor if one is open for this tab
            if (state.flowEditorTabId) {
                sendTokenChanged(state);
            }
        } catch (error) {
            debugError('Failed to decode token:', error);
            return;
        }
    }
}

// Handle Flow Editor messages
function handleFlowEditorMessage(
    action: FlowEditorActions,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
): boolean {
    debugLog('Received flow editor message:', action.type);

    const editorTabId = sender.tab?.id;
    if (editorTabId === undefined) {
        sendResponse();
        return true;
    }

    const state = getStateForEditorTab(editorTabId);
    if (!state) {
        debugError('No state found for editor tab:', editorTabId);
        sendResponse();
        return true;
    }

    switch (action.type) {
        case 'app-loaded':
            debugLog('Flow editor app loaded, sending token');
            sendResponse();
            sendTokenChanged(state);
            return true;
        case 'refresh':
            debugLog('Refresh requested');
            sendResponse();
            refreshInitiator(state);
            return true;
    }

    sendResponse();
    return true;
}

// Open Flow Editor
function openFlowEditor(tab: chrome.tabs.Tab) {
    if (!tab.id) {
        debugError('No tab ID available');
        return { success: false, error: 'No tab ID' };
    }

    const state = getOrCreateTabState(tab.id);

    debugLog('Opening flow editor for tab:', tab.id, {
        hasLastMatchedRequest: !!state.lastMatchedRequest,
        hasToken: !!state.token,
        tokenExpired: isTokenExpired(state),
        currentTabUrl: tab.url
    });

    // Try to extract flow data from current tab URL if not available
    if (!state.lastMatchedRequest && tab.url) {
        debugLog('No matched request found, trying to extract from current tab URL');
        state.lastMatchedRequest = extractFlowDataFromTabUrl(tab.url);
        if (state.lastMatchedRequest) {
            state.initiatorTabId = tab.id;
            debugLog('Flow data extracted from current tab:', state.lastMatchedRequest);
        }
    }

    if (!state.lastMatchedRequest) {
        debugError('No flow data found. Make sure you are on a Power Automate flow page.');
        showNotification('Please navigate to a Power Automate flow page first.');
        return { success: false, error: 'No flow data found' };
    }

    if (!state.token) {
        debugError('No authentication token found');
        showNotification('No authentication detected. Please refresh the Power Automate page and try again.');
        return { success: false, error: 'No authentication token' };
    }

    if (isTokenExpired(state)) {
        debugError('Token expired, requesting refresh');
        showNotification('Token expired. Please refresh the Power Automate page and try again.');
        return { success: false, error: 'Token expired' };
    }

    const appUrl = `${chrome.runtime.getURL("flow-editor.html")}?envId=${
        state.lastMatchedRequest.envId
    }&flowId=${state.lastMatchedRequest.flowId}`;

    debugLog('Creating flow editor tab with URL:', appUrl);

    chrome.tabs.create({ url: appUrl }, (appTab) => {
        if (chrome.runtime.lastError) {
            debugError('Failed to create flow editor tab:', chrome.runtime.lastError);
            showNotification('Failed to open flow editor. Please try again.');
            return;
        }
        state.flowEditorTabId = appTab.id;
        editorToInitiator.set(appTab.id!, tab.id!);
        debugLog('Flow editor tab created with ID:', appTab.id, 'for initiator tab:', tab.id);
    });

    return { success: true };
}

// Check if current page is a flow page
async function checkFlowPage(): Promise<{ isFlowPage: boolean; envId?: string; flowId?: string }> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (!activeTab?.id) {
                resolve({ isFlowPage: false });
                return;
            }

            // Check if we already have state for this tab
            const existingState = tabStates.get(activeTab.id);
            if (existingState?.lastMatchedRequest) {
                resolve({
                    isFlowPage: true,
                    envId: existingState.lastMatchedRequest.envId,
                    flowId: existingState.lastMatchedRequest.flowId,
                });
                return;
            }

            // Try to extract from current tab URL
            if (activeTab.url) {
                const flowData = extractFlowDataFromTabUrl(activeTab.url);
                if (flowData) {
                    const state = getOrCreateTabState(activeTab.id);
                    state.lastMatchedRequest = flowData;
                    state.initiatorTabId = activeTab.id;
                    resolve({
                        isFlowPage: true,
                        envId: flowData.envId,
                        flowId: flowData.flowId,
                    });
                    return;
                }
            }

            resolve({ isFlowPage: false });
        });
    });
}

// Main initialization
const main = async () => {
    // Existing recording functionality
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Handle flow editor messages
        if (message.type === 'app-loaded' || message.type === 'refresh' || message.type === 'open-flow-editor' || message.type === 'check-flow-page') {
            if (message.type === 'open-flow-editor') {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        const result = openFlowEditor(tabs[0]);
                        sendResponse(result);
                    }
                });
                return true; // Keep channel open for async response
            }
            if (message.type === 'check-flow-page') {
                checkFlowPage().then(result => sendResponse(result));
                return true; // Keep channel open for async response
            }
            return handleFlowEditorMessage(message, sender, sendResponse);
        }

        // Handle existing messages through BackgroundService
        backgroundService.handleBackgroundAction(message, sender, sendResponse);
        return true;
    });

    // Record actions (existing functionality)
    backgroundService.recordActions();

    // Listen for Flow API requests for token extraction
    chrome.webRequest.onBeforeSendHeaders.addListener(
        listenFlowApiRequests,
        {
            urls: [
                "https://*.api.flow.microsoft.com/*",
                "https://*.api.powerautomate.com/*",
                "https://*.api.powerapps.com/*",
                "https://unitedstates.api.powerapps.com/*",
                "https://europe.api.powerapps.com/*",
                "https://asia.api.powerapps.com/*",
                "https://australia.api.powerapps.com/*",
                "https://india.api.powerapps.com/*",
                "https://japan.api.powerapps.com/*",
                "https://canada.api.powerapps.com/*",
                "https://southamerica.api.powerapps.com/*",
                "https://unitedkingdom.api.powerapps.com/*",
                "https://france.api.powerapps.com/*",
                "https://germany.api.powerapps.com/*",
                "https://switzerland.api.powerapps.com/*",
                "https://usgov.api.powerapps.us/*",
                "https://usgovhigh.api.powerapps.us/*",
                "https://dod.api.powerapps.us/*"
            ],
        },
        ["requestHeaders"]
    );

    // Track when tabs are closed
    chrome.tabs.onRemoved.addListener((tabId) => {
        // If a flow editor tab was closed, clean up the reverse lookup and state reference
        const initiatorId = editorToInitiator.get(tabId);
        if (initiatorId !== undefined) {
            debugLog('Flow editor tab closed:', tabId, 'for initiator:', initiatorId);
            editorToInitiator.delete(tabId);
            const state = tabStates.get(initiatorId);
            if (state) {
                delete state.flowEditorTabId;
            }
            return;
        }

        // If an initiator (Power Automate) tab was closed, clean up its state entirely
        const state = tabStates.get(tabId);
        if (state) {
            debugLog('Initiator tab closed:', tabId);
            if (state.flowEditorTabId) {
                editorToInitiator.delete(state.flowEditorTabId);
            }
            tabStates.delete(tabId);
        }
    });

    debugLog('Power Automate Toolkit background service initialized');
}

main();
