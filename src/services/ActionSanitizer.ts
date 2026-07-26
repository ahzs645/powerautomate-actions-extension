// ActionSanitizer - strips tenant-identifying data out of Power Automate action JSON.
//
// Copied and exported actions carry more than the operation definition. The
// designer stores a drive-item-id -> filename map under `metadata`, connection
// GUIDs under `host.connection`, and any function key sits in plain sight in the
// URI query string. Sharing a favorites export or committing a preset pack
// therefore leaks a document inventory and live credentials unless it is scrubbed
// first.

import { IActionModel } from '../models';

export interface ISanitizeReport {
    /** Number of metadata entries removed (drive item id -> filename maps). */
    metadataKeysRemoved: number;
    /** Number of secrets redacted from URIs (?code=, ?sig=, SAS tokens). */
    secretsRedacted: number;
    /** Number of email addresses redacted. */
    emailsRedacted: number;
    /** Number of connection identifiers removed. */
    connectionsRemoved: number;
    /** Number of tenant identifiers redacted (drive item ids, tenant hostnames). */
    tenantIdsRedacted: number;
}

export interface ISanitizeResult<T> {
    value: T;
    report: ISanitizeReport;
}

/** Metadata keys that are safe to keep; everything else in `metadata` is tenant data. */
const SAFE_METADATA_KEYS = new Set(['operationMetadataId']);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Azure Function keys, SAS signatures and shared access tokens in query strings.
 *
 * The negative lookaheads keep `{{functionKey}}` placeholders and
 * `@{parameters('...')}` references intact: neither is a secret, and redacting
 * them would break token substitution on a generated preset.
 */
