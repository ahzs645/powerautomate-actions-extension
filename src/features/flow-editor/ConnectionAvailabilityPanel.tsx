import { DefaultButton } from '@fluentui/react/lib/Button';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Spinner } from '@fluentui/react/lib/Spinner';
import { Stack } from '@fluentui/react/lib/Stack';
import { useEffect, useState } from 'react';
import type { IApiProvider } from '../../services/ApiProvider';
import { createRecentRunsClient } from '../run-history/runHistoryApi';
import { getFlowUrl } from './flowPersistence';
import { verifyDataverseEnvironment } from './managedSolutionExport';

export function ConnectionAvailabilityPanel({ api, envId, flowId, onReconnect, onDismiss }: {
  api: IApiProvider; envId: string; flowId: string; onReconnect: () => void; onDismiss: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [checks, setChecks] = useState<Array<{ label: string; result: string }>>();
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const request = api.request;
    setChecks(undefined);
    const runChecks: Array<{ label: string; check: () => Promise<unknown> }> = [
      { label: 'Flow service', check: async () => {
        if (!request || !api.isApiReady) throw new Error('Power Automate sign-in has not been captured.');
        await request({ method: 'GET', url: getFlowUrl(envId, flowId, api.isPowerPlatformApi), signal, retries: 0 });
      } },
      { label: 'Run history', check: async () => createRecentRunsClient(api, { envId, flowId }, signal).list() },
      { label: 'Dataverse', check: async () => {
        const base = api.endpoints?.dataverseApiUrl;
        if (!request || !base || !api.endpoints?.hasDataverse) throw new Error('Dataverse sign-in has not been captured.');
        await verifyDataverseEnvironment(request, base, envId, signal);
      } },
    ];
    void Promise.all(runChecks.map(async ({ label, check }) => {
      try { await check(); return { label, result: 'Available' }; }
      catch (error) { return { label, result: error instanceof Error ? error.message : 'Unavailable' }; }
    })).then(results => { if (!signal.aborted) setChecks(results); });
    return () => controller.abort();
  }, [api, envId, flowId, attempt]);

  return (
    <Panel isOpen onDismiss={onDismiss} headerText="Connection availability" type={PanelType.medium} closeButtonAriaLabel="Close">
      <Stack tokens={{ childrenGap: 12, padding: '16px 0' }}>
        {checks ? <dl aria-live="polite">{checks.map(({ label, result }) => <div key={label}>
          <dt><strong>{label}</strong></dt><dd>{result}</dd>
        </div>)}</dl> : <Spinner label="Checking Power Automate connections…" />}
        <p>Local JSON download and ZIP review are available from the editor.</p>
        <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
          <DefaultButton text="Reconnect" onClick={onReconnect} />
          <DefaultButton text="Check availability" disabled={!checks} onClick={() => setAttempt(old => old + 1)} />
        </Stack>
      </Stack>
    </Panel>
  );
}
