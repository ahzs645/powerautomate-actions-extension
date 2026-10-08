/**
 * Host classification for Power Automate maker portals and the APIs they call,
 * across commercial and US Government clouds (GCC, GCC High, DoD).
 *
 * Kept free of chrome.* so it can be shared by the background worker, the
 * content script and unit tests.
 *
 * Government host names follow Microsoft's published US Government endpoint
 * lists. The commercial hosts are exercised daily; the GCC High / DoD entries
 * have NOT been verified against a live tenant.
 */

import type { TokenAudience } from '../services/interfaces/IFlowEditorActions';
export type { TokenAudience };

export const GUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Power Automate / Power Apps maker portals (the pages a user designs flows in).
 *   commercial: make.powerautomate.com, make.powerapps.com (+ preview), legacy *.flow.microsoft.com
 *   GCC:        make.gov.powerautomate.us, make.gov.powerapps.us, gov.flow.microsoft.us
 *   GCC High:   make.high.powerautomate.us, make.high.powerapps.us, high.flow.microsoft.us
 *   DoD:        make.powerautomate.appsplatform.us, make.apps.appsplatform.us, flow.appsplatform.us
 */
const MAKER_HOST_PATTERNS: RegExp[] = [
    /^(make|flow)\.(preview\.)?(powerautomate|powerapps)\.com$/i,
    /^([a-z0-9-]+\.)?flow\.microsoft\.com$/i,
    /^make\.(gov|high)\.(powerautomate|powerapps)\.us$/i,
    /^(gov|high)\.flow\.microsoft\.us$/i,
    /^make\.powerautomate\.appsplatform\.us$/i,
    /^make\.apps\.appsplatform\.us$/i,
    /^flow\.appsplatform\.us$/i,
];

export function isMakerHost(hostname: string | undefined | null): boolean {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    // API hosts share the *.flow.microsoft.com suffix but are never maker pages
    if (/(^|\.)api\./.test(host)) return false;
    return MAKER_HOST_PATTERNS.some((p) => p.test(host));
}

export function isMakerOrigin(origin: string | undefined | null): boolean {
    if (!origin) return false;
    try {
        const url = new URL(origin);
        return url.protocol === 'https:' && isMakerHost(url.hostname);
    } catch {
        return false;
    }
}

export function isMakerUrl(url: string | undefined | null): boolean {
    return isMakerOrigin(url);
}

/** Flow (ProcessSimple) API — the "legacy" flow management endpoint. */
const FLOW_API_PATTERNS: RegExp[] = [
    /^([a-z0-9-]+\.)*api\.flow\.microsoft\.com$/i,       // commercial + regional
    /^([a-z0-9-]+\.)*api\.flow\.microsoft\.us$/i,        // gov.api / high.api (GCC, GCC High)
    /^([a-z0-9-]+\.)*api\.flow\.appsplatform\.us$/i,     // DoD
];
const FLOW_API_ALT_PATTERNS: RegExp[] = [
    /^([a-z0-9-]+\.)*api\.powerautomate\.com$/i,
];
const POWER_APPS_API_PATTERNS: RegExp[] = [
    /^([a-z0-9-]+\.)*api\.powerapps\.com$/i,
    /^([a-z0-9-]+\.)*api\.powerapps\.us$/i,              // usgov / usgovhigh / dod / gov / high
    /^([a-z0-9-]+\.)*api\.apps\.appsplatform\.us$/i,     // DoD
];
/** Power Platform API (environment-scoped hosts serve /powerautomate/...). */
const POWER_PLATFORM_API_PATTERNS: RegExp[] = [
    /^([a-z0-9-]+\.)*api\.powerplatform\.com$/i,
    /^([a-z0-9-]+\.)*api\.(gov|high)\.powerplatform\.microsoft\.us$/i, // GCC / GCC High (unverified)
    /^([a-z0-9-]+\.)*api\.appsplatform\.us$/i,                        // DoD (unverified)
];
/**
 * Dataverse organisations.
 *   commercial: <org>.crm[N].dynamics.com (crm9 = GCC)
 *   GCC High:   <org>.crm.microsoftdynamics.us
 *   DoD:        <org>.crm.appsplatform.us
 */
const DATAVERSE_HOST_PATTERNS: RegExp[] = [
    /^[a-z0-9-]+\.(api\.)?crm\d*\.dynamics\.com$/i,
    /^[a-z0-9-]+\.(api\.)?crm\.microsoftdynamics\.us$/i,
    /^[a-z0-9-]+\.(api\.)?crm\.appsplatform\.us$/i,
];
const DATAVERSE_PATH = /^\/api\/data\/(v\d+\.\d+)\//i;

export function isDataverseHost(hostname: string): boolean {
    return DATAVERSE_HOST_PATTERNS.some((p) => p.test(hostname));
}

export interface ApiEndpoint {
    audience: TokenAudience;
    /** Root the editor should prefix relative paths with (always ends with '/'). */
    baseUrl: string;
    host: string;
    /** Within one audience, a higher rank wins over a lower one. */
    rank: number;
}

/**
 * Classify a request URL into the token audience it was issued for. Returns
 * null for anything that is not one of the APIs the toolkit talks to.
 */
