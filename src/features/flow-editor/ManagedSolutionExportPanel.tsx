import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Dropdown } from '@fluentui/react/lib/Dropdown';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Spinner } from '@fluentui/react/lib/Spinner';
import { Stack } from '@fluentui/react/lib/Stack';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { useEffect, useRef, useState } from 'react';
import type { IApiProvider } from '../../services/ApiProvider';
import { downloadBlob, downloadText } from './browserActions';
import { deploymentSettings, ExportableSolution, listExportableSolutions, PreparedSolution, prepareManagedSolution } from './managedSolutionExport';
import { reviewSolutionPackage, SolutionPackageReview } from './solutionPackageReview';

interface Props {
  api: Pick<IApiProvider, 'request' | 'endpoints'>;
  envId: string;
  workflowId?: string;
  flowName: string;
  isDirty: boolean;
  onDismiss: () => void;
  onReconnect: () => void;
}

const reviewClass = mergeStyles({
  overflowWrap: 'anywhere',
  selectors: {
    'h3': { marginBottom: 8 },
    'li': { marginBottom: 8 },
  },
});

const safeFileStem = (value: string) => value.replace(/[^a-z\d._-]/gi, '_');
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

type SolutionList = { status: 'loading' } | { status: 'ready'; items: ExportableSolution[]; scope: string } | { status: 'error'; message: string };

