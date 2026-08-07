import { findActionRange } from '../../features/flow-editor/flowJsonLocator';

// The action name deliberately appears as a runAfter key BEFORE its own
// definition, which is the case a naive `"name":` search gets wrong.
const JSON_TEXT = `{
  "definition": {
    "actions": {
      "Read_the_Status": {
        "runAfter": {
          "Look_up_the_site": [
            "Succeeded"
          ]
        },
        "type": "SetVariable"
      },
      "Look_up_the_site": {
        "runAfter": {},
        "type": "OpenApiConnection",
        "inputs": {
          "parameters": {
            "note": "a brace } and a quote \\" inside a string"
          }
        }
      }
    }
  }
}`;

describe('findActionRange', () => {
  it('skips the runAfter reference and finds the real definition', () => {
    const range = findActionRange(JSON_TEXT, 'Look_up_the_site')!;
    expect(range).not.toBeNull();

    // The definition starts on line 12, not line 6 where runAfter mentions it.
    expect(range.startLine).toBe(12);
    expect(range.text).toContain('"OpenApiConnection"');
    expect(range.text.startsWith('"Look_up_the_site"')).toBe(true);
  });

  it('brace-matches past braces and quotes inside string values', () => {
    const range = findActionRange(JSON_TEXT, 'Look_up_the_site')!;

    // Must close the action object, not stop at the brace inside the note string.
    expect(range.text.trimEnd().endsWith('}')).toBe(true);
    expect(range.endLine).toBe(20);

    const slice = JSON_TEXT.slice(range.start, range.end);
    expect(slice).toBe(range.text);
  });

  it('locates an action whose definition comes first', () => {
    const range = findActionRange(JSON_TEXT, 'Read_the_Status')!;
    expect(range.startLine).toBe(4);
    expect(range.text).toContain('"SetVariable"');
  });

  it('returns null for a name that is not an action', () => {
    expect(findActionRange(JSON_TEXT, 'Does_Not_Exist')).toBeNull();
    // "runAfter" is a key but its value is an object without a "type".
    expect(findActionRange(JSON_TEXT, 'runAfter')).toBeNull();
  });

  it('handles empty input without throwing', () => {
    expect(findActionRange('', 'A')).toBeNull();
    expect(findActionRange('{}', '')).toBeNull();
  });

  it('reports columns that bracket the action key', () => {
    const range = findActionRange(JSON_TEXT, 'Read_the_Status')!;
    const line = JSON_TEXT.split('\n')[range.startLine - 1];
    expect(line.slice(range.startColumn - 1)).toContain('"Read_the_Status"');
  });
});
