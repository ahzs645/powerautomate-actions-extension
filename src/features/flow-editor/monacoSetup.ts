// Monaco and the JSON schemas are only needed once a flow is open in the editor.
// Everything here is reached through the lazily loaded FlowEditorPage chunk, so
// the flows list and the "Connecting…" screen never download it.

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import workflowDefinitionSchema from '../../schemas/workflowdefinition.json';
import flowEditorSchema from '../../schemas/flow-editor.json';

export const WORKFLOW_SCHEMA_URI =
  'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json';

let initialized = false;

export function initMonaco() {
  if (initialized) return;
  initialized = true;

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    // Both schemas are bundled. Letting the JSON worker fetch `$schema` URLs would
    // make network requests from the extension page (and fail under its CSP).
    enableSchemaRequest: false,
    schemas: [
      {
        uri: WORKFLOW_SCHEMA_URI,
        schema: workflowDefinitionSchema,
      },
      {
        uri: 'https://power-automate-toolkit.local/flow-editor.json',
        schema: flowEditorSchema,
        fileMatch: ['*'],
      },
    ],
  });

  // Use the bundled Monaco instead of @monaco-editor/react's default CDN download.
  loader.config({ monaco });
}

initMonaco();

export { monaco };
