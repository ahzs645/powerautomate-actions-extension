import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, ApiProviderContext, ApiRequest, IApiProvider } from '../../services/ApiProvider';
import { FlowEditorHost, useFlowEditor } from '../../features/flow-editor/useFlowEditor';
import { StatusMessages } from '../../features/flow-editor/useStatusMessages';

// Jest does not transform node_modules, and @fluentui/react/lib/* is ESM:
// serve the CommonJS build of the same components instead.
jest.mock('@fluentui/react/lib/MessageBar', () => jest.requireActual('@fluentui/react/lib-commonjs/MessageBar'));
jest.mock('@fluentui/react/lib/Button', () => jest.requireActual('@fluentui/react/lib-commonjs/Button'));
jest.mock('@fluentui/react/lib/Checkbox', () => jest.requireActual('@fluentui/react/lib-commonjs/Checkbox'));
jest.mock('@fluentui/react/lib/Link', () => jest.requireActual('@fluentui/react/lib-commonjs/Link'));
jest.mock('@fluentui/react/lib/Styling', () => jest.requireActual('@fluentui/react/lib-commonjs/Styling'));

const ENV = 'env-1';
const FLOW = 'flow-1';
const WF = 'a1b2c3d4-0000-1111-2222-333344445555';

const SOLUTION_REFS = {
  shared_office365: {
    connectionName: 'shared-office365-1',
    source: 'Invoker',
    id: '/providers/Microsoft.PowerApps/apis/shared_office365',
    connectionReferenceLogicalName: 'cr_office365',
  },
};
const PLAIN_REFS = {
  shared_office365: { connectionName: 'shared-office365-1', id: '/providers/Microsoft.PowerApps/apis/shared_office365' },
};
const DEFINITION = { triggers: {}, actions: { Secret_action_name: { type: 'Compose', inputs: 'flow content' } } };

function flowResponse(opts: { solution?: boolean; refs?: any } = {}) {
  return {
    name: FLOW,
    properties: {
      displayName: 'Invoice flow',
      definition: DEFINITION,
      connectionReferences: opts.refs ?? SOLUTION_REFS,
      ...(opts.solution === false ? {} : { workflowEntityId: WF }),
    },
  };
}

function dataverseRow(etag: string) {
  return {
    workflowid: WF,
    name: 'Invoice flow',
    '@odata.etag': etag,
    clientdata: JSON.stringify({ properties: { definition: DEFINITION, connectionReferences: {} }, schemaVersion: '1.0.0.0' }),
  };
}

interface ApiOptions {
  solution?: boolean;
  refs?: any;
  hasDataverse?: boolean;
  patch?: jest.Mock;
  /** Etags returned by successive Dataverse GETs (last one repeats). */
  etags?: string[];
  dataversePatch?: (req: ApiRequest) => any;
}

function makeApi(opts: ApiOptions = {}) {
  const etags = opts.etags ?? ['W/"1"'];
  let gets = 0;
  const dataverseCalls: ApiRequest[] = [];
  const api: IApiProvider = {
    get: jest.fn(async (url: string) => {
      if (url.includes(`/flows/${FLOW}`)) return flowResponse(opts);
      return { properties: { displayName: 'Contoso' } };
    }),
    getAbsolute: jest.fn(),
    patch: opts.patch ?? jest.fn(async (_url: string, body: any) => ({ properties: body.properties })),
    post: jest.fn(async () => ({})),
    isApiReady: true,
    isPowerPlatformApi: false,
    request: jest.fn(async (req: ApiRequest) => {
      dataverseCalls.push(req);
      if (req.method === 'GET') return dataverseRow(etags[Math.min(gets++, etags.length - 1)]);
      if (req.method === 'PATCH') {
        const result = opts.dataversePatch?.(req) ?? { status: 204, body: {}, headers: {}, requestIds: {} };
        if (result instanceof Error) throw result;
        return result;
      }
      return {};
    }) as any,
    endpoints: { hasDataverse: opts.hasDataverse ?? true },
    setWorkflowEntityId: jest.fn(),
    getDiagnostics: jest.fn(async () => 'Power Automate Toolkit diagnostics\n  GET api.flow.microsoft.com 200'),
  };
  return { api, dataverseCalls };
}

let hook: ReturnType<typeof useFlowEditor>;

const Harness: React.FC<{ host: FlowEditorHost }> = ({ host }) => {
  hook = useFlowEditor(host);
  return <StatusMessages messages={hook.messages} onDismiss={hook.dismissMessage} />;
};

async function renderEditor(api: IApiProvider, host: FlowEditorHost = {}) {
  render(
    <ApiProviderContext.Provider value={api}>
      <Harness host={host} />
    </ApiProviderContext.Provider>
  );
  await waitFor(() => expect(hook.savedText).not.toBe(''));
  await screen.findByText(/loaded successfully/);
}

