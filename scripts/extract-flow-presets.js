#!/usr/bin/env node
//
// Convert a Power Automate flow export into a predefined-actions pack.
//
//   node scripts/extract-flow-presets.js <export.zip|definition.json> [-o out.json]
//                                        [--scopes] [--category <name>] [--keep-secrets]
//
// A legacy flow export (.zip) contains Microsoft.Flow/flows/<id>/definition.json;
// a solution export contains Workflows/<name>.json. Both are accepted, as is a
// bare definition.json.
//
// Every action is scrubbed before it is written. The designer stores a
// drive-item-id -> filename map under each action's `metadata`, connection GUIDs
// under `host.connection`, and any function key sits in the URI query string, so
// an unscrubbed pack leaks a document inventory and live credentials. Pass
// --keep-secrets only for a pack that will never leave your machine.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SAFE_METADATA_KEYS = new Set(['operationMetadataId']);
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// The lookaheads keep {{functionKey}} placeholders and @{parameters('...')}
// references intact - neither is a secret, and redacting them would break
// token substitution on an already-generated preset.
const SECRET_QUERY_PATTERN = /([?&](?:code|sig|sv|se|st|skoid|signature|access_token)=)(?!\{\{)(?!@)[^&#\s"']+/gi;

// Azure Function App origins. Tokenizing only the ?code= key is not enough:
// a preset that keeps the source author's *.azurewebsites.net host would
// silently send users' documents to someone else's endpoint. The extension
// substitutes {{functionBaseUrl}} with the user's own Function App origin.
const FUNCTION_HOST_PATTERN = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.azurewebsites\.net/gi;

// Tenant identifiers appear in connector `inputs.parameters`, not only in
// `metadata`: drive ids ("b!..."), drive item ids ("01JWBUU4...") and the
// tenant's SharePoint hostname.
const TENANT_ID_PATTERNS = [
    /\bb![A-Za-z0-9_-]{20,}(?:\.[A-Z0-9]{20,})*/g,
    /\b01[A-Z0-9]{24,}\b/g,
    /https:\/\/[a-z0-9-]+\.sharepoint\.com/gi,
];

const HTTP_BRAND_COLOR = '#709727';

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const options = { input: null, output: null, scopes: false, category: null, keepSecrets: false, mergeCatalog: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-o' || arg === '--output') { options.output = argv[++i]; }
        else if (arg === '--scopes') { options.scopes = true; }
        else if (arg === '--category') { options.category = argv[++i]; }
        else if (arg === '--keep-secrets') { options.keepSecrets = true; }
        else if (arg === '--merge-catalog') { options.mergeCatalog = argv[++i]; }
        else if (arg === '-h' || arg === '--help') { options.help = true; }
        else if (!options.input) { options.input = arg; }
    }
    return options;
}

/** Read the flow definition out of a zip export or a bare JSON file. */
function loadDefinition(inputPath) {
    if (!fs.existsSync(inputPath)) { fail(`no such file: ${inputPath}`); }

    if (path.extname(inputPath).toLowerCase() !== '.zip') {
        return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    }

    const listing = execFileSync('unzip', ['-Z1', inputPath], { encoding: 'utf8' })
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    const entry = listing.find(name => /Microsoft\.Flow\/flows\/.+\/definition\.json$/.test(name))
        || listing.find(name => /^Workflows\/.+\.json$/.test(name));

    if (!entry) { fail(`no flow definition found inside ${inputPath}`); }

    const raw = execFileSync('unzip', ['-p', inputPath, entry], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(raw);
}

/**
 * Solution exports wrap the definition in a `clientdata` string; legacy exports
 * nest it under properties.definition.
 */
function resolveDefinition(root) {
    let node = root;

    if (typeof node.clientdata === 'string') {
        node = JSON.parse(node.clientdata);
    }
    if (node.properties?.definition) { return node.properties.definition; }
    if (node.definition) { return node.definition; }
    if (node.actions) { return node; }

    fail('could not locate a definition with an `actions` map');
}

function redactString(value, report, keepSecrets) {
    let output = value;
    if (!keepSecrets) {
        output = output.replace(SECRET_QUERY_PATTERN, (_m, prefix) => {
            report.secretsRedacted++;
            return `${prefix}{{functionKey}}`;
        });
        output = output.replace(FUNCTION_HOST_PATTERN, () => {
            report.functionHostsRewritten++;
            return '{{functionBaseUrl}}';
        });
    }
    output = output.replace(EMAIL_PATTERN, () => {
        report.emailsRedacted++;
        return 'user@example.com';
    });
    for (const pattern of TENANT_ID_PATTERNS) {
        output = output.replace(pattern, match => {
            report.tenantIdsRedacted++;
            return match.toLowerCase().startsWith('https://')
                ? 'https://contoso.sharepoint.com'
                : '{{tenantResourceId}}';
        });
    }
    return output;
}

function scrub(node, report, insideMetadata, keepSecrets) {
    if (node === null || node === undefined) { return node; }
    if (typeof node === 'string') { return redactString(node, report, keepSecrets); }
    if (typeof node !== 'object') { return node; }
    if (Array.isArray(node)) { return node.map(item => scrub(item, report, insideMetadata, keepSecrets)); }

    const output = {};
    for (const [key, value] of Object.entries(node)) {
        if (insideMetadata && !SAFE_METADATA_KEYS.has(key)) {
            report.metadataKeysRemoved++;
            continue;
        }
        if (key === 'authentication') { continue; }
        if (key === 'connection' || key === 'connectionReferenceName') {
            report.connectionsRemoved++;
            continue;
        }
        output[key] = scrub(value, report, key === 'metadata', keepSecrets);
    }
    return output;
}

// ---------------------------------------------------------------------------
// Catalog merge. The source solution ships many scope recipes whose HTTP step
// still points at the literal placeholder route `api/function_trigger_name` -
// the file plumbing (Get file content -> HTTP -> Create file) is wired, but
// the call itself was never configured. The utility catalog knows the real
// route for each function, and the HTTP step names track the catalog titles
// (HTTP_Merge_PDFs -> merge_pdf_fitz), so the two can be joined mechanically.

const PLACEHOLDER_ROUTE = 'function_trigger_name';

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameWords(name) {
    return name.toLowerCase().replace(/^http[_ ]?/, '').split(/[^a-z0-9]+/).filter(Boolean).sort();
}

/** True when both word lists pair up with one being a prefix of the other
 *  ("compression" matches "compress"). Handles inflected step names. */
function wordsMatch(a, b) {
    if (a.length !== b.length) { return false; }
    return a.every((word, i) => word.startsWith(b[i]) || b[i].startsWith(word));
}

function buildCatalogLookup(catalogPath) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const byNorm = new Map();
    for (const action of catalog.actions || []) {
        byNorm.set(normalizeName(action.title), action.route);
        byNorm.set(normalizeName(action.route), action.route);
    }
    return { byNorm, actions: catalog.actions || [] };
}

function resolveRoute(stepName, lookup) {
    const cleaned = stepName.replace(/^HTTP[_ ]?/i, '').replace(/[_ ]\d+$/, '');
    const key = normalizeName(cleaned);

    const exact = lookup.byNorm.get(key);
    if (exact) { return exact; }

    if (key.length > 5) {
        const contained = new Set();
        for (const [norm, route] of lookup.byNorm) {
            if (norm.includes(key) || key.includes(norm)) { contained.add(route); }
        }
        if (contained.size === 1) { return contained.values().next().value; }
    }

    const words = nameWords(cleaned);
    const wordHits = new Set();
    for (const action of lookup.actions) {
        if (wordsMatch(words, nameWords(action.title)) || wordsMatch(words, nameWords(action.route))) {
            wordHits.add(action.route);
        }
    }
    if (wordHits.size === 1) { return wordHits.values().next().value; }

    return null;
}

/** Rewrite placeholder HTTP routes in-place using the step name -> route join. */
function mergeCatalogRoutes(node, lookup, report) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) {
        node.forEach(item => mergeCatalogRoutes(item, lookup, report));
        return;
    }
    for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === 'object' && value.type === 'Http'
            && typeof value.inputs?.uri === 'string'
            && value.inputs.uri.includes(PLACEHOLDER_ROUTE)) {
            const route = resolveRoute(key, lookup);
            if (route) {
                value.inputs.uri = value.inputs.uri.replace(PLACEHOLDER_ROUTE, route);
                report.routesMerged++;
            } else {
                report.unresolvedSteps.push(key);
            }
        }
        mergeCatalogRoutes(value, lookup, report);
    }
}

