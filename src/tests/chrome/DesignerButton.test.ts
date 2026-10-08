/**
 * @jest-environment jsdom
 */
import {
    BUTTON_ATTR,
    DesignerButtonController,
    findToolbar,
    parseMakerPageUrl,
    readPlatformSettings,
} from '../../chrome/DesignerButton';

const ENV = 'Default-11111111-2222-3333-4444-555555555555';
const FLOW = '6e2f407e-6cb2-e570-8bce-2be05952c2f6';

describe('parseMakerPageUrl', () => {
    test.each([
        [`https://make.powerautomate.com/environments/${ENV}/flows/${FLOW}`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.powerautomate.com/environments/${ENV}/flows/${FLOW}/details?v3=true`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.powerautomate.com/environments/${ENV}/flows/${FLOW.toUpperCase()}/edit`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.powerautomate.com/environments/${ENV}/flows/shared/${FLOW}`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.powerapps.com/environments/${ENV}/solutions/fd140aaf-4df4-11dd-bd17-0019b9312238/flows/${FLOW}`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.gov.powerautomate.us/environments/${ENV}/flows/${FLOW}`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.high.powerautomate.us/environments/${ENV}/flows/${FLOW}#x`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.powerautomate.appsplatform.us/environments/${ENV}/flows/${FLOW}`, { kind: 'flow', envId: ENV, flowId: FLOW }],
        [`https://make.powerautomate.com/environments/${ENV}/flows`, { kind: 'flowsList', envId: ENV }],
        [`https://make.powerautomate.com/environments/${ENV}/flows/`, { kind: 'flowsList', envId: ENV }],
        [`https://make.powerautomate.com/environments/${ENV}/flows/shared?tab=x`, { kind: 'flowsList', envId: ENV }],
    ])('%s', (url, expected) => {
        expect(parseMakerPageUrl(url)).toEqual(expected);
    });

    test.each([
        `https://make.powerautomate.com/environments/${ENV}/home`,
        `https://make.powerautomate.com/environments/${ENV}/flows/not-a-guid`,
        `https://make.powerautomate.com/environments/${ENV}/connections`,
        'https://make.powerautomate.com/',
        'garbage',
    ])('%s does not match', (url) => {
        expect(parseMakerPageUrl(url)).toBeNull();
    });
});

function designerToolbarHtml() {
    return `
      <header role="toolbar" aria-label="Portal header"><button>Settings</button><button>Help</button></header>
      <div class="designer">
        <div role="toolbar" aria-label="Designer commands" id="cmdbar" style="color: rgb(36,36,36)">
          <div class="ms-OverflowSet">
            <div class="ms-OverflowSet-item"><button aria-label="Undo">Undo</button></div>
            <div class="ms-OverflowSet-item"><button data-automation-id="save-button">Save draft</button></div>
            <div class="ms-OverflowSet-item"><button>Publish</button></div>
            <div class="ms-OverflowSet-item"><button>Test</button></div>
          </div>
        </div>
      </div>`;
}

describe('findToolbar', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    test('picks the designer command bar, not the portal header', () => {
        document.body.innerHTML = designerToolbarHtml();
        const match = findToolbar(document, 'flow');
        expect(match?.toolbar.id).toBe('cmdbar');
    });

    test('finds a Fluent CommandBar without roles via a Save button', () => {
        document.body.innerHTML = `<div class="bar" id="bar"><span><button title="Save">Save</button></span><span><button>Flow checker</button></span></div>`;
        expect(findToolbar(document, 'flow')?.toolbar.id).toBe('bar');
    });

    test('finds the flows list command bar by "New flow"', () => {
        document.body.innerHTML = `<div role="menubar" id="list"><button role="menuitem">+ New flow</button><button role="menuitem">Import</button></div>`;
        expect(findToolbar(document, 'flowsList')?.toolbar.id).toBe('list');
    });

    test('returns null when nothing looks like a designer', () => {
        document.body.innerHTML = `<div role="toolbar"><button>Share</button><button>Export</button></div>`;
        expect(findToolbar(document, 'flow')).toBeNull();
    });
});