const editedText = () => hook.savedText.replace('flow content', 'edited content');

beforeEach(() => {
  window.history.pushState({}, '', `/?envId=${ENV}&flowId=${FLOW}`);
  window.localStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useFlowEditor: solution flows', () => {
  test('reports the workflow id of a solution flow to the background and keeps it', async () => {
    const { api } = makeApi();
    await renderEditor(api);
    expect(api.setWorkflowEntityId).toHaveBeenCalledWith(WF, FLOW);
    expect(hook.workflowEntityId).toBe(WF);
    expect(hook.saveMethod).toMatchObject({ preference: 'flow', effective: 'flow', dataverseAvailable: true });
  });

  test('does nothing for a flow outside a solution', async () => {
    const { api } = makeApi({ solution: false });
    await renderEditor(api);
    expect(api.setWorkflowEntityId).not.toHaveBeenCalled();
    expect(hook.workflowEntityId).toBeUndefined();
    expect(hook.saveMethod.dataverseAvailable).toBe(false);
    expect(hook.saveMethod.dataverseUnavailableReason).toMatch(/solution flows/);
  });
});

describe('useFlowEditor: Copy diagnostics', () => {
  test('copies the background diagnostics plus editor state, without flow content', async () => {
    const { api } = makeApi();
    await renderEditor(api);
    await act(async () => {
      await hook.copyDiagnostics();
    });
    expect(api.getDiagnostics).toHaveBeenCalled();
    const copied = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0] as string;
    expect(copied).toContain('Power Automate Toolkit diagnostics');
    expect(copied).toContain('Solution flow: yes');
    expect(copied).toContain('Save method: flow');
    expect(copied).not.toContain('Secret_action_name');
    expect(copied).not.toContain('flow content');
    expect(await screen.findByText('Diagnostics copied (no tokens or flow content included)')).toBeInTheDocument();
  });

  test('includes the request ids of the last failure', async () => {
    const patch = jest.fn().mockRejectedValue(new ApiError('Server error (500)', 500, 'Boom', { serviceRequestId: 'svc-500' }));
    const { api } = makeApi({ patch, hasDataverse: false });
    await renderEditor(api);
    await act(async () => {
      await hook.saveDraft(editedText());
    });
    await act(async () => {
      await hook.copyDiagnostics();
    });
    const copied = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0] as string;
    expect(copied).toContain('Last failure: save:flow, HTTP 500, code Boom');
    expect(copied).toContain('Service request id: svc-500');
  });
});

describe('useFlowEditor: save errors', () => {
  test('shows the request id with a Copy details link', async () => {
    const patch = jest.fn().mockRejectedValue(new ApiError('Server error (500)', 500, undefined, { serviceRequestId: 'svc-123' }));
    const { api } = makeApi({ patch, solution: false });
    await renderEditor(api);
    await act(async () => {
      await hook.saveDraft(editedText());
    });
    expect(await screen.findByText(/Error saving flow: Server error \(500\)/)).toBeInTheDocument();
    expect(await screen.findByText('svc-123')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('Copy details'));
    await screen.findByText('Details copied');
    const details = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0] as string;
    expect(details).toContain('Service request id: svc-123');
    expect(details).toContain('HTTP status: 500');
    // Not a solution flow: no Dataverse offer.
    expect(screen.queryByText('Try saving through Dataverse (experimental)')).toBeNull();
  });

  test('offers a one-off Dataverse retry when a Flow service save of a solution flow fails', async () => {
    const patch = jest.fn().mockRejectedValue(new ApiError('Access forbidden.', 403, undefined, { serviceRequestId: 'svc-403' }));
    const { api, dataverseCalls } = makeApi({ patch });
    const onSaved = jest.fn();
    const text = { current: '' };
    await renderEditor(api, { getText: () => text.current, onSaved });
    text.current = editedText();

    let outcome: any;
    await act(async () => {
      outcome = await hook.saveDraft(text.current);
    });
    expect(outcome).toEqual({ ok: false });
    expect(dataverseCalls).toHaveLength(0);

    await act(async () => {
      fireEvent.click(await screen.findByText('Try saving through Dataverse (experimental)'));
    });
    await screen.findByText(/saved through Dataverse \(experimental\)/);
    expect(dataverseCalls.map((c) => c.method)).toEqual(['GET', 'PATCH', 'GET']);
    expect(JSON.parse(dataverseCalls[1].body.clientdata).properties.definition.actions.Secret_action_name.inputs).toBe('edited content');
    expect(onSaved).toHaveBeenCalledWith(text.current, expect.any(String));
    // A one-off: the environment keeps the Flow service.
    expect(hook.saveMethod.preference).toBe('flow');
    expect(window.localStorage.getItem(`flowEditorSaveMode:${ENV}`)).toBeNull();
  });

  test('"Use for this environment" also switches the preference', async () => {
    const patch = jest.fn().mockRejectedValue(new ApiError('Server error (502)', 502));
    const { api } = makeApi({ patch });
    await renderEditor(api);
    await act(async () => {
      await hook.saveDraft(editedText());
    });
    fireEvent.click(await screen.findByLabelText('Use for this environment'));
    await act(async () => {
      fireEvent.click(await screen.findByText('Try saving through Dataverse (experimental)'));
    });
    await screen.findByText(/saved through Dataverse/);
    expect(hook.saveMethod.preference).toBe('dataverse');
    expect(window.localStorage.getItem(`flowEditorSaveMode:${ENV}`)).toBe('dataverse');
  });

  test('does not offer Dataverse when the Flow service rejected the definition (400)', async () => {
    const patch = jest.fn().mockRejectedValue(new ApiError('The template is invalid', 400, 'InvalidTemplate'));
    const { api } = makeApi({ patch });
    await renderEditor(api);
    await act(async () => {
      await hook.saveDraft(editedText());
    });
    expect(await screen.findByText(/The template is invalid/)).toBeInTheDocument();
    expect(screen.queryByText('Try saving through Dataverse (experimental)')).toBeNull();
  });
});

