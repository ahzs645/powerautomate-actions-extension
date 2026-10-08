/**
 * Per-tab diagnostics ring buffer for "Copy diagnostics".
 *
 * Records what happened (API calls, token capture, editor opens) without ever
 * recording secrets: no tokens, no request/response bodies, no query strings
 * and no full URLs — only the host. Everything passes through
 * `sanitizeDiagnosticEvent`, including events reported by extension pages.
 *
 * Stored in chrome.storage.session (memory-backed, cleared when the browser
 * closes, not readable by content scripts at TRUSTED_CONTEXTS access level).
 */

export const DIAGNOSTICS_STORAGE_KEY = 'pa_toolkit_diagnostics';
export const DIAGNOSTICS_MAX_EVENTS = 50;

export interface DiagnosticRequestIds {
    serviceRequestId?: string;
    correlationRequestId?: string;
    clientRequestId?: string;
}

export interface DiagnosticEvent {
    /** epoch ms */
    t: number;
    /** e.g. api, token, open-editor, open-flows-list, error, settings */
    kind: string;
    host?: string;
    method?: string;
    status?: number;
    audience?: string;
    durationMs?: number;
    requestIds?: DiagnosticRequestIds;
    flags?: Record<string, boolean>;
    /** Short, scrubbed free text (error code/message). */
    detail?: string;
}

export interface DiagnosticsStorageArea {
    get(key: string): Promise<Record<string, any>>;
    set(items: Record<string, any>): Promise<void>;
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /bearer\s+[^\s"',]+/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const SAFE_TOKEN_RE = /^[A-Za-z0-9._:-]{1,80}$/;

/** Remove anything that could be a credential or a full URL from free text. */
export function scrubText(text: unknown, maxLength = 200): string | undefined {
    if (text === undefined || text === null) return undefined;
    let s = String(text);
    s = s.replace(JWT_RE, '[redacted-jwt]');
    s = s.replace(BEARER_RE, 'Bearer [redacted]');
    s = s.replace(URL_RE, (u) => {
        const host = hostOf(u);
        return host ? `https://${host}/…` : '[url]';
    });
    s = s.replace(/[\r\n\t]+/g, ' ').trim();
    if (s.length > maxLength) s = s.slice(0, maxLength - 1) + '…';
    return s || undefined;
}

export function hostOf(url: unknown): string | undefined {
    if (typeof url !== 'string' || !url) return undefined;
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        // Accept a bare host name
        return /^[a-z0-9.-]+$/i.test(url) ? url.toLowerCase() : undefined;
    }
}

function safeId(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const v = value.trim();
    return SAFE_TOKEN_RE.test(v) ? v : undefined;
}

/**
 * Whitelist-copy an event. Unknown fields are dropped; `url` is reduced to its
 * host; flags must be booleans.
 */
export function sanitizeDiagnosticEvent(raw: any, now = Date.now()): DiagnosticEvent | null {
    if (!raw || typeof raw !== 'object') return null;
    const kind = typeof raw.kind === 'string' && /^[a-z0-9-]{1,32}$/i.test(raw.kind) ? raw.kind : null;
    if (!kind) return null;

    const event: DiagnosticEvent = { t: typeof raw.t === 'number' && isFinite(raw.t) ? raw.t : now, kind };
    const host = hostOf(raw.host) || hostOf(raw.url);
    if (host) event.host = host;
    if (typeof raw.method === 'string' && /^[A-Z]{3,7}$/.test(raw.method)) event.method = raw.method;
    if (typeof raw.status === 'number' && isFinite(raw.status)) event.status = Math.trunc(raw.status);
    if (typeof raw.audience === 'string' && /^[a-z]{1,20}$/i.test(raw.audience)) event.audience = raw.audience;
    if (typeof raw.durationMs === 'number' && isFinite(raw.durationMs)) event.durationMs = Math.max(0, Math.round(raw.durationMs));

    if (raw.requestIds && typeof raw.requestIds === 'object') {
        const ids: DiagnosticRequestIds = {};
        const s = safeId(raw.requestIds.serviceRequestId);
        const c = safeId(raw.requestIds.correlationRequestId);
        const cl = safeId(raw.requestIds.clientRequestId);
        if (s) ids.serviceRequestId = s;
        if (c) ids.correlationRequestId = c;
        if (cl) ids.clientRequestId = cl;
        if (Object.keys(ids).length) event.requestIds = ids;
    }
    if (raw.flags && typeof raw.flags === 'object') {
        const flags: Record<string, boolean> = {};
        Object.keys(raw.flags).slice(0, 12).forEach((k) => {
            if (/^[a-z][a-z0-9]{0,31}$/i.test(k) && typeof raw.flags[k] === 'boolean') flags[k] = raw.flags[k];
        });
        if (Object.keys(flags).length) event.flags = flags;
    }
    const detail = scrubText(raw.detail);
    if (detail) event.detail = detail;
    return event;
}

/** Append to a ring buffer, keeping the newest `max` events. */
export function appendEvent(buffer: DiagnosticEvent[], event: DiagnosticEvent, max = DIAGNOSTICS_MAX_EVENTS): DiagnosticEvent[] {
    const next = buffer.concat(event);
    return next.length > max ? next.slice(next.length - max) : next;
}

export class DiagnosticsStore {
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private storage: DiagnosticsStorageArea, private key = DIAGNOSTICS_STORAGE_KEY, private max = DIAGNOSTICS_MAX_EVENTS) { }

