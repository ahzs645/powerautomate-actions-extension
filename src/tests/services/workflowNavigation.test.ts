import { findPointerRange } from '../../features/flow-editor/flowJsonLocator';
import { workflowNavigation } from '../../features/flow-editor/workflowNavigation';

test('links to exact nested actions and the fields that consume flow settings', () => {
  const text = JSON.stringify({ definition: {
    parameters: { 'Site (app_site)': {}, $authentication: {} },
    triggers: { Start: { type: 'Request', inputs: { parameter: "@parameters('Site (app_site)')" } } },
    actions: { Scope: { type: 'Scope', actions: { 'Lookup/name': {
      type: 'Compose', inputs: ["@parameters('Site (app_site)')", "@@parameters('escaped')", "@parameters('$authentication')",
        "parameters('plain text') @{concat('parameters(''quoted'')', parameters('Site (app_site)'))}"],
    } } } },
    outputs: { result: { value: "@parameters('Site (app_site)')" } },
  } });
  const { operations, settings } = workflowNavigation(text);
  expect(operations.map(operation => operation.label)).toEqual(['Start', 'Scope', 'Scope › Lookup/name']);
  expect(settings.map(setting => setting.name)).toEqual(['Site (app_site)']);
  expect(settings[0].locations.map(location => location.operation?.name)).toEqual(['Start', 'Lookup/name', 'Lookup/name', undefined]);
  const nested = findPointerRange(text, settings[0].locations[1].pointer);
  expect(nested).toMatchObject({ exact: true, text: '"@parameters(\'Site (app_site)\')"' });
});
