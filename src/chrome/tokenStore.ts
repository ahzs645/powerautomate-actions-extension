/**
 * Per-audience token bookkeeping for one Power Automate tab.
 *
 * The maker portal talks to several APIs, each with its own AAD audience
 * (Flow, Power Platform, Dataverse, Power Apps). A token for one audience is
 * rejected by the others, so instead of a single apiUrl/token pair we keep one
 * entry per audience and never overwrite one audience's token with another's.
 *
 * Pure (no chrome.*) so it can be unit tested. Tokens only ever live in the
 * background worker's memory and chrome.storage.session.
 */
import jwtDecode from 'jwt-decode';
import { ApiEndpoint, TokenAudience, isEnvironmentScopedPowerPlatformUrl, classifyApiUrl } from './hosts';

export interface AudienceToken {
    baseUrl: string;
    /** The Authorization header value exactly as the portal sent it ("Bearer …"). */
    token: string;
    /** Expiry, epoch milliseconds (from the JWT `exp` claim). */
    exp?: number;
    host: string;
    rank: number;
}

export type AudienceTokens = Partial<Record<TokenAudience, AudienceToken>>;

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function decodeTokenExpiry(authHeader: string): number | undefined {
    const raw = authHeader.replace(/^bearer\s+/i, '').trim();
    try {
        const decoded = jwtDecode(raw) as { exp?: number };
        return typeof decoded?.exp === 'number' ? decoded.exp * 1000 : undefined;
    } catch {
        return undefined;
    }
}

export function isAudienceTokenExpired(entry: AudienceToken | undefined, now = Date.now(), bufferMs = TOKEN_EXPIRY_BUFFER_MS): boolean {
    if (!entry?.token || !entry.exp) return true;
    return now > entry.exp - bufferMs;
}

export interface UpsertResult {
    /** Anything stored changed (persist). */
    changed: boolean;
    /** The token or base URL for this audience changed (notify editors). */
    tokenChanged: boolean;
}

/**
 * Store a token observed on the wire. Within an audience a higher-ranked host
 * (e.g. environment-scoped Power Platform over tenant-scoped) is never
 * downgraded while it is still valid; equal-ranked hosts replace each other
 * (e.g. switching Dataverse org after an environment switch). Other audiences
 * are never touched — no more "clear the token because apiUrl changed" churn.
 */
export function upsertAudienceToken(
    tokens: AudienceTokens,
    endpoint: ApiEndpoint,
    authHeader: string,
    now = Date.now(),
): UpsertResult {
    const current = tokens[endpoint.audience];
    const exp = decodeTokenExpiry(authHeader);
    if (exp === undefined) {
        // Not a JWT we can reason about; ignore rather than store garbage.
        return { changed: false, tokenChanged: false };
    }
    if (exp <= now) {
        return { changed: false, tokenChanged: false };
    }

    if (current && !isAudienceTokenExpired(current, now) && endpoint.rank < current.rank) {
        return { changed: false, tokenChanged: false };
    }
    if (current && current.token === authHeader && current.baseUrl === endpoint.baseUrl) {
        return { changed: false, tokenChanged: false };
    }

    tokens[endpoint.audience] = {
        baseUrl: endpoint.baseUrl,
        token: authHeader,
        exp,
        host: endpoint.host,
        rank: endpoint.rank,
    };
    return { changed: true, tokenChanged: true };
}

/**
 * The single apiUrl/token pair older editor code expects. Same preference as
 * before: environment-scoped Power Platform > Flow API > tenant-scoped Power
 * Platform > Power Apps. Expired entries are only used if nothing valid exists.
 */
export function selectPrimary(tokens: AudienceTokens, now = Date.now()): (AudienceToken & { audience: TokenAudience }) | undefined {
    const order: Array<[TokenAudience, (e: AudienceToken) => boolean]> = [
        ['powerPlatform', (e) => isEnvironmentScopedPowerPlatformUrl(e.baseUrl)],
        ['flow', () => true],
        ['powerPlatform', () => true],
        ['powerApps', () => true],
    ];
    for (const requireValid of [true, false]) {
        for (const [audience, accept] of order) {
            const entry = tokens[audience];
            if (!entry || !accept(entry)) continue;
            if (requireValid && isAudienceTokenExpired(entry, now)) continue;
            return { ...entry, audience };
        }
    }
    return undefined;
}

/**
 * Rebuild audience entries from the pre-2.4 single apiUrl/token state that may
 * still sit in chrome.storage.session after an update.
 */
export function migrateLegacyState(apiUrl: string | undefined, token: string | undefined, tokenExpiresMs?: number): AudienceTokens {
    const tokens: AudienceTokens = {};
    if (!apiUrl || !token) return tokens;
    const endpoint = classifyApiUrl(apiUrl);
    if (!endpoint) return tokens;
    tokens[endpoint.audience] = {
        baseUrl: endpoint.baseUrl,
        token,
        exp: tokenExpiresMs ?? decodeTokenExpiry(token),
        host: endpoint.host,
        rank: endpoint.rank,
    };
    return tokens;
}

export interface TokenChangedFields {
    token?: string;
    apiUrl?: string;
    legacyApiUrl?: string;
    legacyToken?: string;
    powerPlatformApiUrl?: string;
    powerPlatformToken?: string;
    dataverseApiUrl?: string;
    dataverseToken?: string;
    expiresAt?: Partial<Record<TokenAudience, number>>;
}

/** Fields for the `token-changed` message (expired audiences are omitted). */
export function buildTokenFields(tokens: AudienceTokens, now = Date.now()): TokenChangedFields {
    const valid = (a: TokenAudience) => {
        const e = tokens[a];
        return e && !isAudienceTokenExpired(e, now) ? e : undefined;
    };
    const primary = selectPrimary(tokens, now);
    const fields: TokenChangedFields = {
        token: primary?.token,
        apiUrl: primary?.baseUrl,
        expiresAt: {},
    };
    const flow = valid('flow');
    if (flow) {
        fields.legacyApiUrl = flow.baseUrl;
        fields.legacyToken = flow.token;
    }
    const pp = valid('powerPlatform');
    if (pp) {
        fields.powerPlatformApiUrl = pp.baseUrl;
        fields.powerPlatformToken = pp.token;
    }
    const dv = valid('dataverse');
    if (dv) {
        fields.dataverseApiUrl = dv.baseUrl;
        fields.dataverseToken = dv.token;
    }
    (Object.keys(tokens) as TokenAudience[]).forEach((a) => {
        const e = tokens[a];
        if (e?.exp) fields.expiresAt![a] = e.exp;
    });
    return fields;
}

/** Non-secret summary used for diagnostics and change detection. */
export function summarizeTokens(tokens: AudienceTokens, now = Date.now()) {
    const out: Record<string, { host: string; hasToken: boolean; expired: boolean; expiresInMin?: number }> = {};
    (Object.keys(tokens) as TokenAudience[]).forEach((a) => {
        const e = tokens[a]!;
        out[a] = {
            host: e.host,
            hasToken: !!e.token,
            expired: isAudienceTokenExpired(e, now, 0),
            expiresInMin: e.exp ? Math.round((e.exp - now) / 60000) : undefined,
        };
    });
    return out;
}
