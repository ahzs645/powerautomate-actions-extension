import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecentRunsPanel, { recentRunHistoryUrl } from '../../features/run-history/RecentRunsPanel';
import { createRecentRunsClient } from '../../features/run-history/runHistoryApi';
import type { RunHistoryApi } from '../../features/run-history/runHistoryApi';
import type { ApiRequest } from '../../services/ApiProvider';

jest.mock('@fluentui/react/lib/Button', () => jest.requireActual('@fluentui/react/lib-commonjs/Button'));
jest.mock('@fluentui/react/lib/Checkbox', () => jest.requireActual('@fluentui/react/lib-commonjs/Checkbox'));
jest.mock('@fluentui/react/lib/Link', () => jest.requireActual('@fluentui/react/lib-commonjs/Link'));
jest.mock('@fluentui/react/lib/MessageBar', () => jest.requireActual('@fluentui/react/lib-commonjs/MessageBar'));
jest.mock('@fluentui/react/lib/Panel', () => jest.requireActual('@fluentui/react/lib-commonjs/Panel'));
jest.mock('@fluentui/react/lib/Spinner', () => jest.requireActual('@fluentui/react/lib-commonjs/Spinner'));
jest.mock('@fluentui/react/lib/Stack', () => jest.requireActual('@fluentui/react/lib-commonjs/Stack'));
jest.mock('@fluentui/react/lib/Styling', () => jest.requireActual('@fluentui/react/lib-commonjs/Styling'));

const target = { envId: 'env-a', flowId: 'flow-a' };
const endpoints = { hasDataverse: false, legacyApiUrl: 'https://canada.api.flow.microsoft.com' };
const failedRun = {
  name: 'run-failed',
  properties: { status: 'Failed', startTime: '2026-04-03T12:00:00Z', endTime: '2026-04-03T12:00:12Z' },
};

function show(api: RunHistoryApi, isOpen = true, flowId = target.flowId) {
  return <RecentRunsPanel {...target} flowId={flowId} api={api} isOpen={isOpen} onDismiss={() => undefined} />;
}

beforeAll(() => jest.requireActual('@fluentui/react/lib-commonjs/Icons').initializeIcons());

