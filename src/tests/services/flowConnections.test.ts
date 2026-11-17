import { collectConnectionUses, describeConnectionChanges, getConnectionIssues } from '../../features/flow-editor/flowConnections';
import { definitionProjection } from '../../features/flow-editor/definitionProjection';
import { flowServiceSaveStrategy, parseEditorText } from '../../features/flow-editor/flowPersistence';
import type { IApiProvider } from '../../services/ApiProvider';

const apiId = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline';
const references = {
  shared_sharepointonline: { id: apiId, connectionName: 'test-a' },
  'shared_sharepointonline-1': { id: apiId, connectionName: 'test-b' },
};
const definition = {
  parameters: { $connections: {}, $authentication: {} },
  triggers: { OnItem: { type: 'OpenApiConnectionWebhook', inputs: { host: { apiId, connectionName: 'shared_sharepointonline' } } } },
  actions: {
    Choose: {
      type: 'Switch',
      cases: {
        A: { actions: { Update: { type: 'OpenApiConnection', inputs: { host: { apiId, connection: { referenceName: 'shared_sharepointonline-1' } } } } } },
      },
      default: { actions: { Compose: { type: 'Compose', inputs: { host: { connectionName: 'not-a-binding' } } } } },
    },
  },
};
const document = { displayName: 'Test flow', connectionReferences: references, definition };

test('resolves exact aliases in triggers and branches and ignores data in a Compose', () => {
  expect(collectConnectionUses(definition).map(use => [use.kind, use.label, use.alias])).toEqual([
    ['Trigger', 'OnItem', 'shared_sharepointonline'],
    ['Action', 'Choose › A › Update', 'shared_sharepointonline-1'],
  ]);
  expect(getConnectionIssues(document)).toEqual([]);
  expect(getConnectionIssues({ ...document, connectionReferences: { shared_sharepointonline: references.shared_sharepointonline } }))
    .toEqual(['Action "Choose › A › Update" uses missing connection reference "shared_sharepointonline-1".']);
});

test('accepts a declared legacy parameter binding and detects a different connector', () => {
  const legacyDefinition = {
    parameters: { $connections: { defaultValue: { legacy: { id: apiId } } } },
    actions: { Update: { type: 'ApiConnection', inputs: { host: { apiId, connection: {
      name: "@parameters('$connections')['legacy']['connectionId']",
    } } } } },
  };
  expect(getConnectionIssues({ definition: legacyDefinition, connectionReferences: {} })).toEqual([]);
  const wrong = { ...references, 'shared_sharepointonline-1': { id: '/apis/shared_excelonlinebusiness' } };
  expect(getConnectionIssues({ definition, connectionReferences: wrong })[0]).toContain('for shared_excelonlinebusiness');
});

test('blocks omitted or malformed maps and distinguishes a valid empty map', () => {
  expect(parseEditorText(JSON.stringify({ definition }), 'Test').ok).toBe(false);
  expect(parseEditorText(JSON.stringify({ definition, connectionReferences: { broken: null } }), 'Test').ok).toBe(false);
  const parsed = parseEditorText(JSON.stringify({ definition, connectionReferences: {} }), 'Test');
  expect(parsed.ok && getConnectionIssues(parsed.doc)).toHaveLength(2);
  expect(parseEditorText('{"definition":{},"connectionReferences":{}}', 'Test').ok).toBe(true);
});

test('identifies the binding, changed field, and affected steps without exposing values', () => {
  const after = { ...document, connectionReferences: { ...references,
    'shared_sharepointonline-1': { ...references['shared_sharepointonline-1'], connectionName: 'rotated' },
  } };
  const changes = describeConnectionChanges(document, after);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    text: 'Changed reference shared_sharepointonline-1', fields: ['connectionName'], uses: [{ label: 'Choose › A › Update' }],
  });
  expect(JSON.stringify(changes)).not.toContain('rotated');
});

test('projects only the effective definition and leaves the envelope untouched', () => {
  const source = ' { "definition":{}, "connectionReferences": {"alias":{}}, "definition": {"original": true}, "meta": 1 } ';
  const projection = definitionProjection(source)!;
  expect(projection.value).toBe('{"original": true}');
  expect(source.slice(0, projection.start) + '{"changed": true}' + source.slice(projection.end)).toBe(
    ' { "definition":{}, "connectionReferences": {"alias":{}}, "definition": {"changed": true}, "meta": 1 } '
  );
});

test('retains submitted bindings when PATCH returns only a definition', async () => {
  const patch = jest.fn().mockResolvedValue({ properties: { definition } });
  const api = { patch, isPowerPlatformApi: false } as unknown as IApiProvider;
  const saved = await flowServiceSaveStrategy.saveDraft(api, { envId: 'env', flowId: 'flow' }, document);
  expect(saved.connectionReferences).toEqual(references);
  expect(patch.mock.calls[0][1].properties.connectionReferences).toEqual(references);
});
