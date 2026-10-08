// Reading and writing a flow, and the text the editor shows for it.
//
// Saving goes through a FlowSaveStrategy so a second backend can be plugged in
// without touching the editor UI. The Flow service (api.flow.microsoft.com /
// *.api.powerplatform.com) is the default. The Dataverse strategy
// (dataverseSaveStrategy.ts: solution-aware flows stored in the `workflow`
// table) is experimental and only chosen when the user opted in for the
// environment AND the flow is a solution flow AND a Dataverse sign-in exists.

import { IApiProvider } from '../../services/ApiProvider';
import { dataverseSaveStrategy } from './dataverseSaveStrategy';

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
  /** Dataverse `workflowid` of a solution flow (flow GET `properties.workflowEntityId`). */
  workflowEntityId?: string;
  /**
   * Dataverse row version (`@odata.etag`) the editor's text is based on. When
   * known, a Dataverse save is conditional on it, so edits made elsewhere since
   * then are detected instead of overwritten.
   */
  dataverseEtag?: string;
}

/** A saved document, plus the Dataverse row version after the save when known. */
export interface SavedFlowDocument extends FlowDocument {
  dataverseEtag?: string;
}

/** Which backend Save / Publish write through. */
export type SaveMode = 'flow' | 'dataverse';

export function isSaveMode(value: unknown): value is SaveMode {
  return value === 'flow' || value === 'dataverse';
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
  readonly id: SaveMode;
  /** How the method is named in the UI ("…through the Flow service"). */
  readonly label: string;
  saveDraft(api: IApiProvider, target: FlowTarget, doc: FlowDocument): Promise<SavedFlowDocument>;
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
  id: 'flow',
  label: 'the Flow service',

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

export type DataverseAvailability = { available: true } | { available: false; reason: string };

/**
 * Whether this flow can be written through Dataverse right now: it must be a
 * solution flow (has a workflow id) and the session must hold an unexpired
 * Dataverse token. The reason is shown as the menu item's tooltip.
 */
export function dataverseAvailability(
  api: IApiProvider,
  workflowEntityId: string | undefined | null,
  now: number = Date.now()
): DataverseAvailability {
  if (!workflowEntityId) {
    return { available: false, reason: 'Only solution flows can be saved through Dataverse. This flow is not in a solution.' };
  }
  if (typeof api.request !== 'function') {
    return { available: false, reason: 'Dataverse requests are not supported on this page.' };
  }
  if (!api.endpoints?.hasDataverse) {
    return {
      available: false,
      reason:
        'No Dataverse sign-in captured yet. Open this flow in Power Automate (make.powerautomate.com) ' +
        'and reload that tab so the toolkit can pick it up.',
    };
  }
  const expiresAt = api.endpoints.expiresAt?.dataverse; // epoch ms
  if (expiresAt && expiresAt <= now) {
    return { available: false, reason: 'The Dataverse sign-in has expired. Reload the Power Automate tab to refresh it.' };
  }
  return { available: true };
}

export function strategyFor(mode: SaveMode): FlowSaveStrategy {
  return mode === 'dataverse' ? dataverseSaveStrategy : flowServiceSaveStrategy;
}

/**
 * Pick the strategy for a flow. The Flow service unless the user chose Dataverse
 * for this environment (`preference`) and Dataverse is actually usable for the
 * flow; a Dataverse preference never applies to a flow it cannot handle.
 */
export function selectSaveStrategy(
  api: IApiProvider,
  target: FlowTarget,
  preference: SaveMode = 'flow'
): FlowSaveStrategy {
  if (preference === 'dataverse' && dataverseAvailability(api, target.workflowEntityId).available) {
    return dataverseSaveStrategy;
  }
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
