import { diff } from 'deep-diff';
import type { FlowDocument } from './flowPersistence';

type JsonObject = Record<string, unknown>;
type ConnectionDocument = Pick<FlowDocument, 'definition' | 'connectionReferences'>;

export function jsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

const own = (object: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const literalAlias = /^[\w.-]+$/;
const parameterAlias = /^@?\{?\s*parameters\(\s*['"]\$connections['"]\s*\)\s*\[\s*['"]([^'"]+)['"]\s*\]\s*\[\s*['"]connectionId['"]\s*\]\s*\}?$/i;

export interface ConnectionUse {
  alias: string;
  kind: 'Trigger' | 'Action';
  path: string[];
  label: string;
  connectorId?: string;
  fromParameter: boolean;
}

export interface FlowOperation {
  operation: JsonObject;
  kind: ConnectionUse['kind'];
  path: string[];
  label: string;
}

export function connectionPointer(path: string[]) {
  return '/' + path.map(segment => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function resolveHost(host: JsonObject) {
  const connection = jsonObject(host.connection);
  for (const value of [host.connectionName, host.connectionReferenceName, connection?.referenceName, host.connection, connection?.name]) {
    if (typeof value !== 'string') continue;
    if (literalAlias.test(value)) return { alias: value, fromParameter: false };
    const alias = parameterAlias.exec(value)?.[1];
    if (alias) return { alias, fromParameter: true };
  }
  return undefined;
}

export function walkFlowOperations(definition: unknown, visit: (step: FlowOperation) => void) {
  const root = jsonObject(definition);
  const walk = (value: unknown, path: string[], parents: string[], kind: ConnectionUse['kind']) => {
    for (const [name, item] of Object.entries(jsonObject(value) ?? {})) {
      const operation = jsonObject(item);
      if (!operation) continue;
      const stepPath = [...path, name];
      const labels = [...parents, name];
      visit({ operation, kind, path: stepPath, label: labels.join(' › ') });
      walk(operation.actions, [...stepPath, 'actions'], labels, 'Action');
      walk(jsonObject(operation.else)?.actions, [...stepPath, 'else', 'actions'], [...labels, 'Else'], 'Action');
      walk(jsonObject(operation.default)?.actions, [...stepPath, 'default', 'actions'], [...labels, 'Default'], 'Action');
      for (const [caseName, branch] of Object.entries(jsonObject(operation.cases) ?? {})) {
        walk(jsonObject(branch)?.actions, [...stepPath, 'cases', caseName, 'actions'], [...labels, caseName], 'Action');
      }
    }
  };
  walk(root?.triggers, ['definition', 'triggers'], [], 'Trigger');
  walk(root?.actions, ['definition', 'actions'], [], 'Action');
}

export function collectConnectionUses(definition: unknown): ConnectionUse[] {
  const uses: ConnectionUse[] = [];
  walkFlowOperations(definition, ({ operation, kind, path, label }) => {
    const host = jsonObject(jsonObject(operation.inputs)?.host);
    if (!host || typeof operation.type !== 'string' || !/^(Open)?ApiConnection(Webhook|Notification)?$/i.test(operation.type)) return;
    const binding = resolveHost(host);
    if (binding) uses.push({
      ...binding, kind, path, label,
      connectorId: typeof host.apiId === 'string' ? host.apiId : undefined,
    });
  });
  return uses;
}

export function legacyReferences(definition: unknown) {
  const parameters = jsonObject(jsonObject(definition)?.parameters);
  return jsonObject(jsonObject(parameters?.$connections)?.defaultValue) ?? {};
}

export function connectorName(reference: unknown): string | undefined {
  const ref = jsonObject(reference);
  const value = ref?.displayName ?? ref?.apiName ?? jsonObject(ref?.api)?.name ?? ref?.id;
  return typeof value === 'string' ? value.split('/').pop() : undefined;
}

export function getConnectionIssues(doc: ConnectionDocument): string[] {
  const refs = doc.connectionReferences;
  const legacy = legacyReferences(doc.definition);
  const issues: string[] = [];
  for (const { alias, fromParameter, kind, label, connectorId } of collectConnectionUses(doc.definition)) {
    if (!own(refs, alias) && !(fromParameter && own(legacy, alias))) {
      issues.push(`${kind} ${JSON.stringify(label)} uses missing connection reference ${JSON.stringify(alias)}.`);
      continue;
    }
    const ref = jsonObject(own(refs, alias) ? refs[alias] : legacy[alias]);
    const referenceApi = ref?.id ?? ref?.apiName ?? jsonObject(ref?.api)?.name;
    const expected = connectorId?.split('/').pop()?.toLowerCase();
    const actual = typeof referenceApi === 'string' ? referenceApi.split('/').pop()?.toLowerCase() : undefined;
    if (expected?.startsWith('shared_') && actual?.startsWith('shared_') && expected !== actual) {
      issues.push(`${kind} ${JSON.stringify(label)} uses ${expected} with reference ${JSON.stringify(alias)} for ${actual}.`);
    }
  }
  return issues;
}

export interface ConnectionChange {
  key: string;
  text: string;
  uses: ConnectionUse[];
  fields?: string[];
}

export function describeConnectionChanges(before: ConnectionDocument, after: ConnectionDocument): ConnectionChange[] {
  const changes: ConnectionChange[] = [];
  const beforeUses = collectConnectionUses(before.definition);
  const afterUses = collectConnectionUses(after.definition);
  const aliases = Array.from(new Set([...Object.keys(before.connectionReferences), ...Object.keys(after.connectionReferences)]));
  for (const alias of aliases) {
    const had = own(before.connectionReferences, alias);
    const has = own(after.connectionReferences, alias);
    const updates = had && has ? diff(before.connectionReferences[alias], after.connectionReferences[alias]) : undefined;
    if (had && has && !updates) continue;
    const kind = had ? (has ? 'Changed' : 'Removed') : 'Added';
    const uses = (has ? afterUses : beforeUses).filter(use => use.alias === alias);
    const fields = updates?.flatMap(update => update.path?.length ? [update.path.join('.')] : []);
    changes.push({ key: `reference:${alias}`, text: `${kind} reference ${alias}`, uses, fields });
  }
  const previousByPath = new Map(beforeUses.map(use => [connectionPointer(use.path), use]));
  for (const use of afterUses) {
    const path = connectionPointer(use.path);
    const previous = previousByPath.get(path);
    if (!previous) continue;
    if (previous.alias !== use.alias) {
      changes.push({ key: path, text: `${use.label} changed from ${previous.alias} to ${use.alias}`, uses: [] });
    } else if (previous.fromParameter !== use.fromParameter || previous.connectorId !== use.connectorId) {
      changes.push({ key: path, text: `${use.label} changed how it binds to ${use.alias}`, uses: [] });
    }
  }
  const previousLegacy = legacyReferences(before.definition);
  const nextLegacy = legacyReferences(after.definition);
  for (const alias of Array.from(new Set([...Object.keys(previousLegacy), ...Object.keys(nextLegacy)]))) {
    if (!diff(previousLegacy[alias], nextLegacy[alias])) continue;
    const uses = (own(nextLegacy, alias) ? afterUses : beforeUses).filter(use => use.fromParameter && use.alias === alias);
    changes.push({ key: `parameter:${alias}`, text: `Changed $connections binding ${alias}`, uses });
  }
  return changes;
}
