import { ContentService, ExtensionCommunicationService, StorageService } from "../services";

const storageService = new StorageService();
const communicationService = new ExtensionCommunicationService();

const contentService = new ContentService(storageService, communicationService);

const main = () => {
    chrome.runtime.onMessage.addListener(contentService.handleContentAction);
    contentService.addCopyListener();

    // Bridge: allow the page's main world to communicate with the extension
    // via window.postMessage. This enables automated browser testing tools
    // that can't access chrome.runtime directly.
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.source !== 'pa-toolkit-bridge') return;

        const { id, message } = event.data;
        chrome.runtime.sendMessage(message, (response) => {
            window.postMessage({
                source: 'pa-toolkit-bridge-response',
                id,
                response,
                error: chrome.runtime.lastError?.message || null,
            }, '*');
        });
    });
}

main();
