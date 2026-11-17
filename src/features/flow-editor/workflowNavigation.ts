import { connectionPointer, jsonObject, walkFlowOperations } from './flowConnections';

export interface OperationLink {
  name: string;
  label: string;
  kind: 'Trigger' | 'Action';
  type: string;
  pointer: string;
}

export interface SettingUsage {
  name: string;
  locations: Array<{ operation?: OperationLink; pointer: string; field: string }>;
}

function referencedParameters(value: string) {
  const interpolations = /(?<!@)@\{((?:'(?:''|[^'])*'|[^'}])*)\}/g;
  const expressions = /^@(?![@{])/.test(value) ? [value] : Array.from(value.matchAll(interpolations), match => match[1]);
  const parameters = /'(?:''|[^'])*'|\bparameters\s*\(\s*'((?:''|[^'])+)'\s*\)/gi;
  const names = expressions.flatMap(expression => Array.from(expression.matchAll(parameters), match => match[1] ?? ''));
  return new Set(names.filter(name => !!name && !name.startsWith('$')).map(name => name.replace(/''/g, "'")));
}

export function workflowNavigation(text: string) {
  const definition = jsonObject(JSON.parse(text))?.definition;
  if (!jsonObject(definition)) throw new Error('The flow definition is missing.');
  const operations: OperationLink[] = [];
  const settings = new Map<string, SettingUsage>();
  for (const name of Object.keys(jsonObject(jsonObject(definition)?.parameters) ?? {})) {
    if (!name.startsWith('$')) settings.set(name, { name, locations: [] });
  }

  function findReferences(value: unknown, path: string[], keys: string[], operation?: OperationLink) {
    if (typeof value === 'string') {
      for (const name of Array.from(referencedParameters(value))) {
        const setting = settings.get(name) ?? { name, locations: [] };
        setting.locations.push({ operation, pointer: connectionPointer([...path, ...keys]), field: keys.join(' › ') });
        settings.set(name, setting);
      }
    } else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) findReferences(nested, path, [...keys, key], operation);
    }
  }

  walkFlowOperations(definition, ({ operation, path, kind, label }) => {
    const link = { name: path[path.length - 1], kind, label, pointer: connectionPointer(path), type: String(operation.type ?? '') };
    operations.push(link);

    // Child operations are walked separately so their references point to the child.
    for (const [key, value] of Object.entries(operation)) {
      if (!['actions', 'cases', 'else', 'default', 'metadata', 'runAfter'].includes(key)) findReferences(value, path, [key], link);
    }
    for (const [key, branch] of Object.entries(jsonObject(operation.cases) ?? {})) {
      findReferences(jsonObject(branch)?.case, path, ['cases', key, 'case'], link);
    }
  });
  findReferences(jsonObject(definition)?.outputs, ['definition'], ['outputs']);
  return { operations, settings: Array.from(settings.values()).sort((a, b) => a.name.localeCompare(b.name)) };
}