describe('useFlowEditor: Dataverse save method', () => {
  beforeEach(() => {
    window.localStorage.setItem(`flowEditorSaveMode:${ENV}`, 'dataverse');
  });

  test('saves and publishes through Dataverse when chosen for the environment', async () => {
    const { api, dataverseCalls } = makeApi();
    await renderEditor(api);
    await waitFor(() => expect(hook.saveMethod.effective).toBe('dataverse'));
    // The row version the loaded text is based on is recorded.
    await waitFor(() => expect(dataverseCalls.length).toBeGreaterThan(0));

    let outcome: any;
    await act(async () => {
      outcome = await hook.publish(editedText());
    });
    expect(outcome).toMatchObject({ ok: true, method: 'dataverse' });
    expect(api.patch).not.toHaveBeenCalled();
    const patchCall = dataverseCalls.find((c) => c.method === 'PATCH')!;
    expect(patchCall.headers!['If-Match']).toBe('W/"1"');
    expect(dataverseCalls.some((c) => c.url === 'PublishXml')).toBe(true);
    expect(await screen.findByText(/saved and published through Dataverse/)).toBeInTheDocument();
  });

  test('a flow changed elsewhere since loading shows the conflict bar and writes nothing', async () => {
    // Load-time version W/"1"; by the time of saving the row is at W/"2".
    const { api, dataverseCalls } = makeApi({ etags: ['W/"1"', 'W/"2"'] });
    await renderEditor(api);
    await waitFor(() => expect(dataverseCalls.length).toBe(1));

    let outcome: any;
    await act(async () => {
      outcome = await hook.saveDraft(editedText());
    });
    expect(outcome).toEqual({ ok: false });
    expect(dataverseCalls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(api.patch).not.toHaveBeenCalled();
    expect(await screen.findByText(/This flow was changed elsewhere since you loaded it/)).toBeInTheDocument();
    expect(await screen.findByText('Reload')).toBeInTheDocument();
    expect(await screen.findByText('Download my JSON')).toBeInTheDocument();
  });

  test('a 412 from Dataverse also shows the conflict bar', async () => {
    const { api } = makeApi({ dataversePatch: () => new ApiError('Precondition failed', 412, undefined, { serviceRequestId: 'svc-412' }) });
    await renderEditor(api);
    await act(async () => {
      await hook.saveDraft(editedText());
    });
    expect(await screen.findByText(/This flow was changed elsewhere since you loaded it/)).toBeInTheDocument();
    expect(await screen.findByText('svc-412')).toBeInTheDocument();
  });

  test('falls back to the Flow service when references have no logical name', async () => {
    const { api, dataverseCalls } = makeApi({ refs: PLAIN_REFS });
    await renderEditor(api);
    await waitFor(() => expect(hook.saveMethod.effective).toBe('dataverse'));

    let outcome: any;
    await act(async () => {
      outcome = await hook.saveDraft(editedText());
    });
    expect(outcome).toMatchObject({ ok: true, method: 'flow', fallbackReferenceKeys: ['shared_office365'] });
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(dataverseCalls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(await screen.findByText(/saved through the Flow service instead/)).toBeInTheDocument();
    expect(await screen.findByText(/these have none|this one has none/)).toHaveTextContent('shared_office365');
  });

  test('without a Dataverse sign-in the preference is kept but the Flow service is used', async () => {
    const { api, dataverseCalls } = makeApi({ hasDataverse: false });
    await renderEditor(api);
    await waitFor(() => expect(hook.saveMethod.preference).toBe('dataverse'));
    expect(hook.saveMethod.effective).toBe('flow');
    await act(async () => {
      await hook.saveDraft(editedText());
    });
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(dataverseCalls).toHaveLength(0);
  });
});
