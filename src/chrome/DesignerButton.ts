/**
 * "Edit JSON" button injected into the Power Automate designer's command bar.
 *
 * Runs in the content script, top frame only, on maker hosts. The host page is
 * a SPA whose markup changes without notice, so detection is defensive:
 *   1. a role=toolbar / role=menubar / Fluent CommandBar whose buttons include
 *      the designer's Save / Save draft / Publish / Test / Flow checker commands;
 *   2. otherwise the nearest toolbar-like ancestor of a "Save" button;
 *   3. otherwise, after a grace period, a small floating button at the
 *      bottom-right of the page.
 * A rAF-throttled MutationObserver plus URL-change detection keeps exactly one
 * button in place across SPA navigation.
 */

import { GUID_SOURCE } from './hosts';

export type MakerPageMatch =
    | { kind: 'flow'; envId: string; flowId: string }
    | { kind: 'flowsList'; envId: string };

const FLOW_PAGE_RE = new RegExp(
    `/environments/([^/?#]+)/(?:solutions/[^/?#]+/)?flows/(?:shared/)?(${GUID_SOURCE})(?:[/?#]|$)`, 'i');
const FLOWS_LIST_RE = /\/environments\/([^/?#]+)\/flows(?:\/(?:shared|team|my))?\/?(?:[?#]|$)/i;

/** Parse a maker URL into a flow page or an environment's flows list. */
export function parseMakerPageUrl(href: string): MakerPageMatch | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const path = decodeURIComponent(url.pathname) + url.search + url.hash;
    const flow = FLOW_PAGE_RE.exec(path);
    if (flow) return { kind: 'flow', envId: flow[1], flowId: flow[2].toLowerCase() };
    const list = FLOWS_LIST_RE.exec(path);
    if (list) return { kind: 'flowsList', envId: list[1] };
    return null;
}

export const BUTTON_ATTR = 'data-pa-toolkit-button';
const STYLE_ID = 'pa-toolkit-designer-button-style';

const CODE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LIST_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const DESIGNER_SIGNALS: Array<{ name: string; re: RegExp; weight: number }> = [
    { name: 'save', re: /^(save|save draft|save as)$|\bsave\b/i, weight: 2 },
    { name: 'publish', re: /\bpublish\b/i, weight: 2 },
    { name: 'test', re: /^test$|\btest flow\b|\btest\b/i, weight: 1 },
    { name: 'checker', re: /flow ?checker/i, weight: 1 },
    { name: 'undo', re: /^undo$/i, weight: 1 },
    { name: 'redo', re: /^redo$/i, weight: 1 },
];
const LIST_SIGNALS: Array<{ name: string; re: RegExp; weight: number }> = [
    { name: 'new', re: /^\+?\s*new flow\b|^new$/i, weight: 2 },
    { name: 'import', re: /^import\b/i, weight: 1 },
    { name: 'edit', re: /^edit columns$/i, weight: 1 },
];

const TOOLBAR_SELECTOR = '[role="toolbar"], [role="menubar"], .ms-CommandBar, [data-automation-id*="CommandBar"], [data-automation-id*="commandbar"], [data-automation-id*="Toolbar"], [data-automation-id*="toolbar"]';
const CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"], a[href]';

function labelOf(el: Element): string {
    const parts = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-automation-id'),
        el.getAttribute('name'),
        (el.textContent || '').trim(),
    ];
    return parts.filter(Boolean).join(' | ').slice(0, 200);
}

function isOurs(el: Element): boolean {
    return !!el.closest(`[${BUTTON_ATTR}]`);
}

function isHidden(el: Element): boolean {
    if ((el as HTMLElement).hidden) return true;
    if (el.closest('[aria-hidden="true"]')) return true;
    return false;
}

function scoreControls(controls: Element[], signals: typeof DESIGNER_SIGNALS): { score: number; hits: Set<string>; anchor?: Element } {
    const hits = new Set<string>();
    let score = 0;
    let anchor: Element | undefined;
    controls.forEach((c) => {
        if (isOurs(c)) return;
        const label = labelOf(c);
        signals.forEach((s) => {
            // Match on each label component so "Save | save-button" works
            const matched = label.split(' | ').some((part) => s.re.test(part.trim()));
            if (matched && !hits.has(s.name)) {
                hits.add(s.name);
                score += s.weight;
                anchor = c;
            }
        });
    });
    return { score, hits, anchor };
}

