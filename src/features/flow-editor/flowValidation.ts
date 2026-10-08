// Runs the three checks behind "Validate" and turns them into one honest summary.
//
// The Flow service's checkFlowErrors / checkFlowWarnings calls can fail (expired
// token, no permission, throttling). Those failures used to be swallowed into an
// empty list, so a check that never ran read as "no issues found".

import { IApiProvider } from '../../services/ApiProvider';
import type { DiagnosticRequestIds } from '../../services/Diagnostics';
import { SchemaValidationResult } from '../../services/SchemaValidator';
import { FlowDocument, FlowTarget, getFlowUrl } from './flowPersistence';
import { FlowError } from './types';

export type CheckOutcome =
  | { status: 'ok'; items: FlowError[] }
  | { status: 'failed'; reason: string; httpStatus?: number; code?: string; requestIds?: DiagnosticRequestIds };

export interface ValidationReport {
  schema: SchemaValidationResult;
  errorsCheck: CheckOutcome;
  warningsCheck: CheckOutcome;
}

export type SummaryTone = 'success' | 'warning' | 'error';

export interface ValidationSummary {
  tone: SummaryTone;
  text: string;
}

async function runCheck(api: IApiProvider, url: string, payload: unknown): Promise<CheckOutcome> {
  try {
    const response = await api.post(url, payload);
    const items = Array.isArray(response)
      ? response
      : Array.isArray(response?.value)
        ? response.value
        : null;
    if (!items) {
      return { status: 'failed', reason: 'unexpected response from the flow checker' };
    }
    return { status: 'ok', items };
  } catch (error) {
    const details = error as { status?: number; code?: string; requestIds?: DiagnosticRequestIds };
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      ...(typeof details?.status === 'number' ? { httpStatus: details.status } : {}),
      ...(details?.code ? { code: details.code } : {}),
      ...(details?.requestIds ? { requestIds: details.requestIds } : {}),
    };
  }
}

/** Ask the Flow service for errors and warnings; each check reports its own outcome. */
export async function runFlowCheckers(
  api: IApiProvider,
  target: FlowTarget,
  doc: Pick<FlowDocument, 'definition' | 'connectionReferences'>
): Promise<Pick<ValidationReport, 'errorsCheck' | 'warningsCheck'>> {
  // The checker resolves connector operations through connectionReferences;
  // without them every connector action is reported as unknown.
  const payload = {
    properties: {
      definition: doc.definition,
      connectionReferences: doc.connectionReferences || {},
    },
  };
  // getFlowUrl carries ?draftFlow=true; the check endpoints hang off the flow path.
  const base = getFlowUrl(target.envId, target.flowId, api.isPowerPlatformApi).split('?')[0];
  const [errorsCheck, warningsCheck] = await Promise.all([
    runCheck(api, `${base}/checkFlowErrors`, payload),
    runCheck(api, `${base}/checkFlowWarnings`, payload),
  ]);
  return { errorsCheck, warningsCheck };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function countIssues(report: ValidationReport) {
  const apiErrors = report.errorsCheck.status === 'ok' ? report.errorsCheck.items.length : 0;
  const apiWarnings = report.warningsCheck.status === 'ok' ? report.warningsCheck.items.length : 0;
  return {
    apiErrors,
    apiWarnings,
    schemaErrors: report.schema.errorCount,
    schemaWarnings: report.schema.warningCount,
    errors: apiErrors + report.schema.errorCount,
    warnings: apiWarnings + report.schema.warningCount,
  };
}

/** The first failed check that carries request ids (for "Copy details"). */
export function failedCheckWithRequestIds(report: ValidationReport) {
  for (const check of [report.errorsCheck, report.warningsCheck]) {
    if (check.status === 'failed' && check.requestIds) {
      return { status: check.httpStatus, code: check.code, requestIds: check.requestIds };
    }
  }
  return undefined;
}

/** Reasons the Flow service checks did not run, de-duplicated. */
export function checkerFailures(report: ValidationReport): string[] {
  const reasons: string[] = [];
  for (const check of [report.errorsCheck, report.warningsCheck]) {
    if (check.status !== 'failed') continue;
    // Reasons are joined into a sentence, so drop their own closing full stop.
    const reason = check.reason.replace(/[.\s]+$/, '');
    if (reasons.indexOf(reason) < 0) reasons.push(reason);
  }
  return reasons;
}

/**
 * One status line covering all three checks. "No issues found" is only ever
 * claimed when the schema check and both Flow service checks actually ran.
 */
export function summarizeValidation(report: ValidationReport): ValidationSummary {
  const counts = countIssues(report);
  const failures = checkerFailures(report);

  if (failures.length > 0) {
    const schemaPart =
      counts.schemaErrors + counts.schemaWarnings > 0
        ? `Schema check found ${plural(counts.schemaErrors, 'error')} and ${plural(counts.schemaWarnings, 'warning')}.`
        : 'Schema check passed, but connector and expression checks did not run.';
    const ranPart =
      counts.apiErrors + counts.apiWarnings > 0
        ? ` Flow checker reported ${plural(counts.apiErrors, 'error')} and ${plural(counts.apiWarnings, 'warning')} before failing.`
        : '';
    return {
      tone: counts.errors > 0 ? 'error' : 'warning',
      text: `Flow checker unavailable: ${failures.join('; ')}. ${schemaPart}${ranPart}`,
    };
  }

  if (counts.errors + counts.warnings === 0) {
    return { tone: 'success', text: 'Validation completed - no issues found.' };
  }

  return {
    tone: counts.errors > 0 ? 'error' : 'warning',
    text:
      `Validation completed - found ${plural(counts.errors, 'error')} and ${plural(counts.warnings, 'warning')} ` +
      `(flow checker: ${counts.apiErrors + counts.apiWarnings}, schema: ${counts.schemaErrors + counts.schemaWarnings}).`,
  };
}