    private async readAll(): Promise<Record<string, DiagnosticEvent[]>> {
        try {
            const result = await this.storage.get(this.key);
            const all = result?.[this.key];
            return all && typeof all === 'object' ? all : {};
        } catch {
            return {};
        }
    }

    /** Serialise writes so concurrent events never drop each other. */
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.queue.then(fn, fn);
        this.queue = run.catch(() => undefined);
        return run;
    }

    record(tabId: number, raw: any): Promise<void> {
        const event = sanitizeDiagnosticEvent(raw);
        if (!event || !Number.isInteger(tabId)) return Promise.resolve();
        return this.enqueue(async () => {
            const all = await this.readAll();
            all[String(tabId)] = appendEvent(all[String(tabId)] || [], event, this.max);
            try {
                await this.storage.set({ [this.key]: all });
            } catch {
                // session storage unavailable — diagnostics are best effort
            }
        });
    }

    get(tabId: number): Promise<DiagnosticEvent[]> {
        return this.enqueue(async () => (await this.readAll())[String(tabId)] || []);
    }

    removeTab(tabId: number): Promise<void> {
        return this.enqueue(async () => {
            const all = await this.readAll();
            if (!(String(tabId) in all)) return;
            delete all[String(tabId)];
            try {
                await this.storage.set({ [this.key]: all });
            } catch { /* ignore */ }
        });
    }

    clearAll(): Promise<void> {
        return this.enqueue(async () => {
            try {
                await this.storage.set({ [this.key]: {} });
            } catch { /* ignore */ }
        });
    }
}

export interface DiagnosticsContext {
    extensionVersion?: string;
    userAgent?: string;
    extensionEnabled?: boolean;
    envId?: string;
    flowId?: string;
    hasWorkflowEntityId?: boolean;
    editorTabs?: number;
    tokens?: Record<string, { host: string; hasToken: boolean; expired: boolean; expiresInMin?: number }>;
}

function fmtIds(ids?: DiagnosticRequestIds): string {
    if (!ids) return '';
    const parts: string[] = [];
    if (ids.serviceRequestId) parts.push(`svc=${ids.serviceRequestId}`);
    if (ids.correlationRequestId) parts.push(`corr=${ids.correlationRequestId}`);
    if (ids.clientRequestId) parts.push(`client=${ids.clientRequestId}`);
    return parts.join(' ');
}

/** Plain-text blob for the clipboard. Contains no tokens, bodies or query strings. */
export function formatDiagnostics(events: DiagnosticEvent[], context: DiagnosticsContext = {}, now = Date.now()): string {
    const lines: string[] = [];
    lines.push('Power Automate Toolkit diagnostics');
    lines.push(`Generated: ${new Date(now).toISOString()}`);
    if (context.extensionVersion) lines.push(`Extension version: ${context.extensionVersion}`);
    if (context.userAgent) lines.push(`Browser: ${scrubText(context.userAgent, 300)}`);
    if (context.extensionEnabled !== undefined) lines.push(`Extension enabled: ${context.extensionEnabled}`);
    if (context.envId) lines.push(`Environment: ${scrubText(context.envId, 80)}`);
    if (context.flowId) lines.push(`Flow: ${scrubText(context.flowId, 80)}`);
    if (context.hasWorkflowEntityId !== undefined) lines.push(`Dataverse workflow id known: ${context.hasWorkflowEntityId}`);
    if (context.editorTabs !== undefined) lines.push(`Open editor tabs: ${context.editorTabs}`);
    lines.push('');
    lines.push('Tokens (presence only):');
    const tokenKeys = Object.keys(context.tokens || {});
    if (tokenKeys.length === 0) {
        lines.push('  none captured');
    } else {
        tokenKeys.forEach((a) => {
            const t = context.tokens![a];
            const exp = t.expiresInMin === undefined ? 'unknown expiry' : t.expired ? `expired ${-t.expiresInMin} min ago` : `expires in ${t.expiresInMin} min`;
            lines.push(`  ${a}: host=${t.host} hasToken=${t.hasToken} ${exp}`);
        });
    }
    lines.push('');
    lines.push(`Recent events (${events.length}, newest last):`);
    if (events.length === 0) lines.push('  none');
    events.forEach((e) => {
        const parts = [new Date(e.t).toISOString(), e.kind];
        if (e.audience) parts.push(`[${e.audience}]`);
        if (e.method) parts.push(e.method);
        if (e.host) parts.push(e.host);
        if (e.status !== undefined) parts.push(`-> ${e.status}`);
        if (e.durationMs !== undefined) parts.push(`${e.durationMs}ms`);
        const ids = fmtIds(e.requestIds);
        if (ids) parts.push(ids);
        if (e.flags) parts.push(Object.keys(e.flags).map((k) => `${k}=${e.flags![k]}`).join(','));
        if (e.detail) parts.push(`"${e.detail}"`);
        lines.push('  ' + parts.join(' '));
    });
    return lines.join('\n');
}
