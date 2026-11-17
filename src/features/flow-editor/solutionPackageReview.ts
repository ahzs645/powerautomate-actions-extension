import JSZip from 'jszip';
import { collectConnectionUses, connectorName, jsonObject, walkFlowOperations } from './flowConnections';

interface PackageConnectionUse {
  flow: string;
  alias: string;
  steps: string[];
}

export interface PackageConnection {
  name: string;
  label: string;
  connector: string;
  connectorId?: string;
  included: boolean;
  uses: PackageConnectionUse[];
}

interface PackageVariable {
  name: string;
  label: string;
  hasDefault: boolean;
  hasCurrentValue: boolean;
}

interface PackageDestination {
  flow: string;
  setting: string;
  steps: string[];
}

export interface SolutionPackageReview {
  uniqueName: string;
  version: string;
  managed: boolean;
  flows: Array<{ id: string; name: string; enabled?: boolean }>;
  connections: PackageConnection[];
  environmentVariables: PackageVariable[];
  destinations: PackageDestination[];
  requiredComponents: string[];
  otherComponents: string[];
}

const CONNECTION_LABELS: Record<string, string> = {
  shared_office365: 'Microsoft 365 Outlook',
  shared_sharepointonline: 'SharePoint',
  shared_excelonlinebusiness: 'Excel Online (Business)',
};

const COMPONENT_LABELS: Record<string, string> = {
  '1': 'Table',
  '9': 'Choice',
  '20': 'Security role',
  '29': 'Process',
  '61': 'Web resource',
  '80': 'Model-driven app',
  '300': 'Canvas app',
  '380': 'Environment variable definition',
  '381': 'Environment variable value',
};

const DESTINATIONS: Record<string, Record<string, string>> = {
  shared_office365: { mailboxaddress: 'Mailbox', folderpath: 'Mail folder' },
  shared_office365groupsmail: { groupid: 'Mail group', folderpath: 'Mail folder' },
  shared_sharepointonline: { dataset: 'SharePoint site', table: 'SharePoint list or library', folderpath: 'SharePoint folder', path: 'SharePoint path' },
  shared_excelonlinebusiness: { source: 'Excel location', drive: 'Excel drive or library', file: 'Excel workbook', table: 'Excel table' },
  shared_onedriveforbusiness: { folder: 'OneDrive folder', folderpath: 'OneDrive folder', path: 'OneDrive path' },
  shared_teams: { teamid: 'Teams team', channelid: 'Teams channel' },
};
const sharePointUrl = /https?:\/\/[\w.-]+\.sharepoint\.(?:com|us|cn|de)\b/i;

function containsSharePointUrl(value: unknown): boolean {
  if (typeof value === 'string') return sharePointUrl.test(value);
  if (Array.isArray(value)) return value.some(containsSharePointUrl);
  const object = jsonObject(value);
  return !!object && Object.values(object).some(containsSharePointUrl);
}

function element(xml: Document | Element, name: string): Element | undefined {
  return xml.getElementsByTagName(name).item(0) ?? undefined;
}

function content(xml: Document | Element, name: string) {
  return element(xml, name)?.textContent?.trim() ?? '';
}

function parseXml(text: string, file: string) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (element(xml, 'parsererror')) throw new Error(`The package has invalid ${file}.`);
  return xml;
}

function normalizeId(id: string) {
  return id.replace(/[{}]/g, '').toLowerCase();
}

function connectorLabel(value: string) {
  const name = value.split('/').pop() ?? '';
  return CONNECTION_LABELS[name] ?? name;
}

function environmentVariables(xml: Document, variables: Map<string, PackageVariable>) {
  for (const node of Array.from(xml.getElementsByTagName('environmentvariabledefinition'))) {
    const name = node.getAttribute('schemaname') || content(node, 'schemaname');
    if (!name) continue;
    const previous = variables.get(name.toLowerCase());
    variables.set(name.toLowerCase(), {
      name,
      label: element(node, 'displayname')?.getAttribute('description') || content(node, 'displayname') || previous?.label || name,
      hasDefault: !!content(node, 'defaultvalue') || !!previous?.hasDefault,
      hasCurrentValue: Array.from(node.getElementsByTagName('environmentvariablevalue')).some(value => !!content(value, 'value')) || !!previous?.hasCurrentValue,
    });
  }
}

