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
