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
    flowEditorTabIds: Set<number>;
    lastSentToken?: string; // Track what was last sent to editors to avoid noisy broadcasts
}

// Per-tab state: keyed by initiator (Power Automate) tab ID
const tabStates = new Map<number, FlowEditorState>();
// Reverse lookup: flow editor tab ID → initiator tab ID
const editorToInitiator = new Map<number, number>();

// Persist critical state to chrome.storage.session so it survives
// MV3 service worker restarts (worker goes idle after ~30s)
const SESSION_KEY = 'pa_toolkit_tab_states';

interface SerializedState {
    tabStates: Record<string, Omit<FlowEditorState, 'tokenExpires' | 'flowEditorTabIds'> & { tokenExpiresMs?: number; flowEditorTabIds?: number[] }>;
    editorToInitiator: Record<string, number>;
}

async function persistState() {
    const serialized: SerializedState = {
        tabStates: {},
        editorToInitiator: {},
    };
    tabStates.forEach((state, tabId) => {
        const { tokenExpires, flowEditorTabIds, ...rest } = state;
        serialized.tabStates[tabId.toString()] = {
            ...rest,
            tokenExpiresMs: tokenExpires?.getTime(),
            flowEditorTabIds: Array.from(flowEditorTabIds),
        };
    });
    editorToInitiator.forEach((initiatorId, editorId) => {
        serialized.editorToInitiator[editorId.toString()] = initiatorId;
    });
    try {
        await chrome.storage.session.set({ [SESSION_KEY]: serialized });
    } catch {
        // storage.session may not be available in all contexts
    }
}

async function restoreState() {
    try {
        const result = await chrome.storage.session.get(SESSION_KEY);
        const data = result[SESSION_KEY] as SerializedState | undefined;
        if (!data) return;

        Object.entries(data.tabStates).forEach(([tabId, state]) => {
            const { tokenExpiresMs, flowEditorTabIds: editorIds, ...rest } = state;
            tabStates.set(Number(tabId), {
                ...rest,
                tokenExpires: tokenExpiresMs ? new Date(tokenExpiresMs) : undefined,
                flowEditorTabIds: new Set(editorIds || []),
            });
        });
        Object.entries(data.editorToInitiator).forEach(([editorId, initiatorId]) => {
            editorToInitiator.set(Number(editorId), initiatorId);
        });
        debugLog('Restored state from session storage:', tabStates.size, 'tabs');
    } catch {
        // storage.session may not be available
    }
}