function reviewFlow(definition: unknown, refs: Record<string, unknown>, flow: string, connections: Map<string, PackageConnection>) {
  const uses = collectConnectionUses(definition);
  const byAlias = new Map<string, typeof uses>();
  for (const use of uses) {
    const steps = byAlias.get(use.alias) ?? [];
    steps.push(use);
    byAlias.set(use.alias, steps);
  }
  for (const [alias, steps] of Array.from(byAlias)) {
    const reference = jsonObject(Object.prototype.hasOwnProperty.call(refs, alias) ? refs[alias] : undefined);
    const logicalName = jsonObject(reference?.connection)?.connectionReferenceLogicalName ?? reference?.connectionReferenceLogicalName;
    const resolved = typeof logicalName === 'string' && logicalName.trim();
    const key = resolved ? resolved.toLowerCase() : `${flow}:${alias}`;
    const connector = connectorLabel(steps[0].connectorId || connectorName(reference) || '');
    const row = connections.get(key) ?? { name: resolved || alias, label: resolved || alias, connector, included: false, uses: [] };
    row.uses.push({ flow, alias, steps: steps.map(step => step.label) });
    connections.set(key, row);
  }

  const destinations = new Map<string, Set<string>>();
  walkFlowOperations(definition, ({ operation, label }) => {
    const inputs = jsonObject(operation.inputs);
    const host = jsonObject(inputs?.host);
    const alias = host?.connectionName ?? host?.connectionReferenceName ?? jsonObject(host?.connection)?.referenceName;
    const api = typeof host?.apiId === 'string' ? host.apiId.split('/').pop() :
      typeof alias === 'string' && Object.prototype.hasOwnProperty.call(refs, alias) ? connectorName(refs[alias]) : undefined;
    const settings = api ? DESTINATIONS[api.toLowerCase()] : undefined;
    for (const [key, value] of Object.entries(jsonObject(inputs?.parameters) ?? inputs ?? {})) {
      const setting = settings?.[key.toLowerCase()];
      if (!setting || typeof value !== 'string' || !value.trim() || value.trimStart().startsWith('@')) continue;
      const steps = destinations.get(setting) ?? new Set<string>();
      steps.add(label);
      destinations.set(setting, steps);
    }
    if (containsSharePointUrl(operation.expression) ||
        (!destinations.get('SharePoint site')?.has(label) && containsSharePointUrl(operation.inputs))) {
      const steps = destinations.get('Embedded SharePoint URL') ?? new Set<string>();
      steps.add(label);
      destinations.set('Embedded SharePoint URL', steps);
    }
  });
  return Array.from(destinations, ([setting, steps]) => ({ setting, flow, steps: Array.from(steps) }));
}

