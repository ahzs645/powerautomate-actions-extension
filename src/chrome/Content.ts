import { ContentService, ExtensionCommunicationService, StorageService } from "../services";

const storageService = new StorageService();
const communicationService = new ExtensionCommunicationService();

const contentService = new ContentService(storageService, communicationService);

// The postMessage bridge is only exposed on Power Automate / Power Apps
// pages, and only for a fixed set of read-only-ish message types. The content
// script is injected into every https page, so without these gates any
// website could drive the extension and read the responses.
const BRIDGE_ALLOWED_HOST_PATTERN = /(^|\.)((make|flow)\.(powerautomate|powerapps)\.com|flow\.microsoft\.com|powerautomate\.us|powerapps\.us)$/i;
const BRIDGE_ALLOWED_MESSAGE_TYPES = new Set(['check-flow-page', 'open-flow-editor']);

const addBridgeListener = () => {
    if (!BRIDGE_ALLOWED_HOST_PATTERN.test(window.location.hostname)) { return; }

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.source !== 'pa-toolkit-bridge') return;
        if (event.origin !== window.location.origin) return;

        const { id, message } = event.data;
        if (!BRIDGE_ALLOWED_MESSAGE_TYPES.has(message?.type)) return;

        // Forward only the vetted type — never the raw page-supplied object.
        chrome.runtime.sendMessage({ type: message.type }, (response) => {
            window.postMessage({
                source: 'pa-toolkit-bridge-response',
                id,
                response,
                error: chrome.runtime.lastError?.message || null,
            }, window.location.origin);
        });
    });
}

const main = () => {
    chrome.runtime.onMessage.addListener(contentService.handleContentAction);
    contentService.addCopyListener();
    addBridgeListener();
}

main();
