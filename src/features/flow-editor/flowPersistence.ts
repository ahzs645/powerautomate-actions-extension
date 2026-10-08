// Reading and writing a flow, and the text the editor shows for it.
//
// Saving goes through a FlowSaveStrategy so a second backend can be plugged in
// without touching the editor UI: the Flow service (api.flow.microsoft.com /
// *.api.powerplatform.com) is the only implementation today; a Dataverse
// strategy (solution-aware flows stored in the `workflow` table) implements the
// same two calls and is returned from selectSaveStrategy().

import { IApiProvider } from '../../services/ApiProvider';

export const EDITOR_SCHEMA_URI = 'https://power-automate-toolkit.local/flow-editor.json#';

/** The parts of a flow the editor reads and writes. */
export interface FlowDocument {
  displayName: string;
  definition: any;
  connectionReferences: Record<string, any>;
}

/** Which flow an operation applies to. */
export interface FlowTarget {
  envId: string;
  flowId: string;
}

/**
 * How a flow is written back.
 *
 * `saveDraft` persists the definition without publishing it and resolves with the
 * document as the server stored it (the server normalises JSON, fills in defaults,
 * etc.), which the editor then shows. `publish` makes the last saved draft live.
 * Both reject with an Error whose message is shown to the user.
 */
export interface FlowSaveStrategy {
  /** Short identifier, for logs and diagnostics. */
  readonly id: string;
  saveDraft(api: IApiProvider, target: FlowTarget, doc: FlowDocument): Promise<FlowDocument>;
  publish(api: IApiProvider, target: FlowTarget): Promise<void>;
}

export function getFlowUrl(envId: string | null, flowId: string | null, isPowerPlatform: boolean) {
  if (!envId || !flowId) {
    throw new Error('Missing environment ID or flow ID');
  }
  // Power Platform environment APIs use /powerautomate/flows/{flowId}
  // Legacy APIs use /providers/Microsoft.ProcessSimple/environments/{envId}/flows/{flowId}
  // draftFlow=true is required for solution-aware flows with unpublished changes
  if (isPowerPlatform) {
    return `powerautomate/flows/${flowId}?draftFlow=true`;
  }
  return `providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}?draftFlow=true`;
}

export function getFlowPublishUrl(envId: string | null, flowId: string | null, isPowerPlatform: boolean) {
  if (!envId || !flowId) {
    throw new Error('Missing environment ID or flow ID');
  }
  if (isPowerPlatform) {
    return `powerautomate/flows/${flowId}/publish`;
  }
  return `providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}/publish`;
}

/** Map a Flow service response (`{ properties: {...} }`) to a FlowDocument. */
export function documentFromFlowResponse(flow: any): FlowDocument {
  if (!flow?.properties) {
    throw new Error('Invalid flow data - missing properties');
  }
  if (!flow.properties.definition) {
    throw new Error('Invalid flow data - missing definition');
  }
  return {
    displayName: flow.properties.displayName || 'Untitled Flow',
    definition: flow.properties.definition,
    connectionReferences: flow.properties.connectionReferences || {},
  };
}

/** Save and publish through the Flow service's REST API. */
export const flowServiceSaveStrategy: FlowSaveStrategy = {
  id: 'flow-service',

  async saveDraft(api, target, doc) {
    const response = await api.patch(getFlowUrl(target.envId, target.flowId, api.isPowerPlatformApi), {
      properties: {
        displayName: doc.displayName.trim(),
        definition: doc.definition,
        connectionReferences: doc.connectionReferences,
      },
    });
    if (!response?.properties) {
      throw new Error('Invalid save response - missing properties');
    }
    return documentFromFlowResponse({
      ...response,
      properties: { displayName: doc.displayName, ...response.properties },
    });
  },

  async publish(api, target) {
    await api.post(getFlowPublishUrl(target.envId, target.flowId, api.isPowerPlatformApi), {});
  },
};

/**
 * Pick the strategy for a flow. Extension point: return a Dataverse strategy here
 * (e.g. when the session holds a Dataverse token for the environment) and the
 * editor's Save / Publish use it unchanged.
 */
export function selectSaveStrategy(_api: IApiProvider, _target: FlowTarget): FlowSaveStrategy {
  return flowServiceSaveStrategy;
}

/** The JSON text the editor shows for a flow. */
export function toEditorText(doc: Pick<FlowDocument, 'definition' | 'connectionReferences'>): string {
  return JSON.stringify(
    {
      $schema: EDITOR_SCHEMA_URI,
      connectionReferences: doc.connectionReferences || {},
      definition: doc.definition,
    },
    null,
    2
  );
}

export type ParsedEditorText =
  | { ok: true; doc: FlowDocument }
  | { ok: false; error: string };

/** Parse the editor text back into a FlowDocument, with a user-facing error when it cannot be. */
export function parseEditorText(text: string, displayName: string): ParsedEditorText {
  if (!text?.trim()) {
    return { ok: false, error: 'Flow definition cannot be empty' };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.definition) {
    return { ok: false, error: 'Missing "definition" property in flow definition' };
  }
  return {
    ok: true,
    doc: {
      displayName,
      definition: parsed.definition,
      connectionReferences: parsed.connectionReferences || {},
    },
  };
}