export interface ToolbarMatch {
    toolbar: Element;
    /** Control after whose top-level item our button is inserted. */
    anchor?: Element;
}

/**
 * Find the command bar for the current page. `minScore` keeps unrelated
 * toolbars (e.g. the portal header) from matching.
 */
export function findToolbar(doc: Document, kind: MakerPageMatch['kind']): ToolbarMatch | null {
    const signals = kind === 'flow' ? DESIGNER_SIGNALS : LIST_SIGNALS;
    const minScore = kind === 'flow' ? 3 : 2;

    let best: { toolbar: Element; score: number; anchor?: Element } | null = null;

    // Strategy 1: explicit toolbars/command bars
    doc.querySelectorAll(TOOLBAR_SELECTOR).forEach((tb) => {
        if (isOurs(tb) || isHidden(tb)) return;
        const controls = Array.from(tb.querySelectorAll(CONTROL_SELECTOR));
        const { score, anchor } = scoreControls(controls, signals);
        if (score >= minScore && (!best || score > best.score || (score === best.score && tb.contains(best.toolbar)))) {
            best = { toolbar: tb, score, anchor };
        }
    });
    if (best) {
        const b = best as { toolbar: Element; anchor?: Element };
        return { toolbar: b.toolbar, anchor: b.anchor };
    }

    // Strategy 2: a recognisable control, then walk up to a container with siblings
    const controls = Array.from(doc.querySelectorAll(CONTROL_SELECTOR)).filter((c) => !isOurs(c) && !isHidden(c));
    const primary = controls.find((c) => {
        const label = labelOf(c);
        return kind === 'flow'
            ? label.split(' | ').some((p) => /^(save|save draft)$/i.test(p.trim()))
            : label.split(' | ').some((p) => /^\+?\s*new flow$/i.test(p.trim()));
    });
    if (primary) {
        let node: Element | null = primary.parentElement;
        for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            const inner = Array.from(node.querySelectorAll(CONTROL_SELECTOR));
            const { score } = scoreControls(inner, signals);
            if (inner.length >= 2 && score >= minScore - 1) {
                return { toolbar: node, anchor: primary };
            }
        }
    }
    return null;
}

function ensureStyle(doc: Document) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    // Inherit the command bar's font and colour so the button matches light/dark themes.
    style.textContent = `
[${BUTTON_ATTR}] { display: inline-flex; align-items: center; align-self: stretch; }
[${BUTTON_ATTR}] > button {
  display: inline-flex; align-items: center; gap: 6px; height: 100%; min-height: 32px;
  padding: 0 8px; margin: 0 2px; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap;
}
[${BUTTON_ATTR}] > button:hover { background: rgba(127,127,127,0.14); }
[${BUTTON_ATTR}] > button:active { background: rgba(127,127,127,0.24); }
[${BUTTON_ATTR}] > button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
[${BUTTON_ATTR}] > button[aria-busy="true"] { opacity: 0.6; cursor: progress; }
[${BUTTON_ATTR}] svg { flex: none; }
[${BUTTON_ATTR}][data-placement="floating"] {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
}
[${BUTTON_ATTR}][data-placement="floating"] > button {
  min-height: 36px; padding: 0 12px; border-radius: 18px;
  background: #fff; color: #242424; border-color: rgba(0,0,0,0.12);
  box-shadow: 0 2px 8px rgba(0,0,0,0.18); font: 600 13px "Segoe UI", system-ui, sans-serif;
}
[${BUTTON_ATTR}][data-placement="floating"] > button:hover { background: #f3f2f1; }
@media (prefers-color-scheme: dark) {
  [${BUTTON_ATTR}][data-placement="floating"] > button { background: #292929; color: #fff; border-color: rgba(255,255,255,0.16); }
  [${BUTTON_ATTR}][data-placement="floating"] > button:hover { background: #3d3d3d; }
}`;
    (doc.head || doc.documentElement).appendChild(style);
}

interface ButtonSpec {
    id: 'edit-json' | 'flows-list';
    label: string;
    title: string;
    icon: string;
    message: 'open-flow-editor' | 'open-flows-list';
}

