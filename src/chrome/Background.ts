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

const flowEditorState: FlowEditorState = {};

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
function isTokenExpired(): boolean {
    if (!flowEditorState.tokenExpires) return true;
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    return new Date().getTime() > (flowEditorState.tokenExpires.getTime() - bufferTime);
}

function showNotification(message: string) {
    chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'logo48.png',
        title: 'Power Automate Toolkit',
        message: message
    });
}

function sendTokenChanged() {
    if (!flowEditorState.token || !flowEditorState.apiUrl) {
        debugError('Cannot send token - missing token or apiUrl');
        return;
    }

    if (isTokenExpired()) {
        debugError('Token expired, not sending');
        showNotification('Authentication token expired. Please refresh the Power Automate page.');
        return;
    }

    debugLog('Sending token changed message');
    sendMessageToFlowEditorTab({
        type: "token-changed",
        token: flowEditorState.token,
        apiUrl: flowEditorState.apiUrl,
    });
}

function refreshInitiator() {
    if (flowEditorState.initiatorTabId) {
        debugLog('Refreshing initiator tab:', flowEditorState.initiatorTabId);
        chrome.tabs.reload(flowEditorState.initiatorTabId, {}, () => {
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

function sendMessageToFlowEditorTab(action: FlowEditorActions) {
    if (flowEditorState.flowEditorTabId) {
        debugLog('Sending message to flow editor tab:', action.type);
        chrome.tabs.sendMessage(flowEditorState.flowEditorTabId, action, (response) => {
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
    if (flowEditorState.flowEditorTabId === details.tabId) {
        return;
    }

    debugLog('Intercepted API request:', details.url);

    const flowData = extractFlowDataFromApiUrl(details.url);
    if (flowData) {
        flowEditorState.lastMatchedRequest = flowData;
    }

    const authHeader = details.requestHeaders?.find(
        (x) => x.name.toLowerCase() === "authorization"
    );

    const token = authHeader?.value;

    if (!token) {
        debugLog('No authorization token found in request');
        return;
    }

    if (flowEditorState.token !== token) {
        debugLog('New token detected, updating state');
        flowEditorState.token = token;

        try {
            const decodedToken = jwtDecode(token) as any;
            flowEditorState.tokenExpires = new Date(decodedToken.exp * 1000);
            debugLog('Token expires at:', flowEditorState.tokenExpires);

            const url = new URL(details.url);
            flowEditorState.apiUrl = `${url.protocol}//${url.hostname}/`;
            debugLog('API URL set to:', flowEditorState.apiUrl);

            sendTokenChanged();
        } catch (error) {
            debugError('Failed to decode token:', error);
            return;
        }
    }

    if (flowEditorState.lastMatchedRequest) {
        debugLog('Flow data extracted:', flowEditorState.lastMatchedRequest);
        flowEditorState.initiatorTabId = details.tabId;
    }
}

// Handle Flow Editor messages
function handleFlowEditorMessage(
    action: FlowEditorActions,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
): boolean {
    debugLog('Received flow editor message:', action.type);

    if (sender.tab?.id === flowEditorState.flowEditorTabId) {
        switch (action.type) {
            case 'app-loaded':
                debugLog('Flow editor app loaded, sending token');
                sendResponse();
                sendTokenChanged();
                return true;
            case 'refresh':
                debugLog('Refresh requested');
                sendResponse();
                refreshInitiator();
                return true;
        }
    }

    sendResponse();
    return true;
}

// Open Flow Editor
function openFlowEditor(tab: chrome.tabs.Tab) {
    debugLog('Opening flow editor, current state:', {
        hasLastMatchedRequest: !!flowEditorState.lastMatchedRequest,
        hasToken: !!flowEditorState.token,
        tokenExpired: isTokenExpired(),
        currentTabUrl: tab.url
    });

    // Try to extract flow data from current tab URL if not available
    if (!flowEditorState.lastMatchedRequest && tab.url) {
        debugLog('No matched request found, trying to extract from current tab URL');
        flowEditorState.lastMatchedRequest = extractFlowDataFromTabUrl(tab.url);
        if (flowEditorState.lastMatchedRequest) {
            flowEditorState.initiatorTabId = tab.id;
            debugLog('Flow data extracted from current tab:', flowEditorState.lastMatchedRequest);
        }
    }

    if (!flowEditorState.lastMatchedRequest) {
        debugError('No flow data found. Make sure you are on a Power Automate flow page.');
        showNotification('Please navigate to a Power Automate flow page first.');
        return { success: false, error: 'No flow data found' };
    }

    if (!flowEditorState.token) {
        debugError('No authentication token found');
        showNotification('No authentication detected. Please refresh the Power Automate page and try again.');
        return { success: false, error: 'No authentication token' };
    }

    if (isTokenExpired()) {
        debugError('Token expired, requesting refresh');
        showNotification('Token expired. Please refresh the Power Automate page and try again.');
        return { success: false, error: 'Token expired' };
    }

    const appUrl = `${chrome.runtime.getURL("flow-editor.html")}?envId=${
        flowEditorState.lastMatchedRequest.envId
    }&flowId=${flowEditorState.lastMatchedRequest.flowId}`;

    debugLog('Creating flow editor tab with URL:', appUrl);

    chrome.tabs.create({ url: appUrl }, (appTab) => {
        if (chrome.runtime.lastError) {
            debugError('Failed to create flow editor tab:', chrome.runtime.lastError);
            showNotification('Failed to open flow editor. Please try again.');
            return;
        }
        flowEditorState.flowEditorTabId = appTab.id;
        debugLog('Flow editor tab created with ID:', appTab.id);
    });

    return { success: true };
}

// Check if current page is a flow page
async function checkFlowPage(): Promise<{ isFlowPage: boolean; envId?: string; flowId?: string }> {
    // First check if we already have matched request data
    if (flowEditorState.lastMatchedRequest) {
        return {
            isFlowPage: true,
            envId: flowEditorState.lastMatchedRequest.envId,
            flowId: flowEditorState.lastMatchedRequest.flowId,
        };
    }

    // Try to extract from current tab URL
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url) {
                const flowData = extractFlowDataFromTabUrl(tabs[0].url);
                if (flowData) {
                    flowEditorState.lastMatchedRequest = flowData;
                    flowEditorState.initiatorTabId = tabs[0].id;
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

    // Track when flow editor tab is closed
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (flowEditorState.flowEditorTabId === tabId) {
            debugLog('Flow editor tab closed:', tabId);
            delete flowEditorState.flowEditorTabId;
        }
    });

    debugLog('Power Automate Toolkit background service initialized');
}

main();