test('lists at most 10 runs from a single page and loads only step metadata on expansion', async () => {
  const request = jest.fn(async ({ url }: ApiRequest) => new URL(url).pathname.endsWith('/runs') ? {
    nextLink: `${endpoints.legacyApiUrl}/unused`,
    value: [failedRun, ...Array.from({ length: 12 }, (_, index) => ({
      name: `run-${index}`,
      properties: { status: 'Succeeded', startTime: '2026-04-02T12:00:00Z' },
    }))],
  } : {
    ...failedRun,
    properties: {
      ...failedRun.properties,
      error: { message: 'Run failed' },
      actions: { Connector_call: {
        status: 'Failed', error: { details: [{ message: 'Connector unavailable' }] },
        inputs: 'secret input', outputs: 'secret output',
      } },
    },
  });
  render(show({ request: request as RunHistoryApi['request'], endpoints }));

  await screen.findByText('12s', { exact: false });
  expect(screen.getAllByText('Succeeded')).toHaveLength(9);
  expect(request).toHaveBeenCalledTimes(1);
  const listUrl = new URL(request.mock.calls[0][0].url);
  expect(listUrl.searchParams.get('$top')).toBe('10');

  fireEvent.click(screen.getByText('Failed'));
  await screen.findByText('Connector unavailable');
  expect(screen.getByText('Run failed')).toBeInTheDocument();
  expect(screen.queryByText('secret input')).toBeNull();
  expect(screen.queryByText('secret output')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
  const detailUrl = new URL(request.mock.calls[1][0].url);
  expect(detailUrl.searchParams.get('$expand')).toBe('properties/actions');
  expect(screen.getAllByRole('link', { name: 'Open run in Power Automate' })[0]).toHaveAttribute(
    'href', 'https://make.powerautomate.com/environments/env-a/flows/flow-a/runs/run-failed',
  );
});

test('aborts in-flight detail requests when switching flows and history requests on close', async () => {
  const request = jest.fn(({ url }: ApiRequest) => {
    if (url.includes('/flow-a/runs?')) return Promise.resolve({ value: [failedRun] });
    return new Promise(() => undefined);
  });
  const api = { request: request as RunHistoryApi['request'], endpoints };
  const { rerender } = render(show(api));
  await screen.findByText('Failed');
  fireEvent.click(screen.getByText('Failed'));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  const detailSignal = request.mock.calls[1][0].signal;
  expect(detailSignal?.aborted).toBe(false);

  rerender(show(api, true, 'flow-b'));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(detailSignal?.aborted).toBe(true);
  expect(request.mock.calls[2][0].url).toContain('/flow-b/runs');
  expect(screen.queryByText('Failed')).toBeNull();

  const nextSignal = request.mock.calls[2][0].signal;
  rerender(show(api, false, 'flow-b'));
  expect(nextSignal?.aborted).toBe(true);
});

test('keeps solution URLs on the right cloud for the selected flow and drops other origins', () => {
  expect(recentRunHistoryUrl(target, 'https://make.high.powerapps.us/environments/env-a/solutions/sol-a/flows/shared/flow-a/edit'))
    .toBe('https://make.high.powerautomate.us/environments/env-a/solutions/sol-a/flows/shared/flow-a/runs');
  expect(recentRunHistoryUrl(target, 'https://wrong.example.com')).toBeUndefined();
  expect(recentRunHistoryUrl(target, undefined, 'https://gov.api.flow.microsoft.us'))
    .toBe('https://make.gov.powerautomate.us/environments/env-a/flows/flow-a/runs');
  expect(recentRunHistoryUrl(target, undefined, 'https://unitedstates.api.powerapps.com'))
    .toBe('https://make.powerautomate.com/environments/env-a/flows/flow-a/runs');
});

test('uses the environment-scoped Power Platform endpoint when it is the only captured audience', async () => {
  const request = jest.fn(async (_request: ApiRequest) => ({ value: [] }));
  const api = {
    request: request as RunHistoryApi['request'],
    endpoints: { hasDataverse: false, powerPlatformApiUrl: 'https://en.va.environment.api.powerplatform.com' },
  };
  const signal = new AbortController().signal;
  await expect(createRecentRunsClient(api, target, signal).list()).resolves.toEqual([]);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    method: 'GET', audience: 'powerPlatform', url: expect.stringContaining('/powerautomate/flows/flow-a/runs'), signal,
  }));
  expect(() => createRecentRunsClient(api, { ...target, envId: 'env-b' }, signal)).toThrow('Open or refresh');
  expect(request).toHaveBeenCalledTimes(1);
});

test('filters runs, sorts step durations, jumps to a failure, and copies a nested output expression on demand', async () => {
  const request = jest.fn(async ({ url }: ApiRequest) => new URL(url).pathname.endsWith('/runs') ? {
    value: [failedRun, { name: 'ok', properties: { status: 'Succeeded', startTime: failedRun.properties.startTime } }],
  } : {
    ...failedRun,
    properties: { actions: {
      First_failure: { status: 'Failed', startTime: '2026-04-03T12:00:00Z', endTime: '2026-04-03T12:00:00.200Z' },
      Slow_lookup: { status: 'Succeeded', startTime: '2026-04-03T12:00:01Z', endTime: '2026-04-03T12:00:11Z', outputs: { "item's id": 42 } },
    } },
  });
  const showFailed = jest.fn(() => true);
  const writeText = jest.fn().mockResolvedValue(undefined);
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<RecentRunsPanel {...target} api={{ request: request as RunHistoryApi['request'], endpoints }} isOpen
      onDismiss={() => undefined} onRevealStep={showFailed} />);
    await screen.findByText('Succeeded');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Failed runs only' }));
    expect(screen.queryByText('Succeeded')).toBeNull();
    fireEvent.click(screen.getByText('Failed'));
    await screen.findByText('200 ms', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: 'Jump to failed step' }));
    expect(document.activeElement).toHaveTextContent('First_failure');
    fireEvent.click(screen.getByText('Show failed step in editor'));
    expect(showFailed).toHaveBeenCalledWith(expect.objectContaining({ name: 'First_failure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slowest steps first' }));
    expect(screen.getByRole('list', { name: 'Run steps' }).firstElementChild).toHaveTextContent('Slow_lookup');
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getAllByText('Inspect output')[0]);
    await screen.findByText("item's id");
    fireEvent.click(screen.getByText("item's id"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("outputs('Slow_lookup')?['item''s id']"));
    expect(new URL(request.mock.calls[2][0].url).searchParams.get('$expand')).toContain('properties/contents');
  } finally {
    if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