/** Review the exact archive that will be downloaded. Destination and variable values stay in the archive. */
export async function reviewSolutionPackage(bytes: ArrayBuffer | Uint8Array): Promise<SolutionPackageReview> {
  const zip = await JSZip.loadAsync(bytes);
  const files = new Map(Object.values(zip.files).filter(file => !file.dir).map(file => [file.name.toLowerCase(), file]));
  const manifestFile = files.get('solution.xml');
  const customizationsFile = files.get('customizations.xml');
  if (!manifestFile || !customizationsFile) throw new Error('Choose a Power Platform solution ZIP with a solution manifest.');
  const [solutionText, customizationsText] = await Promise.all([manifestFile.async('text'), customizationsFile.async('text')]);
  const manifest = element(parseXml(solutionText, 'solution.xml'), 'SolutionManifest');
  const customizations = parseXml(customizationsText, 'customizations.xml');
  if (!manifest) throw new Error('The package is missing its solution manifest.');
  const uniqueName = content(manifest, 'UniqueName');
  const version = content(manifest, 'Version');
  const managedField = content(manifest, 'Managed');
  if (!uniqueName || !version || !['0', '1'].includes(managedField)) throw new Error('The solution manifest is incomplete.');

  const connections = new Map<string, PackageConnection>();
  for (const node of Array.from(customizations.getElementsByTagName('connectionreference'))) {
    const name = node.getAttribute('connectionreferencelogicalname') || content(node, 'connectionreferencelogicalname');
    if (!name) continue;
    const connectorId = content(node, 'connectorid');
    connections.set(name.toLowerCase(), {
      name, label: content(node, 'connectionreferencedisplayname') || name,
      connector: connectorLabel(connectorId), connectorId, included: true, uses: [],
    });
  }

  const variables = new Map<string, PackageVariable>();
  environmentVariables(customizations, variables);
  for (const [path, file] of Array.from(files)) {
    if (!path.startsWith('environmentvariabledefinitions/') || !path.endsWith('/environmentvariabledefinition.xml')) continue;
    const xml = parseXml(await file.async('text'), 'environment variable definition');
    environmentVariables(xml, variables);
  }
  for (const [path] of Array.from(files)) {
    const match = /^environmentvariabledefinitions\/([^/]+)\/.*environmentvariablevalues?[^/]*\.(json|xml)$/.exec(path);
    const variable = match && variables.get(match[1]);
    if (variable) variable.hasCurrentValue = true;
  }

  const flows: SolutionPackageReview['flows'] = [];
  const destinations: PackageDestination[] = [];
  const remainingFlows = new Set(Array.from(files.keys()).filter(path => /^workflows\/.*\.json$/i.test(path)));
  for (const node of Array.from(customizations.getElementsByTagName('Workflow'))) {
    const path = content(node, 'JsonFileName').replace(/^[\\/]+/, '').replace(/\\/g, '/').toLowerCase();
    if (!path) continue;
    const file = files.get(path);
    if (!file) throw new Error('A cloud flow listed in the package is missing its JSON definition.');
    remainingFlows.delete(path);
    const data = jsonObject(JSON.parse(await file.async('text')));
    const properties = jsonObject(data?.properties);
    const definition = jsonObject(properties?.definition);
    if (!definition) throw new Error('A cloud flow in the package has an unreadable definition.');
    const name = node.getAttribute('Name') || file.name.split('/').pop() || 'Cloud flow';
    const state = content(node, 'StateCode');
    flows.push({ id: normalizeId(node.getAttribute('WorkflowId') ?? ''), name, enabled: state === '1' ? true : state === '0' ? false : undefined });
    destinations.push(...reviewFlow(definition, jsonObject(properties?.connectionReferences) ?? {}, name, connections));
  }
  if (remainingFlows.size) throw new Error('The solution lists cloud flow files without matching workflow metadata.');
  const requiredComponents = Array.from(manifest.getElementsByTagName('MissingDependency')).map(node => {
    const required = element(node, 'Required');
    const title = required?.getAttribute('displayName') || required?.getAttribute('schemaName') || 'Required component';
    const source = required?.getAttribute('solution');
    return source ? `${title} (${source})` : title;
  });
  const flowIds = new Set(flows.map(flow => flow.id));
  const otherComponents = Array.from(manifest.getElementsByTagName('RootComponent')).flatMap(node => {
    const type = node.getAttribute('type') ?? '';
    if (type === '29' && flowIds.has(normalizeId(node.getAttribute('id') ?? ''))) return [];
    const name = node.getAttribute('schemaName');
    const label = COMPONENT_LABELS[type] ?? (type ? `Component type ${type}` : 'Solution component');
    return [name ? `${label} · ${name}` : label];
  });
  return {
    uniqueName, version, managed: managedField === '1', flows, destinations, requiredComponents, otherComponents,
    connections: Array.from(connections.values()).sort((a, b) => Number(!!b.uses.length) - Number(!!a.uses.length)),
    environmentVariables: Array.from(variables.values()),
  };
}
