import { classifyApiUrl } from '../../chrome/hosts';
import {
    AudienceTokens,
    buildTokenFields,
    decodeTokenExpiry,
    migrateLegacyState,
    selectPrimary,
    summarizeTokens,
    upsertAudienceToken,
} from '../../chrome/tokenStore';

const NOW = 1_700_000_000_000;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (expMs: number, aud = 'x') => `Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${b64({ exp: Math.floor(expMs / 1000), aud })}.sig`;
const HOUR = 3600_000;

const FLOW = classifyApiUrl('https://unitedstates.api.flow.microsoft.com/providers/x')!;
const FLOW_GLOBAL = classifyApiUrl('https://api.flow.microsoft.com/providers/x')!;
const PP_ENV = classifyApiUrl('https://abc.environment.api.powerplatform.com/powerautomate/flows')!;
const PP_TENANT = classifyApiUrl('https://api.powerplatform.com/powerautomate/x')!;
const DV = classifyApiUrl('https://contoso.crm.dynamics.com/api/data/v9.2/workflows')!;
const DV2 = classifyApiUrl('https://fabrikam.crm4.dynamics.com/api/data/v9.2/workflows')!;
const PA = classifyApiUrl('https://unitedstates.api.powerapps.com/providers/x')!;

describe('decodeTokenExpiry', () => {
    test('reads exp with or without Bearer prefix', () => {
        const t = jwt(NOW + HOUR);
        expect(decodeTokenExpiry(t)).toBe(Math.floor((NOW + HOUR) / 1000) * 1000);
        expect(decodeTokenExpiry(t.replace('Bearer ', ''))).toBe(Math.floor((NOW + HOUR) / 1000) * 1000);
    });
    test('returns undefined for garbage', () => {
        expect(decodeTokenExpiry('Bearer nope')).toBeUndefined();
    });
});

describe('upsertAudienceToken', () => {
    test('keeps one entry per audience and never clears another audience', () => {
        const tokens: AudienceTokens = {};
        const flowToken = jwt(NOW + HOUR, 'flow');
        const dvToken = jwt(NOW + HOUR, 'dv');
        expect(upsertAudienceToken(tokens, FLOW, flowToken, NOW)).toEqual({ changed: true, tokenChanged: true });
        expect(upsertAudienceToken(tokens, DV, dvToken, NOW).changed).toBe(true);
        expect(upsertAudienceToken(tokens, PP_ENV, jwt(NOW + HOUR, 'pp'), NOW).changed).toBe(true);

        expect(tokens.flow?.token).toBe(flowToken);
        expect(tokens.dataverse?.token).toBe(dvToken);
        expect(tokens.dataverse?.baseUrl).toBe('https://contoso.crm.dynamics.com/api/data/v9.2/');
        expect(tokens.powerPlatform?.host).toBe('abc.environment.api.powerplatform.com');
    });

    test('same token again is a no-op (no broadcast churn)', () => {
        const tokens: AudienceTokens = {};
        const t = jwt(NOW + HOUR);
        upsertAudienceToken(tokens, FLOW, t, NOW);
        expect(upsertAudienceToken(tokens, FLOW, t, NOW)).toEqual({ changed: false, tokenChanged: false });
    });

    test('does not downgrade env-scoped Power Platform to tenant-scoped while valid', () => {
        const tokens: AudienceTokens = {};
        upsertAudienceToken(tokens, PP_ENV, jwt(NOW + HOUR, 'a'), NOW);
        expect(upsertAudienceToken(tokens, PP_TENANT, jwt(NOW + HOUR, 'b'), NOW).changed).toBe(false);
        expect(tokens.powerPlatform?.host).toBe('abc.environment.api.powerplatform.com');
        // …but does once the env-scoped token has expired
        expect(upsertAudienceToken(tokens, PP_TENANT, jwt(NOW + 3 * HOUR, 'b'), NOW + 2 * HOUR).changed).toBe(true);
        expect(tokens.powerPlatform?.host).toBe('api.powerplatform.com');
    });

    test('equal rank hosts replace each other (Dataverse org switch)', () => {
        const tokens: AudienceTokens = {};
        upsertAudienceToken(tokens, DV, jwt(NOW + HOUR, 'a'), NOW);
        upsertAudienceToken(tokens, DV2, jwt(NOW + HOUR, 'b'), NOW);
        expect(tokens.dataverse?.host).toBe('fabrikam.crm4.dynamics.com');
        upsertAudienceToken(tokens, FLOW_GLOBAL, jwt(NOW + HOUR, 'c'), NOW);
        upsertAudienceToken(tokens, FLOW, jwt(NOW + HOUR, 'd'), NOW);
        expect(tokens.flow?.host).toBe('unitedstates.api.flow.microsoft.com');
    });

    test('ignores already-expired and undecodable tokens', () => {
        const tokens: AudienceTokens = {};
        expect(upsertAudienceToken(tokens, FLOW, jwt(NOW - 1000), NOW).changed).toBe(false);
        expect(upsertAudienceToken(tokens, FLOW, 'Bearer opaque', NOW).changed).toBe(false);
        expect(tokens.flow).toBeUndefined();
    });
});