/** Walk the action tree, yielding [name, action, parentScope] for every node. */
function* walkActions(actions, parent) {
    for (const [name, action] of Object.entries(actions || {})) {
        yield [name, action, parent];
        if (action.actions) { yield* walkActions(action.actions, name); }
        if (action.else?.actions) { yield* walkActions(action.else.actions, name); }
    }
}

function titleFromName(name) {
    return name.replace(/^HTTP_/, '').replace(/_/g, ' ').replace(/\s+\d+$/, '').trim();
}

function newGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const random = (Math.random() * 16) | 0;
        return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    });
}

function toPreset(name, action, category, index) {
    const title = titleFromName(name);
    return {
        id: `flow-preset-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title,
        url: action.inputs?.uri || '',
        method: action.inputs?.method || '',
        icon: '',
        category: category || undefined,
        actionJson: JSON.stringify({
            id: newGuid(),
            brandColor: HTTP_BRAND_COLOR,
            isTrigger: false,
            operationName: title,
            operationDefinition: { ...action, runAfter: {} },
        }, null, 2),
        isFavorite: false,
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help || !options.input) {
        console.log(`Usage: node scripts/extract-flow-presets.js <export.zip|definition.json> [options]

  -o, --output <file>   Write the pack here (default: stdout)
      --scopes          Export whole Scope actions instead of individual HTTP calls
      --category <name> Set a category on every preset
      --keep-secrets    Do not replace ?code= values with {{functionKey}}
      --merge-catalog <utility-catalog.json>
                        Rewrite placeholder api/function_trigger_name routes using
                        the catalog entry matching each HTTP step's name
`);
        process.exit(options.help ? 0 : 1);
    }

    const definition = resolveDefinition(loadDefinition(options.input));
    const report = {
        metadataKeysRemoved: 0, secretsRedacted: 0, emailsRedacted: 0,
        connectionsRemoved: 0, tenantIdsRedacted: 0, functionHostsRewritten: 0,
        routesMerged: 0, unresolvedSteps: [],
    };
    const catalogLookup = options.mergeCatalog ? buildCatalogLookup(options.mergeCatalog) : null;

    const presets = [];
    const seenTitles = new Map();

    for (const [name, action] of walkActions(definition.actions)) {
        const isMatch = options.scopes ? action.type === 'Scope' : action.type === 'Http';
        if (!isMatch) { continue; }

        const cleaned = scrub(action, report, false, options.keepSecrets);
        if (catalogLookup) {
            mergeCatalogRoutes({ [name]: cleaned }, catalogLookup, report);
        }
        const preset = toPreset(name, cleaned, options.category, presets.length);

        // The demo flows repeat the same call several times; keep the first.
        const key = `${preset.title}|${preset.url}`;
        if (seenTitles.has(key)) { continue; }
        seenTitles.set(key, true);

        presets.push(preset);
    }

    const json = JSON.stringify(presets, null, 2);
    if (options.output) {
        fs.writeFileSync(options.output, json + '\n');
        console.error(`Wrote ${presets.length} presets to ${options.output}`);
    } else {
        process.stdout.write(json + '\n');
    }

    const removed = [
        report.metadataKeysRemoved && `${report.metadataKeysRemoved} metadata entries`,
        report.secretsRedacted && `${report.secretsRedacted} secrets`,
        report.emailsRedacted && `${report.emailsRedacted} email addresses`,
        report.connectionsRemoved && `${report.connectionsRemoved} connection references`,
        report.tenantIdsRedacted && `${report.tenantIdsRedacted} tenant identifiers`,
        report.functionHostsRewritten && `${report.functionHostsRewritten} function hosts`,
    ].filter(Boolean);

    if (removed.length > 0) {
        console.error(`Scrubbed ${removed.join(', ')}`);
    }

    if (options.mergeCatalog) {
        console.error(`Merged ${report.routesMerged} placeholder routes from the catalog`);
        const unresolved = [...new Set(report.unresolvedSteps)];
        if (unresolved.length > 0) {
            console.error(`warning: ${unresolved.length} placeholder step(s) had no catalog match and still point at api/${PLACEHOLDER_ROUTE}: ${unresolved.join(', ')}`);
        }
    }
}

main();