const SECRET_QUERY_PATTERN = /([?&](?:code|sig|sv|se|st|skoid|signature|access_token)=)(?!\{\{)(?!@)[^&#\s"']+/gi;

/**
 * Tenant identifiers that appear in connector `inputs.parameters`, not only in
 * `metadata`: OneDrive/SharePoint drive ids ("b!..."), drive item ids
 * ("01JWBUU4..."), and the tenant's own SharePoint hostname.
 */
const TENANT_ID_PATTERNS: RegExp[] = [
    /\bb![A-Za-z0-9_-]{20,}(?:\.[A-Z0-9]{20,})*/g,
    /\b01[A-Z0-9]{24,}\b/g,
    /https:\/\/[a-z0-9-]+\.sharepoint\.com/gi,
];

const REDACTED_EMAIL = 'user@example.com';
const REDACTED_SECRET = 'REDACTED';
const REDACTED_TENANT_ID = '{{tenantResourceId}}';
const REDACTED_SHAREPOINT_HOST = 'https://contoso.sharepoint.com';

function emptyReport(): ISanitizeReport {
    return {
        metadataKeysRemoved: 0,
        secretsRedacted: 0,
        emailsRedacted: 0,
        connectionsRemoved: 0,
        tenantIdsRedacted: 0,
    };
}

function mergeReport(target: ISanitizeReport, source: ISanitizeReport): void {
    target.metadataKeysRemoved += source.metadataKeysRemoved;
    target.secretsRedacted += source.secretsRedacted;
    target.emailsRedacted += source.emailsRedacted;
    target.connectionsRemoved += source.connectionsRemoved;
    target.tenantIdsRedacted += source.tenantIdsRedacted;
}

export class ActionSanitizer {
    /**
     * Redact secrets and emails from a free-text string.
     * Returns the cleaned string plus counts of what was replaced.
     */
    public sanitizeString(input: string): ISanitizeResult<string> {
        const report = emptyReport();
        if (!input) { return { value: input, report }; }

        let value = input.replace(SECRET_QUERY_PATTERN, (_match, prefix) => {
            report.secretsRedacted++;
            return `${prefix}${REDACTED_SECRET}`;
        });

        value = value.replace(EMAIL_PATTERN, () => {
            report.emailsRedacted++;
            return REDACTED_EMAIL;
        });

        for (const pattern of TENANT_ID_PATTERNS) {
            value = value.replace(pattern, match => {
                report.tenantIdsRedacted++;
                return match.toLowerCase().startsWith('https://')
                    ? REDACTED_SHAREPOINT_HOST
                    : REDACTED_TENANT_ID;
            });
        }

        return { value, report };
    }

    /**
     * Recursively scrub a parsed action definition.
     *
     * - `metadata` objects keep only `operationMetadataId`.
     * - `host.connection` / `connectionName` GUID references are dropped.
     * - `authentication` blocks are dropped; they reference the source flow's trigger.
     * - Strings are run through {@link sanitizeString}.
     */
    public sanitizeDefinition<T>(definition: T): ISanitizeResult<T> {
        const report = emptyReport();
        const value = this.scrub(definition, report, false);
        return { value: value as T, report };
    }

    /**
     * Scrub a single action, rewriting its `actionJson` in place.
     * Actions whose JSON cannot be parsed are returned with only string-level
     * redaction applied, so a malformed action never silently keeps its secrets.
     */
    public sanitizeAction(action: IActionModel): ISanitizeResult<IActionModel> {
        const report = emptyReport();
        const sanitized: IActionModel = { ...action };

        const urlResult = this.sanitizeString(action.url || '');
        sanitized.url = urlResult.value;
        mergeReport(report, urlResult.report);

        let parsed: any;
        try {
            parsed = JSON.parse(action.actionJson);
        } catch {
            const fallback = this.sanitizeString(action.actionJson || '');
            sanitized.actionJson = fallback.value;
            mergeReport(report, fallback.report);
            return { value: sanitized, report };
        }

        const scrubbed = this.scrub(parsed, report, false);
        sanitized.actionJson = JSON.stringify(scrubbed, null, 2);

        return { value: sanitized, report };
    }

    /** Scrub a list of actions, returning a combined report. */
    public sanitizeActions(actions: IActionModel[]): ISanitizeResult<IActionModel[]> {
        const report = emptyReport();
        const value = (actions || []).map(action => {
            const result = this.sanitizeAction(action);
            mergeReport(report, result.report);
            return result.value;
        });
        return { value, report };
    }

    /** True when the action still contains something that looks like a secret. */
    public containsSecret(action: IActionModel): boolean {
        const haystack = `${action.url || ''} ${action.actionJson || ''}`;
        SECRET_QUERY_PATTERN.lastIndex = 0;
        return SECRET_QUERY_PATTERN.test(haystack);
    }

    /** Human-readable summary, or null when nothing was removed. */
    public describeReport(report: ISanitizeReport): string | null {
        const parts: string[] = [];
        if (report.metadataKeysRemoved > 0) { parts.push(`${report.metadataKeysRemoved} metadata entries`); }
        if (report.secretsRedacted > 0) { parts.push(`${report.secretsRedacted} secrets`); }
        if (report.emailsRedacted > 0) { parts.push(`${report.emailsRedacted} email addresses`); }
        if (report.connectionsRemoved > 0) { parts.push(`${report.connectionsRemoved} connection references`); }
        if (report.tenantIdsRedacted > 0) { parts.push(`${report.tenantIdsRedacted} tenant identifiers`); }
        return parts.length > 0 ? `Removed ${parts.join(', ')}` : null;
    }

    /**
     * @param insideMetadata true when the current node is the value of a `metadata`
     * key, in which case non-allowlisted properties are dropped rather than recursed.
     */
    private scrub(node: any, report: ISanitizeReport, insideMetadata: boolean): any {
        if (node === null || node === undefined) { return node; }

        if (typeof node === 'string') {
            const result = this.sanitizeString(node);
            mergeReport(report, result.report);
            return result.value;
        }

        if (typeof node !== 'object') { return node; }

        if (Array.isArray(node)) {
            return node.map(item => this.scrub(item, report, insideMetadata));
        }

        const output: Record<string, any> = {};
        for (const [key, value] of Object.entries(node)) {
            if (insideMetadata && !SAFE_METADATA_KEYS.has(key)) {
                // Drive item id -> filename maps live here.
                report.metadataKeysRemoved++;
                continue;
            }

            if (key === 'authentication') {
                // References the source flow's trigger; meaningless and noisy elsewhere.
                continue;
            }

            if (key === 'connection' || key === 'connectionReferenceName') {
                report.connectionsRemoved++;
                continue;
            }

            output[key] = this.scrub(value, report, key === 'metadata');
        }

        return output;
    }
}

export const actionSanitizer = new ActionSanitizer();