export function classifyApiUrl(rawUrl: string): ApiEndpoint | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const origin = `${url.protocol}//${host}/`;

    if (FLOW_API_PATTERNS.some((p) => p.test(host))) {
        return { audience: 'flow', baseUrl: origin, host, rank: 2 };
    }
    if (FLOW_API_ALT_PATTERNS.some((p) => p.test(host))) {
        return { audience: 'flow', baseUrl: origin, host, rank: 1 };
    }
    if (POWER_PLATFORM_API_PATTERNS.some((p) => p.test(host))) {
        // Environment-scoped hosts (<env>.environment.api.powerplatform.com) are
        // what the flow APIs live on; tenant-scoped hosts are a fallback.
        const envScoped = host.includes('.environment.api.');
        return { audience: 'powerPlatform', baseUrl: origin, host, rank: envScoped ? 2 : 1 };
    }
    if (POWER_APPS_API_PATTERNS.some((p) => p.test(host))) {
        return { audience: 'powerApps', baseUrl: origin, host, rank: 1 };
    }
    if (isDataverseHost(host)) {
        const m = DATAVERSE_PATH.exec(url.pathname);
        if (!m) return null; // only the Web API, never Dynamics app pages/assets
        return { audience: 'dataverse', baseUrl: `${origin}api/data/${m[1].toLowerCase()}/`, host, rank: 1 };
    }
    return null;
}

export function isEnvironmentScopedPowerPlatformUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
        return new URL(url).hostname.toLowerCase().includes('.environment.api.');
    } catch {
        return false;
    }
}

/** `/api/data/v9.x/workflows(<guid>)` → the Dataverse workflow id. */
export function extractWorkflowEntityId(rawUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    if (!isDataverseHost(url.hostname)) return null;
    const re = new RegExp(`^/api/data/v\\d+\\.\\d+/workflows\\((?:workflowid=)?\\{?(${GUID_SOURCE})\\}?\\)`, 'i');
    const m = re.exec(decodeURIComponent(url.pathname));
    return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Maker page URL parsing (shared by the background worker and the content script)
// ---------------------------------------------------------------------------

const ENV_PATTERNS: RegExp[] = [
    // Trailing slash optional so the flows list URL (…/environments/{id}/flows)
    // and the bare …/environments/{id} both match.
    /\/environments\/([a-zA-Z0-9-]+)/i,
    /environment\/([a-zA-Z0-9-]+)/i,
    /\/environment=([a-zA-Z0-9-]+)/i,
    /envid=([a-zA-Z0-9-]+)/i,
    /[?&]environmentId=([a-zA-Z0-9-]+)/i,
    /[?&]env=([a-zA-Z0-9-]+)/i,
    /environments%2F([a-zA-Z0-9-]+)/i,
];

export function extractEnvIdFromTabUrl(url?: string): string | null {
    if (!url) return null;
    for (const pattern of ENV_PATTERNS) {
        const result = pattern.exec(url);
        if (result) return result[1];
    }
    return null;
}

const FLOW_PATTERNS: RegExp[] = [
    new RegExp(`flows\\/(${GUID_SOURCE})`, 'i'),
    new RegExp(`flows\\/shared\\/(${GUID_SOURCE})`, 'i'),
    /flows\/([0-9a-f]{8}%2D[0-9a-f]{4}%2D[0-9a-f]{4}%2D[0-9a-f]{4}%2D[0-9a-f]{12})/i,
    new RegExp(`flow\\/(${GUID_SOURCE})`, 'i'),
    new RegExp(`flowid=(${GUID_SOURCE})`, 'i'),
    new RegExp(`[?&]flowId=(${GUID_SOURCE})`, 'i'),
    new RegExp(`[?&]id=(${GUID_SOURCE})`, 'i'),
    new RegExp(`#.*flows\\/(${GUID_SOURCE})`, 'i'),
];

export function extractFlowDataFromTabUrl(url?: string): { envId: string; flowId: string } | null {
    if (!url) return null;
    const envId = extractEnvIdFromTabUrl(url);
    if (!envId) return null;
    for (const pattern of FLOW_PATTERNS) {
        const result = pattern.exec(url);
        if (result) {
            return { envId, flowId: decodeURIComponent(result[1]) };
        }
    }
    return null;
}

export function extractFlowDataFromApiUrl(url: string): { envId: string; flowId: string } | null {
    const patterns = [
        new RegExp(`\\/providers\\/Microsoft\\.ProcessSimple\\/environments\\/([^/?#]+)\\/flows\\/(${GUID_SOURCE})`, 'i'),
        new RegExp(`\\/environments\\/([^/?#]+)\\/flows\\/(${GUID_SOURCE})`, 'i'),
    ];
    for (const pattern of patterns) {
        const result = pattern.exec(url);
        if (result) {
            return { envId: result[1], flowId: result[2] };
        }
    }
    return null;
}

/**
 * Match patterns for chrome.webRequest token capture. Kept in sync with the
 * manifest host_permissions (webRequest only sees hosts it has permission for).
 */
export const API_REQUEST_URL_PATTERNS: string[] = [
    'https://*.api.flow.microsoft.com/*',
    'https://*.api.powerautomate.com/*',
    'https://*.api.powerapps.com/*',
    'https://*.api.powerplatform.com/*',
    'https://*.dynamics.com/*',
    // US Government (GCC / GCC High / DoD)
    'https://*.api.flow.microsoft.us/*',
    'https://*.api.powerapps.us/*',
    'https://*.powerplatform.microsoft.us/*',
    'https://*.microsoftdynamics.us/*',
    'https://*.appsplatform.us/*',
];
