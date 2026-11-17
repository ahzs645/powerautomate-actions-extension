import JSZip from 'jszip';
import { ApiError } from '../../services/ApiProvider';
import { fetchRunPayload } from './runPayload';
import { buildRunWorkbook, WorkbookCell, WorkbookSheet } from './runWorkbook';
import {
  createRunHistoryClient, DefinitionAction, RunHistoryApi, RunRange, RunRecord, RunTarget, RuntimeProperties, StepProperties,
} from './runHistoryApi';

export type ExportProgress =
  | { phase: 'history'; scanned: number; matched: number }
  | { phase: 'details'; done: number; total: number }
  | { phase: 'archive' };

interface ExportOptions extends RunTarget {
  from: string;
  through: string;
  includePayloads: boolean;
  format?: 'zip' | 'xlsx';
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
}

interface ExportIssue {
  runId: string;
  step?: string;
  part: 'run details' | 'iterations' | 'inputs' | 'outputs';
  httpStatus?: number;
}

type PayloadState = 'included' | 'secured' | 'unavailable';

export function localDateInput(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
}

export function getRunRange(from: string, through: string): RunRange {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${through}T00:00:00`);
  if (localDateInput(start) !== from || localDateInput(end) !== through || start > end) {
    throw new Error('Choose a valid start and end date. The end date must be on or after the start date.');
  }
  // Use the next local midnight so daylight saving transitions are handled.
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), endExclusive: end.getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

function timing(p: RuntimeProperties) {
  const duration = Date.parse(p.endTime ?? '') - Date.parse(p.startTime ?? '');
  return {
    status: p.status,
    startTime: p.startTime,
    endTime: p.endTime,
    durationMs: Number.isFinite(duration) && duration >= 0 ? duration : undefined,
    code: p.code,
    error: p.error && { code: p.error.code, message: p.error.message },
    correlation: p.correlation,
    trackingId: p.trackingId,
    retryHistory: p.retryHistory?.map(({ code, startTime, endTime, clientRequestId, serviceRequestId, error }) => ({
      code, startTime, endTime, clientRequestId, serviceRequestId,
      error: error && { code: error.code, message: error.message },
    })),
  };
}

function csvRow(values: (string | number | boolean | undefined)[]) {
  return values.map(value => {
    let text = String(value ?? '');
    // Keep service-provided labels and error codes inert in spreadsheets.
    if (typeof value === 'string' && /^(\s*[=+@-]|[\r\n\t])/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(',');
}

function loopNames(actions?: Record<string, DefinitionAction>, names = new Set<string>()): Set<string> {
  for (const [name, action] of Object.entries(actions ?? {})) {
    if (action.type === 'Foreach' || action.type === 'Until') names.add(name);
    loopNames(action.actions, names);
    loopNames(action.else?.actions, names);
    loopNames(action.default?.actions, names);
    for (const branch of Object.values(action.cases ?? {})) loopNames(branch.actions, names);
  }
  return names;
}

function iterationCount(step: StepProperties) {
  return step.iterationCount ?? step.inputsLink?.metadata?.foreachItemsCount ?? step.repetitionCount;
}

async function collectPayloads(
  step: StepProperties, stepName: string, runId: string, options: ExportOptions, issues: ExportIssue[],
) {
  const payloadStatus: Partial<Record<'inputs' | 'outputs', PayloadState>> = {};
  const payloads: Partial<Record<'inputs' | 'outputs', unknown>> = {};
  for (const part of ['inputs', 'outputs'] as const) {
    const link = step[part === 'inputs' ? 'inputsLink' : 'outputsLink'];
    if (link?.secureData) {
      payloadStatus[part] = 'secured';
    } else if (step[part] !== undefined) {
      payloads[part] = step[part];
      payloadStatus[part] = 'included';
    } else if (link?.uri) {
      try {
        payloads[part] = await fetchRunPayload(link.uri, options.signal);
        payloadStatus[part] = 'included';
      } catch (error) {
        options.signal.throwIfAborted();
        issues.push({ runId, step: stepName, part, httpStatus: error instanceof ApiError ? error.status : undefined });
        payloadStatus[part] = 'unavailable';
      }
    }
  }
  return { ...payloads, payloadStatus };
}

type RunClient = ReturnType<typeof createRunHistoryClient>;

async function collectRun(client: RunClient, run: RunRecord, options: ExportOptions) {
  const issues: ExportIssue[] = [];
  const steps: WorkbookCell[][] = [];
  const summary = { runId: run.name, ...timing(run.properties) };
  let detail: RunRecord;
  try {
    detail = await client.detail(run, options.includePayloads);
  } catch (error) {
    options.signal.throwIfAborted();
    issues.push({ runId: run.name, part: 'run details', httpStatus: error instanceof ApiError ? error.status : undefined });
    return { summary, issues, steps, detail: { ...summary, detailAvailable: false } };
  }

  const { trigger, actions, flow } = detail.properties;
  const scopes = loopNames(flow?.properties?.definition?.actions);
  const recordStep = async (name: string, kind: 'trigger' | 'action' | 'iteration', step: StepProperties) => {
    const meta = timing(step);
    const count = iterationCount(step);
    const indexes = step.repetitionIndexes;
    const contents = options.includePayloads
      ? await collectPayloads(step, name, run.name, options, issues)
      : undefined;
    const row: WorkbookCell[] = [
      name, kind, indexes?.map(index => `${index.scopeName}[${index.itemIndex}]`).join(' / '),
      meta.status, meta.startTime, meta.endTime, meta.durationMs, meta.code, meta.error?.code,
      meta.correlation?.actionTrackingId, count, step.retryHistory?.length,
      contents?.payloadStatus.inputs, contents?.payloadStatus.outputs,
    ];
    if (options.format === 'xlsx') {
      row.push(meta.error?.message);
      if (options.includePayloads) row.push(JSON.stringify(contents?.inputs), JSON.stringify(contents?.outputs));
    }
    steps.push(row);
    return { name, kind, ...meta, repetitionCount: count, repetitionIndexes: indexes, ...contents };
  };

  const actionLogs = [];
  const triggerLog = trigger ? await recordStep(trigger.name ?? 'Trigger', 'trigger', trigger) : undefined;
  for (const [name, action] of Object.entries(actions ?? {})) {
    options.signal.throwIfAborted();
    const log = await recordStep(name, 'action', action);
    const iterations = [];
    if (log.repetitionCount && log.repetitionCount > 0) {
      try {
        const isScope = scopes.has(name) || action.inputsLink?.metadata?.foreachItemsCount !== undefined;
        for (const repetition of await client.repetitions(run, name, isScope)) {
          iterations.push(await recordStep(name, 'iteration', repetition));
        }
        if (iterations.length < log.repetitionCount) issues.push({ runId: run.name, step: name, part: 'iterations' });
      } catch (error) {
        options.signal.throwIfAborted();
        issues.push({ runId: run.name, step: name, part: 'iterations', httpStatus: error instanceof ApiError ? error.status : undefined });
      }
    }
    actionLogs.push({ ...log, iterations: iterations.length ? iterations : undefined });
  }
  return {
    summary: { runId: run.name, ...timing({ ...run.properties, ...detail.properties }) },
    issues,
    steps,
    flowName: flow?.properties?.displayName,
    detail: { ...summary, ...timing({ ...run.properties, ...detail.properties }), detailAvailable: true, trigger: triggerLog, actions: actionLogs },
  };
}

export async function exportRunHistory(api: RunHistoryApi, options: ExportOptions) {
  const range = getRunRange(options.from, options.through);
  const client = createRunHistoryClient(api, options, options.signal);
  options.onProgress({ phase: 'history', scanned: 0, matched: 0 });
  const runs = await client.list(range, (scanned, matched) => options.onProgress({ phase: 'history', scanned, matched }));
  if (!runs.length) return null;

  const zip = new JSZip();
  const runHeader = ['run_id', 'status', 'start_time_utc', 'end_time_utc', 'duration_ms', 'code', 'error_code', 'client_tracking_id', 'detail_available'];
  const stepHeader = ['step', 'kind', 'iteration', 'status', 'start_time_utc', 'end_time_utc', 'duration_ms', 'code', 'error_code', 'action_tracking_id', 'repetition_count', 'retry_count', 'inputs', 'outputs'];
  const runRows = [runHeader.join(',')];
  const stepRows = [['run_id', ...stepHeader].join(',')];
  const summarySheet: WorkbookSheet = { name: 'Runs', rows: [[...runHeader, 'error_message']], links: [] };
  const sheets = [summarySheet];
  const issues: ExportIssue[] = [];
  let flowName: string | undefined;
  let done = 0;

  // Bound network concurrency and keep large payloads out of the CSV summaries.
  const concurrency = 3;
  const collect = async (run: RunRecord) => {
    const result = await collectRun(client, run, options);
    options.signal.throwIfAborted();
    options.onProgress({ phase: 'details', done: ++done, total: runs.length });
    return result;
  };
  options.onProgress({ phase: 'details', done, total: runs.length });
  for (let offset = 0; offset < runs.length; offset += concurrency) {
    options.signal.throwIfAborted();
    const batch = await Promise.all(runs.slice(offset, offset + concurrency).map(collect));
    for (const result of batch) {
      const { summary: row, detail } = result;
      flowName ??= result.flowName;
      const cells = [
        row.runId, row.status, row.startTime, row.endTime, row.durationMs, row.code, row.error?.code,
        row.correlation?.clientTrackingId, detail.detailAvailable,
      ];
      for (const issue of result.issues) issues.push(issue);
      if (options.format === 'xlsx') {
        const sheetName = `Run ${sheets.length}`;
        const columns = [...stepHeader, 'error_message'];
        if (options.includePayloads) columns.push('inputs_json', 'outputs_json');
        summarySheet.rows.push([...cells, row.error?.message]);
        summarySheet.links?.push({ row: summarySheet.rows.length, target: sheetName });
        sheets.push({ name: sheetName, rows: [columns, ...result.steps] });
      } else {
        runRows.push(csvRow(cells));
        for (const step of result.steps) stepRows.push(csvRow([row.runId, ...step]));
        zip.file(`runs/${row.runId}.json`, JSON.stringify(detail, null, 2));
      }
    }
  }

  const fileStem = `flow-runs-${options.flowId}-${options.from}_${options.through}`;
  options.onProgress({ phase: 'archive' });
  if (options.format === 'xlsx') {
    if (issues.length) sheets.push({ name: 'Export issues', rows: [['run_id', 'step', 'part', 'http_status'],
      ...issues.map(issue => [issue.runId, issue.step, issue.part, issue.httpStatus])] });
    const blob = await buildRunWorkbook(sheets);
    options.signal.throwIfAborted();
    return { blob, fileName: `${fileStem}.xlsx`, runCount: runs.length, issueCount: issues.length };
  }
  zip.file('runs.csv', '\uFEFF' + runRows.join('\r\n'));
  zip.file('steps.csv', '\uFEFF' + stepRows.join('\r\n'));
  zip.file('manifest.json', JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    environmentId: options.envId,
    flowId: options.flowId,
    flowName,
    range: {
      from: options.from, through: options.through, timeZone: range.timeZone,
      startUtc: new Date(range.start).toISOString(), endExclusiveUtc: new Date(range.endExclusive).toISOString(),
    },
    includePayloads: options.includePayloads,
    runCount: runs.length,
    stepCount: stepRows.length - 1,
    issues,
  }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  options.signal.throwIfAborted();
  return {
    blob,
    fileName: `${fileStem}.zip`,
    runCount: runs.length,
    issueCount: issues.length,
  };
}
