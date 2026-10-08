import { ActionsService, BackgroundService, ExtensionCommunicationService, StorageService } from "../services";
import { FlowEditorActions, TokenAudience } from "../services/interfaces/IFlowEditorActions";
import { DiagnosticsStore, formatDiagnostics } from "../services/Diagnostics";
import {
    API_REQUEST_URL_PATTERNS,
    classifyApiUrl,
    extractEnvIdFromTabUrl as parseEnvIdFromTabUrl,
    extractFlowDataFromApiUrl,
    extractFlowDataFromTabUrl as parseFlowDataFromTabUrl,
    extractWorkflowEntityId,
    isMakerOrigin,
} from "./hosts";
import {
    AudienceTokens,
    buildTokenFields,
    isAudienceTokenExpired,
    migrateLegacyState,
    selectPrimary,
    summarizeTokens,
    upsertAudienceToken,
} from "./tokenStore";
import { readPlatformSettings } from "./DesignerButton";

const storageService = new StorageService();
const actionsService = new ActionsService();
const communicationService = new ExtensionCommunicationService();

const backgroundService = new BackgroundService(storageService, communicationService, actionsService);

// Flow Editor State
interface FlowEditorState {
    /**
     * One token per audience (flow / powerPlatform / dataverse / powerApps).
     * Tokens stay in this worker's memory and chrome.storage.session only;
     * they are sent to the toolkit's own extension pages, never to content scripts.
     */
    tokens: AudienceTokens;
    lastMatchedRequest?: { envId: string; flowId: string } | null;
    // Environment of the page even when no single flow is open (e.g. the flows list)
    lastMatchedEnvId?: string;
    initiatorTabId?: number;
    flowEditorTabIds: Set<number>;
    lastSentSignature?: string; // Track what was last sent to editors to avoid noisy broadcasts
    /** Dataverse workflow id, with the flow it was seen for (when known). */
    workflowEntity?: { id: string; flowId?: string };
    /** exp (ms) per audience we already raised an expiry notification for. */
    notifiedExpiry?: Partial<Record<TokenAudience, number>>;
}

// Per-tab state: keyed by initiator (Power Automate) tab ID
const tabStates = new Map<number, FlowEditorState>();
// Reverse lookup: flow editor tab ID → initiator tab ID
const editorToInitiator = new Map<number, number>();

const diagnostics = new DiagnosticsStore({
    get: (key) => chrome.storage.session.get(key),
    set: (items) => chrome.storage.session.set(items),
});

// Persist critical state to chrome.storage.session so it survives
// MV3 service worker restarts (worker goes idle after ~30s)
const SESSION_KEY = 'pa_toolkit_tab_states';

type SerializedTabState = Omit<FlowEditorState, 'flowEditorTabIds' | 'tokens'> & {
    tokens?: AudienceTokens;
    flowEditorTabIds?: number[];
    // pre-2.4 single-token fields, migrated on restore
    token?: string;
    apiUrl?: string;
    tokenExpiresMs?: number;
};

interface SerializedState {
    tabStates: Record<string, SerializedTabState>;
    editorToInitiator: Record<string, number>;
}

// Session storage defaults to trusted contexts, but be explicit: content
// scripts must never be able to read captured tokens.
try {
    (chrome.storage.session as any).setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
} catch { /* older Chrome */ }

