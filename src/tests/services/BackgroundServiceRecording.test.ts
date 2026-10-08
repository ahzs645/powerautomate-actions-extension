import { BackgroundService } from '../../services';

function makeEvent() {
    const listeners = new Set<Function>();
    return {
        listeners,
        addListener: jest.fn((fn: Function, ..._rest: any[]) => { listeners.add(fn); }),
        removeListener: jest.fn((fn: Function) => { listeners.delete(fn); }),
    };
}

describe('BackgroundService recording listeners', () => {
    let onBeforeRequest: ReturnType<typeof makeEvent>;
    let onBeforeSendHeaders: ReturnType<typeof makeEvent>;
    let onChanged: ReturnType<typeof makeEvent>;

    beforeEach(() => {
        onBeforeRequest = makeEvent();
        onBeforeSendHeaders = makeEvent();
        onChanged = makeEvent();
        (global as any).chrome = {
            webRequest: { onBeforeRequest, onBeforeSendHeaders },
            storage: { onChanged },
        };
    });

    afterEach(() => {
        delete (global as any).chrome;
    });

    const make = (isRecording: boolean) => new BackgroundService(
        { getIsRecordingValue: jest.fn(async () => isRecording) } as any,
        { sendRequest: jest.fn() } as any,
        { getCorrectAction: jest.fn() } as any,
    );
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const fireStorage = (newValue: boolean) => onChanged.listeners.forEach((fn) => fn({ isRecordingActions: { newValue } }, 'local'));

    test('attaches synchronously, then detaches when storage says not recording', async () => {
        const service = make(false);
        service.recordActions();
        expect(onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
        await flush();
        expect(service.isRecordingListenerAttached()).toBe(false);
        expect(onBeforeRequest.listeners.size).toBe(0);
        expect(onBeforeSendHeaders.listeners.size).toBe(0);
    });

    test('only watches SharePoint and Graph XHRs while recording', async () => {
        const service = make(true);
        service.recordActions();
        await flush();
        expect(service.isRecordingListenerAttached()).toBe(true);
        const filter = onBeforeRequest.addListener.mock.calls[0][1] as chrome.webRequest.RequestFilter;
        expect(filter.types).toEqual(['xmlhttprequest']);
        expect(filter.urls).not.toContain('<all_urls>');
        expect(filter.urls).toEqual(expect.arrayContaining(['https://*.sharepoint.com/*', 'https://graph.microsoft.com/*']));
        expect(onBeforeRequest.addListener.mock.calls[0][2]).toEqual(['requestBody']);
    });

    test('follows the recording flag and the master switch', async () => {
        const service = make(false);
        service.recordActions();
        await flush();
        fireStorage(true);
        expect(service.isRecordingListenerAttached()).toBe(true);
        service.setPlatformEnabled(false);
        expect(service.isRecordingListenerAttached()).toBe(false);
        service.setPlatformEnabled(true);
        expect(service.isRecordingListenerAttached()).toBe(true);
        fireStorage(false);
        expect(service.isRecordingListenerAttached()).toBe(false);
        expect(onBeforeRequest.listeners.size).toBe(0);
    });
});