describe('DesignerButtonController', () => {
    let clock = 0;
    const sendMessage = jest.fn(async () => ({ success: true }));

    function make(fallbackDelayMs = 1000) {
        return new DesignerButtonController({ sendMessage, fallbackDelayMs, now: () => clock, pollIntervalMs: 0 });
    }
    const buttons = () => document.querySelectorAll(`[${BUTTON_ATTR}]`);
    const flush = () => new Promise((r) => setTimeout(r, 40));

    beforeEach(() => {
        clock = 0;
        sendMessage.mockClear();
        document.body.innerHTML = '';
        document.head.innerHTML = '';
        window.history.replaceState({}, '', `/environments/${ENV}/flows/${FLOW}`);
    });

    test('inserts exactly one button next to the designer commands, idempotently', async () => {
        document.body.innerHTML = designerToolbarHtml();
        const controller = make();
        controller.setEnabled(true);
        controller.reconcile();
        controller.reconcile();
        await flush(); // let the observer react to our own insertion
        controller.reconcile();

        expect(buttons()).toHaveLength(1);
        const wrapper = buttons()[0];
        expect(wrapper.getAttribute(BUTTON_ATTR)).toBe('edit-json');
        expect(wrapper.getAttribute('data-placement')).toBe('toolbar');
        expect(document.getElementById('cmdbar')!.contains(wrapper)).toBe(true);
        // Sits right after the last matched command item
        expect(wrapper.previousElementSibling?.textContent).toBe('Test');
        const button = wrapper.querySelector('button')!;
        expect(button.getAttribute('aria-label')).toBe('Edit JSON (Power Automate Toolkit)');
        expect(button.type).toBe('button');
        expect(button.querySelector('svg')).not.toBeNull();
        controller.setEnabled(false);
    });

    test('click and keyboard activation open the editor via the background', async () => {
        document.body.innerHTML = designerToolbarHtml();
        const controller = make();
        controller.setEnabled(true);
        const button = document.querySelector(`[${BUTTON_ATTR}] button`) as HTMLButtonElement;
        button.click();
        await flush();
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage).toHaveBeenCalledWith({ type: 'open-flow-editor' });
        controller.setEnabled(false);
    });

    test('re-inserts after the host re-renders its toolbar, never duplicating', async () => {
        document.body.innerHTML = designerToolbarHtml();
        const controller = make();
        controller.setEnabled(true);
        expect(buttons()).toHaveLength(1);

        // Host replaces the whole designer subtree (React re-render)
        document.querySelector('.designer')!.innerHTML = designerToolbarHtml();
        await flush();
        expect(buttons()).toHaveLength(1);
        expect(document.querySelectorAll('#cmdbar')).toHaveLength(1);
        controller.setEnabled(false);
    });

    test('SPA navigation: removed when leaving a flow, label switches on the flows list', async () => {
        document.body.innerHTML = designerToolbarHtml() + `<div role="menubar" id="list"><button role="menuitem">New flow</button><button role="menuitem">Import</button></div>`;
        const controller = make();
        controller.setEnabled(true);
        expect(buttons()[0].getAttribute(BUTTON_ATTR)).toBe('edit-json');

        window.history.pushState({}, '', `/environments/${ENV}/flows`);
        controller.reconcile();
        expect(buttons()).toHaveLength(1);
        expect(buttons()[0].getAttribute(BUTTON_ATTR)).toBe('flows-list');
        expect(document.getElementById('list')!.contains(buttons()[0])).toBe(true);

        window.history.pushState({}, '', `/environments/${ENV}/connections`);
        controller.reconcile();
        expect(buttons()).toHaveLength(0);

        window.history.pushState({}, '', `/environments/${ENV}/flows/${FLOW}`);
        controller.reconcile();
        expect(buttons()).toHaveLength(1);
        controller.setEnabled(false);
    });

    test('falls back to a floating button only after the grace period', () => {
        const controller = make(1000);
        controller.setEnabled(true);
        expect(buttons()).toHaveLength(0);
        clock = 1500;
        controller.reconcile();
        expect(buttons()).toHaveLength(1);
        expect(buttons()[0].getAttribute('data-placement')).toBe('floating');
        controller.reconcile();
        expect(buttons()).toHaveLength(1);

        // Toolbar shows up later: floating button moves into it
        document.body.insertAdjacentHTML('afterbegin', designerToolbarHtml());
        controller.reconcile();
        expect(buttons()).toHaveLength(1);
        expect(buttons()[0].getAttribute('data-placement')).toBe('toolbar');
        controller.setEnabled(false);
    });

    test('disabling removes the button', () => {
        document.body.innerHTML = designerToolbarHtml();
        const controller = make();
        controller.setEnabled(true);
        expect(buttons()).toHaveLength(1);
        controller.setEnabled(false);
        expect(buttons()).toHaveLength(0);
    });

    test('uses menuitem role inside a menubar', () => {
        document.body.innerHTML = `<div role="menubar"><button role="menuitem">Save</button><button role="menuitem">Test</button></div>`;
        const controller = make();
        controller.setEnabled(true);
        expect(document.querySelector(`[${BUTTON_ATTR}] button`)!.getAttribute('role')).toBe('menuitem');
        controller.setEnabled(false);
    });
});

describe('readPlatformSettings', () => {
    test('defaults both switches to on', () => {
        expect(readPlatformSettings(undefined)).toEqual({ extensionEnabled: true, showDesignerButton: true });
        expect(readPlatformSettings({ showDesignerButton: false })).toEqual({ extensionEnabled: true, showDesignerButton: false });
        expect(readPlatformSettings({ extensionEnabled: false })).toEqual({ extensionEnabled: false, showDesignerButton: true });
    });
});