async function persistState() {
    const serialized: SerializedState = {
        tabStates: {},
        editorToInitiator: {},
    };
    tabStates.forEach((state, tabId) => {
        const { flowEditorTabIds, ...rest } = state;
        serialized.tabStates[tabId.toString()] = {
            ...rest,
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
            const { flowEditorTabIds: editorIds, token, apiUrl, tokenExpiresMs, tokens, ...rest } = state;
            tabStates.set(Number(tabId), {
                ...rest,
                tokens: tokens || migrateLegacyState(apiUrl, token, tokenExpiresMs),
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
        tabStates.set(tabId, { tokens: {}, flowEditorTabIds: new Set() });
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
function hasValidPrimaryToken(state: FlowEditorState): boolean {
    const primary = selectPrimary(state.tokens);
    return !!primary && !isAudienceTokenExpired(primary);
}

function showNotification(message: string) {
    chrome.notifications?.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('logo48.png'),
        title: 'Power Automate Toolkit',
        message: message
    });
}

const AUDIENCE_LABELS: Record<TokenAudience, string> = {
    flow: 'Power Automate',
    powerPlatform: 'Power Platform',
    dataverse: 'Dataverse',
    powerApps: 'Power Apps',
};

/** One notification per audience per expired token (not on every broadcast). */
function notifyExpiredAudiences(state: FlowEditorState) {
    state.notifiedExpiry = state.notifiedExpiry || {};
    // Power Apps tokens are only relevant when they are the primary pair
    const primaryAudience = selectPrimary(state.tokens)?.audience;
    const audiences = (Object.keys(state.tokens) as TokenAudience[])
        .filter((a) => a !== 'powerApps' || a === primaryAudience);
    audiences.forEach((audience) => {
        const entry = state.tokens[audience];
        if (!entry || !isAudienceTokenExpired(entry)) return;
        if (state.notifiedExpiry![audience] === entry.exp) return;
        state.notifiedExpiry![audience] = entry.exp;
        debugError('Token expired for audience:', audience);
        recordDiagnostic(state.initiatorTabId, { kind: 'token-expired', audience, host: entry.host, flags: { hasToken: true } });
        showNotification(`${AUDIENCE_LABELS[audience]} authentication token expired. Please refresh the Power Automate page.`);
    });
}

function buildTokenChangedMessage(state: FlowEditorState): FlowEditorActions | null {
    const fields = buildTokenFields(state.tokens);
    if (!fields.token || !fields.apiUrl) return null;
    const workflowEntityId = state.workflowEntity &&
        (!state.workflowEntity.flowId || !state.lastMatchedRequest || state.workflowEntity.flowId === state.lastMatchedRequest.flowId)
        ? state.workflowEntity.id
        : undefined;
    return {
        type: "token-changed",
        ...fields,
        token: fields.token,
        apiUrl: fields.apiUrl,
        workflowEntityId,
    };
}

function sendTokenChanged(state: FlowEditorState, force?: boolean) {
    notifyExpiredAudiences(state);

    if (!hasValidPrimaryToken(state)) {
        debugError('Cannot send token - no valid Flow/Power Platform token captured');
        return;
    }

    const message = buildTokenChangedMessage(state);
    if (!message) return;

    // Skip if we already sent these exact tokens (avoids noisy broadcasts
    // when Power Automate cycles between multiple tokens)
    const signature = JSON.stringify(message);
    if (!force && state.lastSentSignature === signature) {
        return;
    }

    debugLog('Sending token changed message');
    state.lastSentSignature = signature;
    sendMessageToFlowEditorTab(state, message);
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

function extractEnvIdFromTabUrl(url?: string): string | null {
    const envId = parseEnvIdFromTabUrl(url);
    debugLog(envId ? 'Environment ID found:' : 'No environment ID found in URL', envId || '');
    return envId;
}

function extractFlowDataFromTabUrl(url?: string): { envId: string; flowId: string } | null {
    const flowData = parseFlowDataFromTabUrl(url);
    debugLog(flowData ? 'Flow found in tab URL' : 'No flow ID found in URL');
    return flowData;
}

// Master switch (appSettings.extensionEnabled, default true): when off, no
// token capture, no recording, no designer button, grey toolbar icon.
let extensionEnabled = true;

function recordDiagnostic(tabId: number | undefined, event: Record<string, unknown>) {
    if (tabId === undefined || tabId < 0) return;
    diagnostics.record(tabId, event).catch(() => undefined);
}

// Listen for API requests to capture tokens, one per audience
function listenFlowApiRequests(details: chrome.webRequest.WebRequestHeadersDetails) {
    if (!extensionEnabled) {
        return;
    }
    // Requests without a tab (service workers, prefetch) and requests from our
    // own editor tabs are never a source of tokens.
    if (details.tabId < 0 || editorToInitiator.has(details.tabId)) {
        return;
    }

    const endpoint = classifyApiUrl(details.url);
    const flowData = extractFlowDataFromApiUrl(details.url);
    const fromMakerPage = isMakerOrigin(details.initiator);

    // Dataverse traffic is only interesting from the maker portal; Dynamics 365
    // apps (and anything else on *.dynamics.com) are ignored entirely.
    if (endpoint?.audience === 'dataverse' && !fromMakerPage) {
        return;
    }
    if (!endpoint && !flowData) {
        return;
    }

    const state = getOrCreateTabState(details.tabId);
    let changed = false;

    if (flowData) {
        state.lastMatchedRequest = flowData;
        state.initiatorTabId = details.tabId;
    }

    if (endpoint?.audience === 'dataverse') {
        const workflowId = extractWorkflowEntityId(details.url);
        if (workflowId && state.workflowEntity?.id !== workflowId) {
            state.workflowEntity = { id: workflowId, flowId: state.lastMatchedRequest?.flowId };
            changed = true;
            debugLog('Captured Dataverse workflow id for tab:', details.tabId);
        }
    }

    if (!endpoint) {
        return;
    }

    const authHeader = details.requestHeaders?.find(
        (x) => x.name.toLowerCase() === "authorization"
    );
    const token = authHeader?.value;

    if (token && /^bearer\s/i.test(token)) {
        const result = upsertAudienceToken(state.tokens, endpoint, token);
        if (result.changed) {
            changed = true;
            state.initiatorTabId = details.tabId;
            debugLog('New', endpoint.audience, 'token from', endpoint.host, 'for tab:', details.tabId);
            recordDiagnostic(details.tabId, {
                kind: 'token',
                audience: endpoint.audience,
                host: endpoint.host,
                flags: { hasToken: true, fromMakerPage },
            });
        }
    }

    if (changed) {
        // Push tokens / workflow id to any open editor tabs for this initiator
        if (state.flowEditorTabIds.size > 0) {
            sendTokenChanged(state);
        }
        // Persist state so it survives service worker restarts
        persistState();
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
        case 'set-workflow-entity-id': {
            const id = String(action.workflowEntityId || '').replace(/[{}]/g, '').toLowerCase();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
                sendResponse({ success: false, error: 'Invalid workflow id' });
                return true;
            }
            const flowId = typeof action.flowId === 'string' ? action.flowId.toLowerCase() : state.lastMatchedRequest?.flowId;
            const changed = state.workflowEntity?.id !== id || state.workflowEntity?.flowId !== flowId;
            state.workflowEntity = { id, flowId };
            sendResponse({ success: true });
            if (changed) {
                persistState();
                sendTokenChanged(state);
            }
            return true;
        }
    }

    sendResponse();
    return true;
}

function checkPrimaryToken(state: FlowEditorState): string | null {
    if (!extensionEnabled) {
        showNotification('Power Automate Toolkit is turned off. Turn it on in the toolkit settings.');
        return 'Extension disabled';
    }
    const primary = selectPrimary(state.tokens);
    if (!primary) {
        debugError('No authentication token found');
        showNotification('No authentication detected. Please refresh the Power Automate page and try again.');
        return 'No authentication token';
    }
    if (isAudienceTokenExpired(primary)) {
        debugError('Token expired, requesting refresh');
        showNotification('Token expired. Please refresh the Power Automate page and try again.');
        return 'Token expired';
    }
    return null;
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
        tokens: summarizeTokens(state.tokens),
        currentTabUrl: tab.url
    });

    if (!state.lastMatchedRequest) {
        debugError('No flow data found. Make sure you are on a Power Automate flow page.');
        showNotification('Please navigate to a Power Automate flow page first.');
        return { success: false, error: 'No flow data found' };
    }

    const tokenProblem = checkPrimaryToken(state);
    if (tokenProblem) {
        recordDiagnostic(tab.id, { kind: 'open-failed', detail: tokenProblem, flags: { hasToken: !!selectPrimary(state.tokens) } });
        return { success: false, error: tokenProblem };
    }

    const appUrl = `${chrome.runtime.getURL("flow-editor.html")}?envId=${
        state.lastMatchedRequest.envId
    }&flowId=${state.lastMatchedRequest.flowId}`;

    openToolkitTab(state, tab.id, appUrl, 'Failed to open flow editor. Please try again.');
    recordDiagnostic(tab.id, { kind: 'open-editor', flags: { hasToken: true, hasDataverse: !!state.tokens.dataverse, hasWorkflowEntityId: !!state.workflowEntity } });

    return { success: true };
}

// Open the environment's flow list (same page bundle as the editor, without a flowId)
function openFlowsList(tab: chrome.tabs.Tab) {
    if (!tab.id) {
        debugError('No tab ID available');
        return { success: false, error: 'No tab ID' };
    }

    const state = getOrCreateTabState(tab.id);

    // Re-extract from the live tab URL so switching environments opens the right list
    const envId = extractEnvIdFromTabUrl(tab.url) || state.lastMatchedEnvId;
    if (envId) {
        state.lastMatchedEnvId = envId;
        state.initiatorTabId = tab.id;
    }

    debugLog('Opening flows list for tab:', tab.id, {
        envId,
        tokens: summarizeTokens(state.tokens),
        currentTabUrl: tab.url
    });

    if (!envId) {
        debugError('No environment found. Make sure you are on a Power Automate page.');
        showNotification('Please navigate to a Power Automate environment first.');
        return { success: false, error: 'No environment found' };
    }

    const tokenProblem = checkPrimaryToken(state);
    if (tokenProblem) {
        recordDiagnostic(tab.id, { kind: 'open-failed', detail: tokenProblem, flags: { hasToken: !!selectPrimary(state.tokens) } });
        return { success: false, error: tokenProblem };
    }

    const appUrl = `${chrome.runtime.getURL("flow-editor.html")}?envId=${envId}`;

    openToolkitTab(state, tab.id, appUrl, 'Failed to open the flows list. Please try again.');
    recordDiagnostic(tab.id, { kind: 'open-flows-list', flags: { hasToken: true } });

    return { success: true };
}

// Create a toolkit tab and wire it to its initiator so token updates reach it
function openToolkitTab(state: FlowEditorState, initiatorTabId: number, appUrl: string, failureMessage: string) {
    debugLog('Creating toolkit tab with URL:', appUrl);

    chrome.tabs.create({ url: appUrl }, (appTab) => {
        if (chrome.runtime.lastError) {
            debugError('Failed to create toolkit tab:', chrome.runtime.lastError);
            showNotification(failureMessage);
            return;
        }
        state.flowEditorTabIds.add(appTab.id!);
        editorToInitiator.set(appTab.id!, initiatorTabId);
        debugLog('Toolkit tab created with ID:', appTab.id, 'for initiator tab:', initiatorTabId,
            '(total editor tabs:', state.flowEditorTabIds.size + ')');
        persistState();
    });
}

// Check if a tab is a flow page. Uses the provided tab if available (from sender.tab),
// otherwise falls back to querying the active tab.
async function checkFlowPage(senderTab?: chrome.tabs.Tab): Promise<{ isFlowPage: boolean; isEnvironmentPage: boolean; envId?: string; flowId?: string }> {
    const tab = senderTab || await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });

    if (!tab?.id) {
        return { isFlowPage: false, isEnvironmentPage: false };
    }

    // Always extract from the current tab URL to handle SPA navigation
    // (user may have navigated to a different flow without a full page reload)
    if (tab.url) {
        const flowData = extractFlowDataFromTabUrl(tab.url);
        if (flowData) {
            const state = getOrCreateTabState(tab.id);
            state.lastMatchedRequest = flowData;
            state.lastMatchedEnvId = flowData.envId;
            state.initiatorTabId = tab.id;
            return {
                isFlowPage: true,
                isEnvironmentPage: true,
                envId: flowData.envId,
                flowId: flowData.flowId,
            };
        }

        // No flow in the URL, but the environment alone is enough to list flows
        const envId = extractEnvIdFromTabUrl(tab.url);
        if (envId) {
            const state = getOrCreateTabState(tab.id);
            state.lastMatchedEnvId = envId;
            state.initiatorTabId = tab.id;
            return { isFlowPage: false, isEnvironmentPage: true, envId };
        }
    }

    // Fall back to cached state if URL extraction failed
    const existingState = tabStates.get(tab.id);
    if (existingState?.lastMatchedRequest) {
        return {
            isFlowPage: true,
            isEnvironmentPage: true,
            envId: existingState.lastMatchedRequest.envId,
            flowId: existingState.lastMatchedRequest.flowId,
        };
    }
    if (existingState?.lastMatchedEnvId) {
        return { isFlowPage: false, isEnvironmentPage: true, envId: existingState.lastMatchedEnvId };
    }

    return { isFlowPage: false, isEnvironmentPage: false };
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

async function getStoredPlatformSettings() {
    try {
        const result = await chrome.storage.local.get(VIEW_MODE_KEY);
        return readPlatformSettings(result[VIEW_MODE_KEY]);
    } catch {
        return readPlatformSettings(undefined);
    }
}

// Absolute paths: relative ones resolve against the worker script (static/js/).
const ICONS_ENABLED = { '16': '/logo16.png', '48': '/logo48.png', '128': '/logo128.png' };
const ICONS_DISABLED = { '16': '/logo16-disabled.png', '48': '/logo48-disabled.png', '128': '/logo128-disabled.png' };

async function applyExtensionEnabled(enabled: boolean) {
    const wasEnabled = extensionEnabled;
    extensionEnabled = enabled;
    backgroundService.setPlatformEnabled(enabled);
    if (!enabled && wasEnabled) {
        // Turning the toolkit off forgets every captured token.
        tabStates.forEach((state) => {
            state.tokens = {};
            state.workflowEntity = undefined;
            state.lastSentSignature = undefined;
        });
        persistState();
    }
    try {
        await chrome.action.setTitle({ title: enabled ? 'Open Power Automate Toolkit' : 'Power Automate Toolkit (turned off)' });
        await chrome.action.setIcon({ path: enabled ? ICONS_ENABLED : ICONS_DISABLED });
    } catch (error) {
        // Fall back to a badge if the grey icons cannot be loaded
        debugError('Failed to set action icon:', error);
        chrome.action.setBadgeText?.({ text: enabled ? '' : 'off' });
    }
}

async function loadPlatformSettings() {
    const settings = await getStoredPlatformSettings();
    if (!settings.extensionEnabled) {
        await applyExtensionEnabled(false);
    }
}

// All listeners must be registered synchronously in the first turn of the
// script: MV3 delivers the event that woke an evicted service worker only to
// listeners that already exist by the time the initial synchronous execution
// finishes. Handlers that touch tabStates/editorToInitiator await stateReady
// so restored session state is in place before they run.
const stateReady = Promise.all([restoreState(), loadPlatformSettings()]).then(() => undefined);

// Watch for settings changes to switch surface mode dynamically
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[VIEW_MODE_KEY]) {
        const newSettings = changes[VIEW_MODE_KEY].newValue;
        if (newSettings?.viewMode && newSettings.viewMode !== changes[VIEW_MODE_KEY].oldValue?.viewMode) {
            applySurfaceMode(newSettings.viewMode);
        }
        const enabled = readPlatformSettings(newSettings).extensionEnabled;
        if (enabled !== extensionEnabled) {
            stateReady.then(() => applyExtensionEnabled(enabled));
        }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    stateReady.then(() => handleRuntimeMessage(message, sender, sendResponse));
    return true; // Keep the channel open; handlers respond asynchronously
});

