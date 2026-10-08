// Locates an action's block inside the raw flow JSON text.
//
// Works on the text rather than the parsed object so the result maps back to
// real line numbers in the editor. Formatting is preserved as the user typed it,
// so a re-serialised object would not line up.

export interface JsonRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  /** Character offsets into the source text. */
  start: number;
  end: number;
  text: string;
}

/**
 * Find the `"<name>": { ... }` block that defines an action.
 *
 * The name also appears as a key inside `runAfter`, but there the value is an
 * array, so requiring an object after the colon already rules those out. We
 * additionally require a `"type"` key so a `cases` entry of the same name does
 * not win over the action itself.
 */
export function findActionRange(json: string, actionName: string): JsonRange | null {
  if (!json || !actionName) return null;

  const needle = `"${actionName}"`;
  let searchFrom = 0;

  while (searchFrom < json.length) {
    const keyStart = json.indexOf(needle, searchFrom);
    if (keyStart === -1) return null;
    searchFrom = keyStart + needle.length;

    // Skip a match that is itself inside a string value rather than a key.
    if (isEscapedPosition(json, keyStart)) continue;

    const braceStart = skipToObjectStart(json, keyStart + needle.length);
    if (braceStart === -1) continue;

    const braceEnd = matchBrace(json, braceStart);
    if (braceEnd === -1) continue;

    const body = json.slice(braceStart, braceEnd + 1);
    if (body.indexOf('"type"') === -1) continue;

    return toRange(json, keyStart, braceEnd + 1);
  }

  return null;
}

/** True when the quote at `index` is preceded by an odd number of backslashes. */
function isEscapedPosition(json: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && json[i] === '\\'; i--) backslashes++;
  return backslashes % 2 === 1;
}

/** Advance past `: ` and return the index of the opening brace, or -1. */
function skipToObjectStart(json: string, from: number): number {
  let i = from;
  while (i < json.length && /\s/.test(json[i])) i++;
  if (json[i] !== ':') return -1;
  i++;
  while (i < json.length && /\s/.test(json[i])) i++;
  return json[i] === '{' ? i : -1;
}

/** Index of the `}` matching the `{` at `start`, ignoring braces inside strings. */
function matchBrace(json: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < json.length; i++) {
    const ch = json[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function toRange(json: string, start: number, end: number): JsonRange {
  const before = json.slice(0, start);
  const startLine = countLines(before);
  const startColumn = start - before.lastIndexOf('\n');

  const upToEnd = json.slice(0, end);
  const endLine = countLines(upToEnd);
  const endColumn = end - upToEnd.lastIndexOf('\n');

  return {
    startLine,
    startColumn,
    endLine,
    endColumn,
    start,
    end,
    text: json.slice(start, end),
  };
}

function countLines(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lines++;
  }
  return lines;
}

/**
 * Find the text range of the value at a JSON pointer (RFC 6901), e.g.
 * `/definition/actions/Try/actions/HTTP/inputs`. For an object member the range
 * covers `"key": value`, so revealing it shows the property name too.
 *
 * When the pointer does not exist (a deleted property, a stale path), the deepest
 * existing ancestor is returned with `exact: false`, so callers can still take the
 * user somewhere sensible. Returns null only when the text cannot be scanned.
 */
export function findPointerRange(
  json: string,
  pointer: string
): (JsonRange & { exact: boolean }) | null {
  if (!json) return null;
  const segments =
    pointer === '' || pointer === '/'
      ? []
      : pointer
          .replace(/^\//, '')
          .split('/')
          .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

  let start = skipWhitespace(json, 0);
  if (start >= json.length) return null;
  let rangeStart = start;
  let valueEnd = scanValue(json, start);
  if (valueEnd === -1) return null;

  for (let depth = 0; depth < segments.length; depth++) {
    const child = findChild(json, start, segments[depth]);
    if (!child) {
      return { ...toRange(json, rangeStart, valueEnd), exact: false };
    }
    rangeStart = child.memberStart;
    start = child.valueStart;
    valueEnd = child.valueEnd;
  }

  return { ...toRange(json, rangeStart, valueEnd), exact: true };
}

interface ChildLocation {
  /** Start of `"key"` for object members, or of the value for array items. */
  memberStart: number;
  valueStart: number;
  valueEnd: number;
}

function findChild(json: string, containerStart: number, segment: string): ChildLocation | null {
  const open = json[containerStart];
  if (open === '{') {
    let i = skipWhitespace(json, containerStart + 1);
    while (i < json.length && json[i] !== '}') {
      if (json[i] !== '"') return null;
      const keyEnd = scanString(json, i);
      if (keyEnd === -1) return null;
      let key: string;
      try {
        key = JSON.parse(json.slice(i, keyEnd));
      } catch {
        return null;
      }
      let j = skipWhitespace(json, keyEnd);
      if (json[j] !== ':') return null;
      j = skipWhitespace(json, j + 1);
      const valueEnd = scanValue(json, j);
      if (valueEnd === -1) return null;
      if (key === segment) return { memberStart: i, valueStart: j, valueEnd };
      i = skipWhitespace(json, valueEnd);
      if (json[i] === ',') i = skipWhitespace(json, i + 1);
    }
    return null;
  }

  if (open === '[') {
    if (!/^\d+$/.test(segment)) return null;
    const wanted = Number(segment);
    let index = 0;
    let i = skipWhitespace(json, containerStart + 1);
    while (i < json.length && json[i] !== ']') {
      const valueEnd = scanValue(json, i);
      if (valueEnd === -1) return null;
      if (index === wanted) return { memberStart: i, valueStart: i, valueEnd };
      index++;
      i = skipWhitespace(json, valueEnd);
      if (json[i] === ',') i = skipWhitespace(json, i + 1);
    }
  }
  return null;
}

function skipWhitespace(json: string, from: number): number {
  let i = from;
  while (i < json.length && (json[i] === ' ' || json[i] === '\n' || json[i] === '\r' || json[i] === '\t')) i++;
  return i;
}

/** End index (exclusive) of the string starting at `start`, or -1. */
function scanString(json: string, start: number): number {
  for (let i = start + 1; i < json.length; i++) {
    if (json[i] === '\\') i++;
    else if (json[i] === '"') return i + 1;
  }
  return -1;
}

/** End index (exclusive) of the JSON value starting at `start`, or -1. */
function scanValue(json: string, start: number): number {
  const ch = json[start];
  if (ch === '"') return scanString(json, start);
  if (ch === '{') {
    const end = matchBrace(json, start);
    return end === -1 ? -1 : end + 1;
  }
  if (ch === '[') {
    let depth = 0;
    for (let i = start; i < json.length; i++) {
      const c = json[i];
      if (c === '"') {
        const end = scanString(json, i);
        if (end === -1) return -1;
        i = end - 1;
      } else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  // number, true, false, null
  let i = start;
  while (i < json.length && !/[\s,\]}]/.test(json[i])) i++;
  return i > start ? i : -1;
}
