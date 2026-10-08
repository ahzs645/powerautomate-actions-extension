import { findActionRange, findPointerRange } from '../../features/flow-editor/flowJsonLocator';

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

describe('findPointerRange', () => {
  const text = JSON.stringify(
    {
      $schema: 'x',
      definition: {
        actions: {
          'a/b': { type: 'Compose', inputs: ['zero', { deep: true }] },
          Send: { type: 'Http', inputs: { method: 'GET', note: 'brace } in "string"' } },
        },
      },
    },
    null,
    2
  );

  it('finds an object member including its key', () => {
    const range = findPointerRange(text, '/definition/actions/Send/inputs')!;
    expect(range.exact).toBe(true);
    expect(range.text.startsWith('"inputs": {')).toBe(true);
    expect(JSON.parse(`{${range.text}}`).inputs.method).toBe('GET');
  });

  it('unescapes ~1 and walks into arrays', () => {
    const range = findPointerRange(text, '/definition/actions/a~1b/inputs/1/deep')!;
    expect(range.exact).toBe(true);
    expect(range.text).toBe('"deep": true');
    expect(text.split('\n')[range.startLine - 1]).toContain('"deep": true');
  });

  it('falls back to the deepest existing ancestor', () => {
    const range = findPointerRange(text, '/definition/actions/Send/inputs/uri')!;
    expect(range.exact).toBe(false);
    expect(range.text.startsWith('"inputs"')).toBe(true);
  });

  it('returns the whole document for the root pointer and null for empty text', () => {
    expect(findPointerRange(text, '')!.text).toBe(text);
    expect(findPointerRange('', '/a')).toBeNull();
  });
});