/** Popup, side panel and editor tabs — never a content script in a web page. */
function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
    return sender.id === chrome.runtime.id && !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]));
    });
}

/** The Power Automate tab a request is about: an editor's initiator, else the active tab. */
async function resolveInitiatorTabId(sender: chrome.runtime.MessageSender, explicitTabId?: unknown): Promise<number | undefined> {
    if (sender.tab?.id !== undefined) {
        const initiator = editorToInitiator.get(sender.tab.id);
        if (initiator !== undefined) return initiator;
    }
    if (typeof explicitTabId === 'number' && Number.isInteger(explicitTabId)) return explicitTabId;
    if (sender.tab?.id !== undefined) return sender.tab.id;
    return (await getActiveTab())?.id;
}

async function getDiagnosticsText(sender: chrome.runtime.MessageSender, explicitTabId?: unknown): Promise<string> {
    const tabId = await resolveInitiatorTabId(sender, explicitTabId);
    const state = tabId !== undefined ? tabStates.get(tabId) : undefined;
    const events = tabId !== undefined ? await diagnostics.get(tabId) : [];
    let version: string | undefined;
    try { version = chrome.runtime.getManifest().version; } catch { /* ignore */ }
    return formatDiagnostics(events, {
        extensionVersion: version,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        extensionEnabled,
        envId: state?.lastMatchedRequest?.envId || state?.lastMatchedEnvId,
        flowId: state?.lastMatchedRequest?.flowId,
        hasWorkflowEntityId: state ? !!state.workflowEntity : undefined,
        editorTabs: state?.flowEditorTabIds.size,
        tokens: state ? summarizeTokens(state.tokens) : {},
    });
}