const SPECS: Record<MakerPageMatch['kind'], ButtonSpec> = {
    flow: { id: 'edit-json', label: 'Edit JSON', title: 'Open this flow in the Power Automate Toolkit JSON editor', icon: CODE_ICON, message: 'open-flow-editor' },
    flowsList: { id: 'flows-list', label: 'Toolkit flows list', title: 'Open this environment\'s flows in the Power Automate Toolkit', icon: LIST_ICON, message: 'open-flows-list' },
};

export interface DesignerButtonOptions {
    doc?: Document;
    win?: Window;
    sendMessage: (message: { type: string }) => Promise<any>;
    /** Delay before the floating fallback appears when no toolbar is found. */
    fallbackDelayMs?: number;
    now?: () => number;
    /** URL polling interval for SPA navigation the observer cannot see (0 = off). */
    pollIntervalMs?: number;
}

export class DesignerButtonController {
    private doc: Document;
    private win: Window;
    private enabled = false;
    private observer?: MutationObserver;
    private rafHandle: number | null = null;
    private fallbackTimer: any = null;
    private pollTimer: any = null;
    private lastHref = '';
    private matchSince = 0;
    private readonly fallbackDelayMs: number;
    private readonly now: () => number;
    private readonly pollIntervalMs: number;
    private onNavigate = () => this.schedule();

    constructor(private options: DesignerButtonOptions) {
        this.doc = options.doc || document;
        this.win = options.win || window;
        this.fallbackDelayMs = options.fallbackDelayMs ?? 4000;
        this.now = options.now || (() => Date.now());
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    }

    setEnabled(enabled: boolean) {
        if (enabled === this.enabled) return;
        this.enabled = enabled;
        if (enabled) {
            this.start();
        } else {
            this.stop();
        }
    }

