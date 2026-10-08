import {
  runFlowCheckers,
  summarizeValidation,
  ValidationReport,
} from '../../features/flow-editor/flowValidation';
import {
  flowServiceSaveStrategy,
  parseEditorText,
  selectSaveStrategy,
  toEditorText,
} from '../../features/flow-editor/flowPersistence';
import { SchemaValidationResult } from '../../services/SchemaValidator';

const cleanSchema: SchemaValidationResult = { isValid: true, issues: [], errorCount: 0, warningCount: 0 };
const target = { envId: 'env-1', flowId: 'flow-1' };

const flowError = (name: string) => ({
  errorDescription: `${name} is broken`,
  operationName: name,
  ruleId: 'r',
  fixInstructions: { markdownText: 'fix it', htmlText: '' },
});

function apiMock(post: jest.Mock) {
  return {
    get: jest.fn(),
    getAbsolute: jest.fn(),
    patch: jest.fn(),
    post,
    isApiReady: true,
    isPowerPlatformApi: false,
  };
}

describe('runFlowCheckers', () => {
  it('posts definition and connectionReferences to the check endpoints on the flow path', async () => {
    const post = jest.fn().mockResolvedValue([]);
    const doc = { definition: { actions: {} }, connectionReferences: { shared_office365: { id: 'x' } } };

    await runFlowCheckers(apiMock(post), target, doc);

    const urls = post.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      'providers/Microsoft.ProcessSimple/environments/env-1/flows/flow-1/checkFlowErrors',
      'providers/Microsoft.ProcessSimple/environments/env-1/flows/flow-1/checkFlowWarnings',
    ]);
    for (const call of post.mock.calls) {
      expect(call[1]).toEqual({ properties: doc });
    }
  });

  it('reports a failed check instead of an empty result', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new Error('Access forbidden.'))
      .mockResolvedValueOnce({ value: [flowError('Send')] });

    const checks = await runFlowCheckers(apiMock(post), target, { definition: {}, connectionReferences: {} });

    expect(checks.errorsCheck).toEqual({ status: 'failed', reason: 'Access forbidden.' });
    expect(checks.warningsCheck).toEqual({ status: 'ok', items: [flowError('Send')] });
  });

  it('treats an unrecognised response as a failure', async () => {
    const post = jest.fn().mockResolvedValue({ message: 'html error page' });
    const checks = await runFlowCheckers(apiMock(post), target, { definition: {}, connectionReferences: {} });
    expect(checks.errorsCheck.status).toBe('failed');
  });
});

describe('summarizeValidation', () => {
  const report = (overrides: Partial<ValidationReport>): ValidationReport => ({
    schema: cleanSchema,
    errorsCheck: { status: 'ok', items: [] },
    warningsCheck: { status: 'ok', items: [] },
    ...overrides,
  });

  it('only says "no issues found" when every check ran', () => {
    expect(summarizeValidation(report({}))).toEqual({
      tone: 'success',
      text: 'Validation completed - no issues found.',
    });
  });

  it('never claims success when a flow checker call failed', () => {
    const summary = summarizeValidation(
      report({
        errorsCheck: { status: 'failed', reason: 'Authentication failed' },
        warningsCheck: { status: 'failed', reason: 'Authentication failed' },
      })
    );
    expect(summary.tone).toBe('warning');
    expect(summary.text).toBe(
      'Flow checker unavailable: Authentication failed. Schema check passed, but connector and expression checks did not run.'
    );
    expect(summary.text).not.toMatch(/no issues/i);
  });

  it('combines schema and flow checker counts', () => {
    const summary = summarizeValidation(
      report({
        schema: { ...cleanSchema, isValid: false, errorCount: 1, issues: [] },
        warningsCheck: { status: 'ok', items: [flowError('A'), flowError('B')] },
      })
    );
    expect(summary.tone).toBe('error');
    expect(summary.text).toBe(
      'Validation completed - found 1 error and 2 warnings (flow checker: 2, schema: 1).'
    );
  });
});

describe('flowPersistence', () => {
  it('round-trips the editor text', () => {
    const doc = { displayName: 'A', definition: { actions: {} }, connectionReferences: { c: 1 } };
    const parsed = parseEditorText(toEditorText(doc), 'A');
    expect(parsed).toEqual({ ok: true, doc });
  });

  it('explains why text cannot be saved', () => {
    expect(parseEditorText('{', 'A')).toEqual({ ok: false, error: expect.stringContaining('Invalid JSON') });
    expect(parseEditorText('{}', 'A')).toEqual({
      ok: false,
      error: 'Missing "definition" property in flow definition',
    });
  });

  it('uses the Flow service strategy by default and returns the server document', async () => {
    const patch = jest.fn().mockResolvedValue({
      properties: { displayName: 'Server name', definition: { actions: { X: {} } }, connectionReferences: {} },
    });
    const api = { ...apiMock(jest.fn()), patch };
    const strategy = selectSaveStrategy(api, target);

    expect(strategy).toBe(flowServiceSaveStrategy);
    const saved = await strategy.saveDraft(api, target, {
      displayName: ' Local ',
      definition: { actions: {} },
      connectionReferences: {},
    });

    expect(patch.mock.calls[0][0]).toBe(
      'providers/Microsoft.ProcessSimple/environments/env-1/flows/flow-1?draftFlow=true'
    );
    expect(patch.mock.calls[0][1].properties.displayName).toBe('Local');
    expect(saved.displayName).toBe('Server name');
    expect(saved.definition).toEqual({ actions: { X: {} } });
  });
});