function PackageReview({ review }: { review: SolutionPackageReview }) {
  const bindingRows = review.connections.filter(reference => reference.uses.length > 0);
  const extraBindings = review.connections.filter(reference => !reference.uses.length);
  const enabledFlows = review.flows.filter(flow => flow.enabled).map(flow => flow.name);
  return (
    <div className={reviewClass}>
      <h2>{review.uniqueName}</h2>
      <p>{review.managed ? 'Managed solution' : 'Unmanaged solution'} · {review.version} · {review.flows.length} cloud {review.flows.length === 1 ? 'flow' : 'flows'}</p>
      {review.flows.length > 0 && (
        <details>
          <summary>Included flows</summary>
          <ul>{review.flows.map(flow => <li key={`${flow.id}:${flow.name}`}>{flow.name}{flow.enabled === undefined ? '' : flow.enabled ? ' · On' : ' · Off'}</li>)}</ul>
        </details>
      )}
      {review.otherComponents.length > 0 && (
        <details>
          <summary>Other included components ({review.otherComponents.length})</summary>
          <ul>{review.otherComponents.map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}</ul>
        </details>
      )}
      {enabledFlows.length > 0 && <MessageBar messageBarType={MessageBarType.warning}>
        Flows exported as on can turn on during a new import once connections are mapped. Review the target destinations first.
      </MessageBar>}

      <h3>Connections to map</h3>
      {bindingRows.length > 0 ? (
        <ul>{bindingRows.map(reference => (
          <li key={reference.name + reference.uses[0].flow}>
            <strong>{reference.connector || reference.label}</strong>{reference.connector && reference.label !== reference.connector ? ` · ${reference.label}` : ''}
            <div><code>{reference.name}</code>{!reference.included && ' · Reference missing from the package'}</div>
            <details>
              <summary>Where used</summary>
              <ul>{reference.uses.map(use => (
                <li key={`${use.flow}:${use.alias}`}><code>{use.alias}</code> · {use.flow}
                  <ul>{use.steps.map(step => <li key={step}>{step}</li>)}</ul>
                </li>
              ))}</ul>
            </details>
          </li>
        ))}</ul>
      ) : <p>No connection use was detected in the packaged flows.</p>}
      {extraBindings.length > 0 && (
        <details>
          <summary>{extraBindings.length} additional {extraBindings.length === 1 ? 'reference' : 'references'} in the solution</summary>
          <ul>{extraBindings.map(reference => <li key={reference.name}>{reference.label} · <code>{reference.name}</code></li>)}</ul>
        </details>
      )}

      <h3>Environment variables</h3>
      {review.environmentVariables.length > 0 ? (
        <ul>{review.environmentVariables.map(variable => (
          <li key={variable.name}><strong>{variable.label}</strong> · <code>{variable.name}</code>
            <div>{variable.hasCurrentValue ? 'Review the packaged value for the target environment.' :
              variable.hasDefault ? 'Review the packaged default for the target environment.' : 'Supply a value in the target environment.'}</div>
          </li>
        ))}</ul>
      ) : <p>No environment variables are packaged.</p>}

      {review.destinations.length > 0 && (
        <>
          <h3>Fixed settings to review</h3>
          <p>These settings are embedded in the flow and may still point to the source environment. Review or parameterize them before sharing. The preview hides the values.</p>
          <ul>{review.destinations.map(destination => (
            <li key={`${destination.flow}:${destination.setting}`}>
              <details>
                <summary>{destination.setting} · {destination.steps.length} {destination.steps.length === 1 ? 'step' : 'steps'}</summary>
                <div>{destination.flow}</div>
                <ul>{destination.steps.map(step => <li key={step}>{step}</li>)}</ul>
              </details>
            </li>
          ))}</ul>
        </>
      )}

      {review.requiredComponents.length > 0 && (
        <>
          <h3>Dependencies required in the target</h3>
          <ul>{review.requiredComponents.map((component, index) => <li key={`${index}:${component}`}>{component}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** Mounted only while open so a new review never inherits a previous export. */
export function ManagedSolutionExportPanel({ api, envId, workflowId, flowName, isDirty, onDismiss, onReconnect }: Props) {
  const request = api.request;
  const { dataverseApiUrl, hasDataverse } = api.endpoints ?? {};
  const expiresAt = api.endpoints?.expiresAt?.dataverse;
  const canExport = !!(workflowId && request && dataverseApiUrl && hasDataverse && (!expiresAt || expiresAt > Date.now()));
  const scope = `${dataverseApiUrl}/${envId}/${workflowId}`;
  const [list, setList] = useState<SolutionList>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [solutionName, setSolutionName] = useState('');
  const [packageData, setPackageData] = useState<(PreparedSolution & { local: boolean }) | null>(null);
  const [working, setWorking] = useState<'export' | 'review' | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canExport || !request || !workflowId || !dataverseApiUrl) return;
    const controller = new AbortController();
    setList({ status: 'loading' });
    listExportableSolutions(request, dataverseApiUrl, envId, workflowId, controller.signal).then(items => {
      if (!controller.signal.aborted) setList({ status: 'ready', items, scope });
    }).catch(reason => {
      if (!controller.signal.aborted) setList({ status: 'error', message: errorText(reason) });
    });
    return () => controller.abort();
  }, [canExport, request, workflowId, dataverseApiUrl, envId, scope, retry]);

  useEffect(() => () => active.current?.abort(), []);

  const solutions = list.status === 'ready' && list.scope === scope ? list.items : [];
  const chosen = solutions.find(solution => solution.uniqueName === solutionName) ?? (solutions.length === 1 ? solutions[0] : undefined);

  async function review(mode: 'export' | 'review', prepare: (signal: AbortSignal) => Promise<PreparedSolution>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setWorking(mode);
    setPackageData(null);
    setError('');
    try {
      const data = await prepare(controller.signal);
      if (!controller.signal.aborted) setPackageData({ ...data, local: mode === 'review' });
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason));
    } finally {
      active.current = undefined;
      if (!controller.signal.aborted) setWorking(null);
    }
  }

  function prepareExport() {
    if (!request || !chosen || !workflowId || !canExport) return;
    void review('export', signal => prepareManagedSolution(request, chosen, workflowId, signal));
  }

  function reviewExisting(file: File | undefined) {
    if (!file) return;
    void review('review', async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, review: await reviewSolutionPackage(bytes) };
    });
  }

  const settings = packageData && deploymentSettings(packageData.review);
  const fileStem = packageData && safeFileStem(`${packageData.review.uniqueName}_${packageData.review.version.replace(/\./g, '_')}`);

  return (
    <Panel isOpen onDismiss={onDismiss} type={PanelType.large} headerText="Export managed solution" closeButtonAriaLabel="Close export panel">
      <Stack tokens={{ childrenGap: 12, padding: '12px 0' }}>
        <p>{flowName}</p>
        {workflowId && !canExport && <MessageBar messageBarType={MessageBarType.info} actions={<DefaultButton text="Reconnect" onClick={onReconnect} />}>
          Open the flow in Power Automate and reconnect to Dataverse to export. You can also review a ZIP from disk.
        </MessageBar>}
        {!workflowId && <MessageBar messageBarType={MessageBarType.info}>
          Add this flow to an unmanaged solution in Power Automate to export it as managed. You can also review a ZIP from disk.
        </MessageBar>}
        {canExport && list.status === 'loading' && <Spinner label="Finding unmanaged solutions containing this flow…" />}
        {canExport && list.status === 'error' && <MessageBar messageBarType={MessageBarType.error}
          actions={<DefaultButton text="Retry" onClick={() => setRetry(count => count + 1)} />}>
          Could not list solutions. {list.message}
        </MessageBar>}
        {canExport && list.status === 'ready' && solutions.length === 0 && <MessageBar messageBarType={MessageBarType.info}>
          Add this flow to a named unmanaged solution in Power Automate, then reopen the export panel.
        </MessageBar>}
        {canExport && solutions.length > 0 && (
          <>
            <Dropdown label="Unmanaged solution" placeholder="Select a solution" selectedKey={chosen?.uniqueName ?? null} disabled={!!working}
              options={solutions.map(solution => ({ key: solution.uniqueName, text: `${solution.label}${solution.version ? ` · ${solution.version}` : ''}` }))}
              onChange={(_, option) => { setSolutionName(String(option?.key ?? '')); setPackageData(null); setError(''); }} />
            <div>Dataverse exports the entire selected solution at its current version.</div>
            {isDirty && <MessageBar messageBarType={MessageBarType.warning}>
              This exports the version in Dataverse. Publish edits separately when you want them included.
            </MessageBar>}
          </>
        )}
        <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
          {canExport && solutions.length > 0 && <PrimaryButton text="Prepare export" disabled={!chosen || !!working} onClick={prepareExport} />}
          <DefaultButton text="Review existing ZIP" disabled={!!working} onClick={() => fileInput.current?.click()} />
          <input hidden ref={fileInput} type="file" accept=".zip,application/zip" aria-label="Existing solution ZIP"
            onChange={event => { reviewExisting(event.target.files?.[0]); event.target.value = ''; }} />
        </Stack>
        {working && <Spinner label={working === 'export' ? 'Preparing the managed package in Dataverse…' : 'Reviewing the solution ZIP…'} />}
        {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
        {packageData && (
          <>
            <PackageReview review={packageData.review} />
            <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
              {!packageData.local && <PrimaryButton text="Download managed ZIP" onClick={() =>
                downloadBlob(`${fileStem}_managed.zip`, new Blob([packageData.bytes], { type: 'application/zip' }))} />}
              {settings && (settings.ConnectionReferences.length > 0 || settings.EnvironmentVariables.length > 0) && (
                <DefaultButton text="Download blank deployment settings" onClick={() =>
                  downloadText(`${fileStem}_settings.json`, JSON.stringify(settings, null, 2))} />
              )}
            </Stack>
          </>
        )}
      </Stack>
    </Panel>
  );
}