describe('selectPrimary / buildTokenFields', () => {
    test('prefers env-scoped Power Platform, then Flow, then tenant PP, then Power Apps', () => {
        const tokens: AudienceTokens = {};
        upsertAudienceToken(tokens, PA, jwt(NOW + HOUR, 'pa'), NOW);
        expect(selectPrimary(tokens, NOW)?.audience).toBe('powerApps');
        upsertAudienceToken(tokens, PP_TENANT, jwt(NOW + HOUR, 'ppt'), NOW);
        expect(selectPrimary(tokens, NOW)?.audience).toBe('powerPlatform');
        upsertAudienceToken(tokens, FLOW, jwt(NOW + HOUR, 'f'), NOW);
        expect(selectPrimary(tokens, NOW)?.audience).toBe('flow');
        upsertAudienceToken(tokens, PP_ENV, jwt(NOW + HOUR, 'ppe'), NOW);
        expect(selectPrimary(tokens, NOW)?.baseUrl).toBe('https://abc.environment.api.powerplatform.com/');
    });

    test('Dataverse alone never becomes the primary pair', () => {
        const tokens: AudienceTokens = {};
        upsertAudienceToken(tokens, DV, jwt(NOW + HOUR), NOW);
        expect(selectPrimary(tokens, NOW)).toBeUndefined();
        expect(buildTokenFields(tokens, NOW).token).toBeUndefined();
        expect(buildTokenFields(tokens, NOW).dataverseApiUrl).toBe('https://contoso.crm.dynamics.com/api/data/v9.2/');
    });

    test('token-changed fields: legacy, Power Platform and Dataverse pairs; expired ones omitted', () => {
        const tokens: AudienceTokens = {};
        const f = jwt(NOW + HOUR, 'f');
        const d = jwt(NOW + 10 * 60_000, 'd'); // valid for 10 min
        upsertAudienceToken(tokens, FLOW, f, NOW);
        upsertAudienceToken(tokens, DV, d, NOW);
        const fields = buildTokenFields(tokens, NOW);
        expect(fields).toEqual(expect.objectContaining({
            token: f,
            apiUrl: 'https://unitedstates.api.flow.microsoft.com/',
            legacyApiUrl: 'https://unitedstates.api.flow.microsoft.com/',
            legacyToken: f,
            dataverseApiUrl: 'https://contoso.crm.dynamics.com/api/data/v9.2/',
            dataverseToken: d,
        }));
        expect(fields.powerPlatformToken).toBeUndefined();
        expect(fields.expiresAt?.flow).toBeGreaterThan(NOW);

        // 6 minutes later the Dataverse token is inside the 5 minute buffer
        const later = buildTokenFields(tokens, NOW + 6 * 60_000);
        expect(later.dataverseToken).toBeUndefined();
        expect(later.legacyToken).toBe(f);
    });

    test('summarizeTokens contains no token material', () => {
        const tokens: AudienceTokens = {};
        const t = jwt(NOW + HOUR);
        upsertAudienceToken(tokens, FLOW, t, NOW);
        const summary = JSON.stringify(summarizeTokens(tokens, NOW));
        expect(summary).not.toContain(t.split(' ')[1].slice(0, 20));
        expect(summary).toContain('unitedstates.api.flow.microsoft.com');
    });
});

describe('migrateLegacyState', () => {
    test('maps the old single apiUrl/token onto its audience', () => {
        const t = jwt(NOW + HOUR);
        const tokens = migrateLegacyState('https://api.flow.microsoft.com/', t, NOW + HOUR);
        expect(tokens.flow).toEqual(expect.objectContaining({ token: t, baseUrl: 'https://api.flow.microsoft.com/', exp: NOW + HOUR }));
        expect(migrateLegacyState(undefined, t)).toEqual({});
    });
});