function getOrCreateTabState(tabId: number): FlowEditorState {
    if (!tabStates.has(tabId)) {
        tabStates.set(tabId, { flowEditorTabIds: new Set() });
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

function sendTokenChanged(state: FlowEditorState, force?: boolean) {
    if (!state.token || !state.apiUrl) {
        debugError('Cannot send token - missing token or apiUrl');
        return;
    }

    if (isTokenExpired(state)) {
        debugError('Token expired, not sending');
        showNotification('Authentication token expired. Please refresh the Power Automate page.');
        return;
    }

    // Skip if we already sent this exact token (avoids noisy broadcasts
    // when Power Automate cycles between multiple tokens)
    if (!force && state.lastSentToken === state.token) {
        return;
    }

    debugLog('Sending token changed message');
    state.lastSentToken = state.token;
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
    if (state.flowEditorTabIds.size === 0) {
        debugLog('No flow editor tabs to send message to');
        return;
    }

    debugLog('Sending message to', state.flowEditorTabIds.size, 'flow editor tab(s):', action.type);
    Array.from(state.flowEditorTabIds).forEach((tabId) => {
        chrome.tabs.sendMessage(tabId, action, (response) => {
            if (chrome.runtime.lastError) {
                debugError('Failed to send message to flow editor tab:', tabId, chrome.runtime.lastError);
                // Tab may have been closed without triggering onRemoved; clean up
                state.flowEditorTabIds.delete(tabId);
                editorToInitiator.delete(tabId);
            } else {
                debugLog('Message sent to tab:', tabId);
            }
        });
    });
}

// Check if a URL belongs to a Power Automate / Flow API host (not Dynamics CRM)
function isFlowApiHost(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname.includes('api.flow.microsoft.com') ||
               hostname.includes('api.powerautomate.com') ||
               hostname.includes('api.powerapps.com') ||
               hostname.includes('api.powerapps.us') ||
               hostname.includes('api.powerplatform.com');
    } catch {
        return false;
    }
}

// Check if a URL is an environment-scoped Power Platform endpoint
// e.g. https://6e2f407e...f6.environment.api.powerplatform.com/
// These serve flow data at /powerautomate/flows/{flowId}
function isEnvironmentPowerPlatformUrl(url: string): boolean {
    try {
        return new URL(url).hostname.toLowerCase().includes('.environment.api.powerplatform.com');
    } catch {
        return false;
    }
}

// Determine if a new apiUrl should replace the current one.
// Priority: environment-scoped powerplatform > legacy flow APIs > tenant-scoped powerplatform
function shouldUpdateApiUrl(currentApiUrl: string | undefined, newUrl: string): boolean {
    if (!currentApiUrl) return true;

    const currentIsEnvPP = isEnvironmentPowerPlatformUrl(currentApiUrl);
    const newIsEnvPP = isEnvironmentPowerPlatformUrl(newUrl);

    // Don't downgrade from environment-scoped to tenant-scoped
    if (currentIsEnvPP && !newIsEnvPP) return false;

    // Upgrade from anything to environment-scoped
    if (newIsEnvPP) return true;

    // Otherwise allow the update (legacy URL changes)
    return true;
}

// URL pattern matching for flow data extraction
function extractFlowDataFromTabUrl(url?: string): { envId: string; flowId: string } | null {
    if (!url) {
        return null;
    }

    debugLog('Extracting flow data from tab URL:', url);

    const envPatterns = [
        /\/environments\/([a-zA-Z0-9-]*)\//i,
        /environment\/([a-zA-Z0-9-]*)\//i,
        /\/environment=([a-zA-Z0-9-]*)/i,
        /envid=([a-zA-Z0-9-]*)/i,
        /[?&]environmentId=([a-zA-Z0-9-]*)/i,
        /[?&]env=([a-zA-Z0-9-]*)/i,
        /environments%2F([a-zA-Z0-9-]*)/i,
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

    const state = getOrCreateTabState(details.tabId);

    const flowData = extractFlowDataFromApiUrl(details.url);
    if (flowData) {
        state.lastMatchedRequest = flowData;
        state.initiatorTabId = details.tabId;
    }

    // Only process tokens from Flow/PowerApps/PowerPlatform API hosts.
    // Dynamics CRM tokens have different audiences and cause auth failures
    // when used against Flow/PowerPlatform APIs.
    if (!isFlowApiHost(details.url)) {
        return;
    }

    const authHeader = details.requestHeaders?.find(
        (x) => x.name.toLowerCase() === "authorization"
    );

    const token = authHeader?.value;

    if (!token) {
        return;
    }

    const url = new URL(details.url);
    const candidateUrl = `${url.protocol}//${url.hostname}/`;

    // Update apiUrl if this host is preferred (environment-scoped > legacy)
    if (shouldUpdateApiUrl(state.apiUrl, candidateUrl)) {
        const previousApiUrl = state.apiUrl;
        if (previousApiUrl !== candidateUrl) {
            state.apiUrl = candidateUrl;
            debugLog('API URL set to:', state.apiUrl);

            // Clear the stored token so we don't use one with the wrong audience
            if (previousApiUrl) {
                state.token = undefined;
                debugLog('Cleared token after apiUrl change (was for:', previousApiUrl + ')');
            }
        }
    }

    // Only store tokens from the same host as apiUrl to prevent
    // audience mismatches between different API services.
    const isFromApiUrlHost = candidateUrl === state.apiUrl;
    if (!isFromApiUrlHost) {
        debugLog('Skipping token from non-preferred host:', candidateUrl, '(preferred:', state.apiUrl + ')');
        return;
    }

    if (state.token !== token) {
        debugLog('New token from preferred host:', candidateUrl, 'for tab:', details.tabId);
        state.token = token;

        try {
            const decodedToken = jwtDecode(token) as any;
            state.tokenExpires = new Date(decodedToken.exp * 1000);
            debugLog('Token expires at:', state.tokenExpires);

            // Push token to any open editor tabs for this initiator
            if (state.flowEditorTabIds.size > 0) {
                sendTokenChanged(state);
            }

            // Persist state so it survives service worker restarts
            persistState();
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
            sendTokenChanged(state, true); // Force send for newly loaded editor
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

    // Always re-extract flow data from the current tab URL so that
    // navigating to a different flow opens the correct one.
    const currentFlowData = tab.url ? extractFlowDataFromTabUrl(tab.url) : null;
    if (currentFlowData) {
        state.lastMatchedRequest = currentFlowData;
        state.initiatorTabId = tab.id;
    }

    debugLog('Opening flow editor for tab:', tab.id, {
        flowData: state.lastMatchedRequest,
        hasToken: !!state.token,
        tokenExpired: isTokenExpired(state),
        currentTabUrl: tab.url
    });

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
        state.flowEditorTabIds.add(appTab.id!);
        editorToInitiator.set(appTab.id!, tab.id!);
        debugLog('Flow editor tab created with ID:', appTab.id, 'for initiator tab:', tab.id,
            '(total editor tabs:', state.flowEditorTabIds.size + ')');
        persistState();
    });

    return { success: true };
}

// Check if a tab is a flow page. Uses the provided tab if available (from sender.tab),
// otherwise falls back to querying the active tab.
async function checkFlowPage(senderTab?: chrome.tabs.Tab): Promise<{ isFlowPage: boolean; envId?: string; flowId?: string }> {
    const tab = senderTab || await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });

    if (!tab?.id) {
        return { isFlowPage: false };
    }

    // Always extract from the current tab URL to handle SPA navigation
    // (user may have navigated to a different flow without a full page reload)
    if (tab.url) {
        const flowData = extractFlowDataFromTabUrl(tab.url);
        if (flowData) {
            const state = getOrCreateTabState(tab.id);
            state.lastMatchedRequest = flowData;
            state.initiatorTabId = tab.id;
            return {
                isFlowPage: true,
                envId: flowData.envId,
                flowId: flowData.flowId,
            };
        }
    }

    // Fall back to cached state if URL extraction failed
    const existingState = tabStates.get(tab.id);
    if (existingState?.lastMatchedRequest) {
        return {
            isFlowPage: true,
            envId: existingState.lastMatchedRequest.envId,
            flowId: existingState.lastMatchedRequest.flowId,
        };
    }

    return { isFlowPage: false };
}

