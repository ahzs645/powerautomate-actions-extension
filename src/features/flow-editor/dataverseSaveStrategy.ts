// Experimental: save and publish a solution flow through the Dataverse Web API
// (`workflows` table) instead of the Flow service.
//
// NOT VERIFIED AGAINST A LIVE TENANT (see DataverseFlowService). It is therefore
// only used when the user opted in for the environment, and it is careful:
//   * it never writes without a row version (If-Match); with the version the
//     editor's text is based on, a change made elsewhere is reported as a
//     ConflictError instead of being overwritten;
//   * it refuses rows whose clientdata holds no flow definition (wrong row);
//   * clientdata fields the editor does not manage are carried over;
//   * MissingConnectionReferenceError is thrown before any request is sent, so
//     the caller can fall back to the Flow service;
//   * after saving it re-reads the row and returns what Dataverse stored.

import type { IApiProvider } from '../../services/ApiProvider';
import {
  ConflictError,
  DataverseConnectionReferences,
  DataverseFlowError,
  DataverseFlowService,
  DataverseWorkflow,
  toDataverseConnectionReferences,
} from '../../services/DataverseFlowService';
import type { FlowDocument, FlowSaveStrategy, FlowTarget, SavedFlowDocument } from './flowPersistence';

function serviceFor(api: IApiProvider): DataverseFlowService {
  if (typeof api.request !== 'function') {
    throw new DataverseFlowError('Dataverse requests are not available on this page.');
  }
  return new DataverseFlowService({ request: api.request });
}

function requireWorkflowId(target: FlowTarget): string {
  if (!target.workflowEntityId) {
    throw new DataverseFlowError('This flow is not in a solution, so it cannot be saved through Dataverse.');
  }
  return target.workflowEntityId;
}

/**
 * Whether the stored references say the same thing as the ones the editor sent
 * (same keys, connectors, logical names and runtime source), once both are in
 * the Dataverse shape. Then the editor keeps showing its own (Flow API) shape.
 */
function sameReferences(sent: DataverseConnectionReferences, stored: any): boolean {
  if (!stored || typeof stored !== 'object') return false;
  let storedConverted: DataverseConnectionReferences;
  try {
    storedConverted = toDataverseConnectionReferences(stored);
  } catch {
    return false;
  }
  return JSON.stringify(sortKeys(sent)) === JSON.stringify(sortKeys(storedConverted));
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((out: Record<string, any>, key) => {
      out[key] = sortKeys(value[key]);
      return out;
    }, {});
}

/** The flow document held in a workflow row, or undefined when there is none. */
function documentFromWorkflow(row: DataverseWorkflow): Omit<FlowDocument, 'displayName'> & { displayName?: string } | undefined {
  const properties = row.clientdataParsed?.properties;
  if (!properties || typeof properties !== 'object' || !properties.definition || typeof properties.definition !== 'object') {
    return undefined;
  }
  return {
    displayName: row.name || properties.displayName,
    definition: properties.definition,
    connectionReferences: properties.connectionReferences || {},
  };
}

export const dataverseSaveStrategy: FlowSaveStrategy = {
  id: 'dataverse',
  label: 'Dataverse (experimental)',

  async saveDraft(api, target, doc): Promise<SavedFlowDocument> {
    const workflowId = requireWorkflowId(target);
    // Throws MissingConnectionReferenceError before anything is sent.
    const sentReferences = toDataverseConnectionReferences(doc.connectionReferences);
    const service = serviceFor(api);

    const current = await service.getWorkflow(workflowId);
    if (!documentFromWorkflow(current)) {
      throw new DataverseFlowError(
        'Dataverse returned no flow definition for this workflow, so nothing was saved through Dataverse.'
      );
    }
    // Based on an older version than the one stored now: someone else saved.
    if (target.dataverseEtag && current.etag && current.etag !== target.dataverseEtag) {
      throw new ConflictError();
    }
    const etag = target.dataverseEtag || current.etag;

    const { etag: patchEtag } = await service.saveDraft({
      workflowEntityId: workflowId,
      definition: doc.definition,
      connectionReferences: sentReferences,
      etag,
      existingClientData: current.clientdataParsed,
    });

    // Show what Dataverse stored. The write succeeded, so a failed re-read must
    // not turn it into an error: fall back to the document that was sent.
    let stored: DataverseWorkflow | undefined;
    try {
      stored = await service.getWorkflow(workflowId);
    } catch {
      stored = undefined;
    }
    const storedDoc = stored && documentFromWorkflow(stored);
    if (!storedDoc) {
      return { ...doc, dataverseEtag: patchEtag };
    }
    return {
      displayName: storedDoc.displayName || doc.displayName,
      definition: storedDoc.definition,
      connectionReferences: sameReferences(sentReferences, storedDoc.connectionReferences)
        ? doc.connectionReferences
        : storedDoc.connectionReferences,
      dataverseEtag: stored!.etag || patchEtag,
    };
  },

  async publish(api, target) {
    await serviceFor(api).publish(requireWorkflowId(target));
  },
};

/** Best-effort read of the row version the editor's text now corresponds to. */
export async function readDataverseEtag(api: IApiProvider, workflowEntityId: string): Promise<string | undefined> {
  try {
    return (await serviceFor(api).getWorkflow(workflowEntityId)).etag;
  } catch {
    return undefined;
  }
}
