import { findPointerRange } from './flowJsonLocator';

/** Find the raw definition value so the JSON envelope can retain its exact formatting. */
export function definitionProjection(source: string) {
  const location = findPointerRange(source, '/definition');
  if (!location?.exact) return undefined;
  const colon = location.text.indexOf(':');
  if (colon === -1) return undefined;
  const body = location.text.slice(colon + 1);
  const value = body.trimStart();
  if (!value.startsWith('{')) return undefined;
  return { value, start: location.end - value.length, end: location.end };
}