// Surface mode management (popup vs sidepanel)
const VIEW_MODE_KEY = 'appSettings';

async function getStoredViewMode(): Promise<'popup' | 'sidepanel'> {
    try {
        const result = await chrome.storage.local.get(VIEW_MODE_KEY);
        const settings = result[VIEW_MODE_KEY];
        if (settings?.viewMode === 'sidepanel') return 'sidepanel';
    } catch { /* ignore */ }
    return 'popup';
}

async function applySurfaceMode(mode: 'popup' | 'sidepanel') {
    debugLog('Applying surface mode:', mode);
    // chrome.sidePanel API may not be typed in older @types/chrome
    const sidePanel = (chrome as any).sidePanel as
        | { setPanelBehavior: (opts: { openPanelOnActionClick: boolean }) => Promise<void> }
        | undefined;

    if (mode === 'sidepanel') {
        // Disable popup so clicking icon opens the side panel
        await chrome.action.setPopup({ popup: '' });
        if (sidePanel?.setPanelBehavior) {
            await sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        }
    } else {
        // Re-enable popup, disable side panel auto-open
        await chrome.action.setPopup({ popup: 'index.html' });
        if (sidePanel?.setPanelBehavior) {
            await sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
        }
    }
}

// Main initialization
const main = async () => {
    // Restore state from session storage (survives service worker restarts)
    await restoreState();

    // Apply stored surface mode on startup
    const initialViewMode = await getStoredViewMode();
    await applySurfaceMode(initialViewMode);

    // Watch for settings changes to switch surface mode dynamically
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[VIEW_MODE_KEY]) {
            const newSettings = changes[VIEW_MODE_KEY].newValue;
            if (newSettings?.viewMode) {
                applySurfaceMode(newSettings.viewMode);
            }
        }
    });

    // Existing recording functionality
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Handle surface mode change messages
        if (message.type === 'set-view-mode') {
            const mode = message.mode as 'popup' | 'sidepanel';
            applySurfaceMode(mode).then(() => {
                sendResponse({ success: true });
            }).catch((error) => {
                debugError('Failed to set view mode:', error);
                sendResponse({ success: false, error: String(error) });
            });
            return true;
        }

        // Handle flow editor messages
        if (message.type === 'app-loaded' || message.type === 'refresh' || message.type === 'open-flow-editor' || message.type === 'check-flow-page') {
            if (message.type === 'open-flow-editor') {
                // Use sender.tab when message comes from a content script (bridge),
                // fall back to querying the active tab (popup).
                const getTab = sender.tab
                    ? Promise.resolve(sender.tab)
                    : new Promise<chrome.tabs.Tab | undefined>((resolve) => {
                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
                    });

                getTab.then((tab) => {
                    if (tab) {
                        sendResponse(openFlowEditor(tab));
                    } else {
                        sendResponse({ success: false, error: 'No active tab found' });
                    }
                });
                return true; // Keep channel open for async response
            }
            if (message.type === 'check-flow-page') {
                // Use sender.tab when available (content script bridge)
                checkFlowPage(sender.tab).then(result => sendResponse(result));
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
                "https://dod.api.powerapps.us/*",
                // Power Platform and Dynamics CRM endpoints
                "https://*.api.powerplatform.com/*",
                "https://*.dynamics.com/*"
            ],
        },
        ["requestHeaders"]
    );

    // Track when tabs are closed
    chrome.tabs.onRemoved.addListener((tabId) => {
        // If a flow editor tab was closed, clean up the reverse lookup and remove from set
        const initiatorId = editorToInitiator.get(tabId);
        if (initiatorId !== undefined) {
            debugLog('Flow editor tab closed:', tabId, 'for initiator:', initiatorId);
            editorToInitiator.delete(tabId);
            const state = tabStates.get(initiatorId);
            if (state) {
                state.flowEditorTabIds.delete(tabId);
                debugLog('Remaining editor tabs for initiator:', state.flowEditorTabIds.size);
            }
            return;
        }

        // If an initiator (Power Automate) tab was closed, clean up its state entirely
        const state = tabStates.get(tabId);
        if (state) {
            debugLog('Initiator tab closed:', tabId, 'with', state.flowEditorTabIds.size, 'editor tab(s)');
            Array.from(state.flowEditorTabIds).forEach((editorTabId) => {
                editorToInitiator.delete(editorTabId);
            });
            tabStates.delete(tabId);
        }
    });

    debugLog('Power Automate Toolkit background service initialized');
}

main();
