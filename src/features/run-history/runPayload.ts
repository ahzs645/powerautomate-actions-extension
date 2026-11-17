import { ApiError } from '../../services/ApiProvider';

export async function fetchRunPayload(uri: string, signal: AbortSignal) {
  const url = new URL(uri);
  const allowedHost = /\.(environment\.api\.powerplatformusercontent\.com|logic\.azure\.(com|us))$/i;
  const contentPath = /^(?:\/powerautomate\/automations\/direct)?\/workflows\/[^/]+\/runs\/[^/]+\/(?:[^/]+\/)*contents\/[^/]+\/?$/i;
  if (url.protocol !== 'https:' || !allowedHost.test(url.hostname) || !contentPath.test(url.pathname) ||
      !url.searchParams.get('sig') || url.username || url.password || url.port || url.hash) {
    throw new Error('Unexpected content URL');
  }
  const response = await fetch(url.href, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new ApiError(`Power Automate could not retrieve the payload (${response.status}).`, response.status);
  const text = await response.text();
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function outputExpression(name: string, kind: 'action' | 'trigger', path: ReadonlyArray<string | number>) {
  const base = kind === 'trigger' ? 'triggerOutputs()' : `outputs(${quote(name)})`;
  return base + path.map(segment => `?[${typeof segment === 'number' ? segment : quote(segment)}]`).join('');
}

export function dynamicRunLinkExpression(origin: string) {
  return `@{concat(${quote(`${origin}/environments/`)}, workflow()?['tags']?['environmentName'], '/flows/', workflow()?['name'], '/runs/', workflow()?['run']?['name'])}`;
}