    private start() {
        const MO = (this.win as any).MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);
        if (MO && this.doc.documentElement) {
            this.observer = new MO(() => this.schedule());
            this.observer!.observe(this.doc.documentElement, { childList: true, subtree: true });
        }
        this.win.addEventListener('popstate', this.onNavigate);
        this.win.addEventListener('hashchange', this.onNavigate);
        // Navigation API sees history.pushState from the page's main world too.
        const nav = (this.win as any).navigation;
        nav?.addEventListener?.('currententrychange', this.onNavigate);
        if (this.pollIntervalMs > 0) {
            this.pollTimer = this.win.setInterval(() => {
                if (this.win.location.href !== this.lastHref) this.schedule();
            }, this.pollIntervalMs);
        }
        this.reconcile();
    }

    private stop() {
        this.observer?.disconnect();
        this.observer = undefined;
        this.win.removeEventListener('popstate', this.onNavigate);
        this.win.removeEventListener('hashchange', this.onNavigate);
        (this.win as any).navigation?.removeEventListener?.('currententrychange', this.onNavigate);
        if (this.pollTimer) this.win.clearInterval(this.pollTimer);
        this.pollTimer = null;
        if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
        if (this.rafHandle !== null) (this.win.cancelAnimationFrame || clearTimeout)(this.rafHandle);
        this.rafHandle = null;
        this.removeAll();
    }

    /** Coalesce bursts of mutations into one reconcile per animation frame. */
    schedule() {
        if (!this.enabled || this.rafHandle !== null) return;
        const raf = this.win.requestAnimationFrame?.bind(this.win) || ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as any);
        this.rafHandle = raf(() => {
            this.rafHandle = null;
            this.reconcile();
        });
    }

    private removeAll(except?: Element) {
        this.doc.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((el) => {
            if (el !== except) el.remove();
        });
    }

    /** Make the DOM match the current URL: zero or one button, in the right place. */
    reconcile() {
        if (!this.enabled) {
            this.removeAll();
            return;
        }
        const href = this.win.location.href;
        if (href !== this.lastHref) {
            this.lastHref = href;
            this.matchSince = this.now();
            // A different page: drop the old button so its label/target never go stale
            this.removeAll();
        }

        const match = parseMakerPageUrl(href);
        if (!match) {
            this.removeAll();
            return;
        }
        const spec = SPECS[match.kind];
        const toolbarMatch = findToolbar(this.doc, match.kind);
        const existing = Array.from(this.doc.querySelectorAll(`[${BUTTON_ATTR}]`));

        if (toolbarMatch) {
            const inPlace = existing.find((el) =>
                el.getAttribute(BUTTON_ATTR) === spec.id &&
                el.getAttribute('data-placement') === 'toolbar' &&
                toolbarMatch.toolbar.contains(el));
            if (inPlace) {
                this.removeAll(inPlace);
                return;
            }
            this.removeAll();
            this.insertIntoToolbar(toolbarMatch, spec);
            return;
        }

        const floating = existing.find((el) => el.getAttribute(BUTTON_ATTR) === spec.id && el.getAttribute('data-placement') === 'floating');
        if (floating) {
            this.removeAll(floating);
            return;
        }
        this.removeAll();
        const waited = this.now() - this.matchSince;
        if (waited >= this.fallbackDelayMs) {
            this.insertFloating(spec);
        } else if (!this.fallbackTimer) {
            this.fallbackTimer = setTimeout(() => {
                this.fallbackTimer = null;
                this.schedule();
            }, this.fallbackDelayMs - waited + 10);
        }
    }

    private createButton(spec: ButtonSpec, placement: 'toolbar' | 'floating', inMenubar: boolean): HTMLElement {
        ensureStyle(this.doc);
        const wrapper = this.doc.createElement('span');
        wrapper.setAttribute(BUTTON_ATTR, spec.id);
        wrapper.setAttribute('data-placement', placement);
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `${spec.label} (Power Automate Toolkit)`);
        button.title = spec.title;
        if (inMenubar) button.setAttribute('role', 'menuitem');
        button.innerHTML = `${spec.icon}<span>${spec.label}</span>`;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.activate(button, spec);
        });
        // Host command bars sometimes swallow Enter/Space via roving focus handlers.
        button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                this.activate(button, spec);
            }
        });
        wrapper.appendChild(button);
        return wrapper;
    }

    private activate(button: HTMLElement, spec: ButtonSpec) {
        if (button.getAttribute('aria-busy') === 'true') return;
        button.setAttribute('aria-busy', 'true');
        Promise.resolve()
            .then(() => this.options.sendMessage({ type: spec.message }))
            .catch(() => undefined)
            .finally(() => button.removeAttribute('aria-busy'));
    }

    private insertIntoToolbar(match: ToolbarMatch, spec: ButtonSpec) {
        const toolbar = match.toolbar;
        const inMenubar = toolbar.getAttribute('role') === 'menubar';
        const el = this.createButton(spec, 'toolbar', inMenubar);
        // Insert after the top-level item (direct child of the command bar's
        // item list) that holds the anchor control, so we sit next to Save/Publish.
        if (match.anchor && toolbar.contains(match.anchor)) {
            let item: Element = match.anchor;
            while (item.parentElement && item.parentElement !== toolbar && item.parentElement.children.length <= 1) {
                item = item.parentElement;
            }
            if (item.parentElement) {
                item.parentElement.insertBefore(el, item.nextSibling);
                return;
            }
        }
        toolbar.appendChild(el);
    }

    private insertFloating(spec: ButtonSpec) {
        const el = this.createButton(spec, 'floating', false);
        (this.doc.body || this.doc.documentElement).appendChild(el);
    }
}

/** Settings stored under chrome.storage.local `appSettings`. */
export interface PlatformSettings {
    extensionEnabled: boolean;
    showDesignerButton: boolean;
}

export function readPlatformSettings(appSettings: any): PlatformSettings {
    return {
        extensionEnabled: appSettings?.extensionEnabled !== false,
        showDesignerButton: appSettings?.showDesignerButton !== false,
    };
}

/**
 * Content-script entry point. Call once, top frame, maker hosts only.
 */
export function startDesignerButton(): DesignerButtonController {
    const controller = new DesignerButtonController({
        sendMessage: (message) => new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        // Extension reloaded/updated: this content script is orphaned
                        if (/context invalidated/i.test(chrome.runtime.lastError.message || '')) controller.setEnabled(false);
                        resolve(undefined);
                        return;
                    }
                    resolve(response);
                });
            } catch {
                controller.setEnabled(false);
                resolve(undefined);
            }
        }),
    });

    const apply = (appSettings: any) => {
        const s = readPlatformSettings(appSettings);
        controller.setEnabled(s.extensionEnabled && s.showDesignerButton);
    };

    try {
        chrome.storage.local.get('appSettings', (result) => apply(result?.appSettings));
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.appSettings) apply(changes.appSettings.newValue);
        });
    } catch {
        apply(undefined);
    }
    return controller;
}