/**
 * Inject the content script into the active tab on demand. Used by the popup
 * for pages outside the declared content_scripts matches (community blogs:
 * "Copy all from page" and the per-action copy buttons). Relies on the
 * activeTab grant the user gave by clicking the toolbar icon.
 */
async function ensureContentScript(): Promise<{ success: boolean; injected?: boolean; error?: string }> {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
        return { success: false, error: 'This page cannot be scripted' };
    }
    try {
        const [probe] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => !!(window as any).__paToolkitContentLoaded,
        });
        if (probe?.result) {
            return { success: true, injected: false };
        }
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['static/js/content.js'],
        });
        return { success: true, injected: true };
    } catch (error) {
        debugError('On-demand content script injection failed:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function handleRuntimeMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
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

        // Extension-page-only messages (tokens, diagnostics and scripting are
        // never reachable from a content script running in a web page).
        if (message.type === 'get-diagnostics' || message.type === 'diagnostics-event' ||
            message.type === 'ensure-content-script' || message.type === 'get-platform-status' ||
            message.type === 'set-workflow-entity-id') {
            if (!isExtensionPageSender(sender)) {
                sendResponse({ success: false, error: 'Not allowed' });
                return true;
            }
            switch (message.type) {
                case 'get-diagnostics':
                    getDiagnosticsText(sender, message.tabId)
                        .then((text) => sendResponse({ text }))
                        .catch((error) => sendResponse({ text: `Diagnostics unavailable: ${String(error)}` }));
                    return true;
                case 'diagnostics-event':
                    resolveInitiatorTabId(sender).then((tabId) => {
                        recordDiagnostic(tabId, message.event || {});
                        sendResponse({ success: true });
                    });
                    return true;
                case 'ensure-content-script':
                    ensureContentScript().then(sendResponse);
                    return true;
                case 'get-platform-status':
                    getStoredPlatformSettings().then(sendResponse);
                    return true;
                case 'set-workflow-entity-id':
                    return handleFlowEditorMessage(message, sender, sendResponse);
            }
        }

        // Handle flow editor messages
        if (message.type === 'app-loaded' || message.type === 'refresh' || message.type === 'open-flow-editor' || message.type === 'open-flows-list' || message.type === 'check-flow-page') {
            if (message.type === 'open-flow-editor' || message.type === 'open-flows-list') {
                const open = message.type === 'open-flow-editor' ? openFlowEditor : openFlowsList;

                // Use sender.tab when message comes from a content script (bridge
                // or the in-designer "Edit JSON" button), fall back to querying
                // the active tab (popup).
                const getTab = sender.tab
                    ? Promise.resolve(sender.tab)
                    : getActiveTab();

                getTab.then((tab) => {
                    if (tab) {
                        sendResponse(open(tab));
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
}

// Record actions (existing functionality)
backgroundService.recordActions();

// Listen for API requests for token extraction (Flow, Power Platform,
// Power Apps and Dataverse — commercial and US Government clouds)
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => { stateReady.then(() => listenFlowApiRequests(details)); },
    { urls: API_REQUEST_URL_PATTERNS },
    ["requestHeaders"]
);

// Track when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    stateReady.then(() => {
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

        diagnostics.removeTab(tabId).catch(() => undefined);

        // If an initiator (Power Automate) tab was closed, clean up its state entirely
        const state = tabStates.get(tabId);
        if (state) {
            debugLog('Initiator tab closed:', tabId, 'with', state.flowEditorTabIds.size, 'editor tab(s)');
            Array.from(state.flowEditorTabIds).forEach((editorTabId) => {
                editorToInitiator.delete(editorTabId);
            });
            tabStates.delete(tabId);
            persistState();
        }
    });
});

// Async initialization that does not involve listener registration
const main = async () => {
    await stateReady;
    const initialViewMode = await getStoredViewMode();
    await applySurfaceMode(initialViewMode);
    debugLog('Power Automate Toolkit background service initialized');
}

main();
