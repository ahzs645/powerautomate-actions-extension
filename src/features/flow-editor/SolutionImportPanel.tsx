import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Dropdown } from '@fluentui/react/lib/Dropdown';
import { Link } from '@fluentui/react/lib/Link';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Spinner } from '@fluentui/react/lib/Spinner';
import { Stack } from '@fluentui/react/lib/Stack';
import { TextField } from '@fluentui/react/lib/TextField';
import { useEffect, useRef, useState } from 'react';
import { isMakerOrigin } from '../../chrome/hosts';
import type { IApiProvider } from '../../services/ApiProvider';
import { downloadText } from './browserActions';
import { connectorKey, fillDeploymentSettings, listTargetConnections, TargetConnection, validConnectionId } from './solutionImportSettings';
import { reviewSolutionPackage, SolutionPackageReview } from './solutionPackageReview';

export function SolutionImportPanel({ api, envId, environmentLabel, portalUrl, onDismiss, onReconnect }: {
  api: IApiProvider; envId: string; environmentLabel?: string; portalUrl?: string; onDismiss: () => void; onReconnect: () => void;
}) {
  const [review, setReview] = useState<SolutionPackageReview>();
  const [reviewing, setReviewing] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [choices, setChoices] = useState<TargetConnection[]>([]);
  const [connections, setConnections] = useState(() => new Map<string, string>());
  const [variables, setVariables] = useState(() => new Map<string, string>());
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController>();
  const mounted = useRef(false);
  const importer = portalUrl && isMakerOrigin(portalUrl)
    ? new URL(`/environments/${encodeURIComponent(envId)}/solutions`, new URL(portalUrl).origin).href
    : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);

  async function browseConnections() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setConnectionError('');
    setLoadingConnections(true);
    try {
      const target = await listTargetConnections(api, envId, controller.signal);
      if (!controller.signal.aborted) setChoices(target);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setChoices([]);
        setConnectionError(reason instanceof Error ? reason.message : 'Unable to list target connections.');
      }
    } finally {
      if (!controller.signal.aborted) setLoadingConnections(false);
    }
  }

  async function readPackage(file: File | undefined) {
    if (!file) return;
    active.current?.abort();
    setLoadingConnections(false);
    setChoices([]);
    setConnectionError('');
    setReviewing(true);
    setError('');
    setReview(undefined);
    setConnections(new Map());
    setVariables(new Map());
    try {
      const packageReview = await reviewSolutionPackage(await file.arrayBuffer());
      if (!mounted.current) return;
      setReview(packageReview);
      if (packageReview.connections.some(reference => reference.included && reference.connectorId)) await browseConnections();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Unable to read solution ZIP.');
    } finally {
      if (mounted.current) setReviewing(false);
    }
  }

  const settings = review && fillDeploymentSettings(review, connections, variables);
  return (
    <Panel isOpen onDismiss={onDismiss} headerText="Prepare solution import" type={PanelType.large} closeButtonAriaLabel="Close">
      <Stack tokens={{ childrenGap: 14, padding: '16px 0' }} styles={{ root: { overflowWrap: 'anywhere' } }}>
        <div><strong>Target environment</strong><div>{environmentLabel || envId}</div>
          {environmentLabel && environmentLabel !== envId && <small>{envId}</small>}</div>
        <DefaultButton text="Choose solution ZIP" disabled={reviewing} onClick={() => input.current?.click()} />
        <input hidden ref={input} type="file" accept=".zip,application/zip" aria-label="Solution ZIP to import" disabled={reviewing}
          onChange={event => { void readPackage(event.target.files?.[0]); event.target.value = ''; }} />
        {reviewing && <Spinner label="Reviewing solution and target settings…" />}
        {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
        {review && settings && (
          <>
            <h2>{review.uniqueName} · {review.version}</h2>
            {review.requiredComponents.length > 0 && <MessageBar messageBarType={MessageBarType.warning}>
              Required dependencies for this solution: {review.requiredComponents.join(', ')}
            </MessageBar>}
            {review.destinations.length > 0 && <MessageBar messageBarType={MessageBarType.warning}>
              Review the fixed settings before import: {Array.from(new Set(review.destinations.map(destination => destination.setting))).join(', ')}.
            </MessageBar>}
            {review.flows.some(flow => flow.enabled) && <MessageBar messageBarType={MessageBarType.warning}>
              A flow exported as on can turn on once its connections are mapped. Verify the destination resources first.
            </MessageBar>}
            {settings.ConnectionReferences.length > 0 && <>
              <h3>Target connections</h3>
              <p role="status">{settings.ConnectionReferences.filter(reference => reference.ConnectionId).length} of {settings.ConnectionReferences.length} target connections mapped.</p>
              <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
                <DefaultButton text="Refresh connections" disabled={loadingConnections} onClick={() => void browseConnections()} />
                {connectionError && <DefaultButton text="Reconnect" onClick={onReconnect} />}
              </Stack>
              {loadingConnections && <Spinner label="Loading target connections…" />}
              {connectionError && <MessageBar>{connectionError}</MessageBar>}
              {review.connections.filter(reference => reference.included && reference.connectorId).map(reference => {
                const matches = choices.filter(target => target.connector === connectorKey(reference.connectorId!));
                const id = connections.get(reference.name) ?? '';
                const label = `${reference.label} (${reference.name})`;
                const change = (value: string) => setConnections(previous => new Map(previous).set(reference.name, value));
                return (
                  <Stack key={reference.name} tokens={{ childrenGap: 6 }}>
                    {matches.length > 0 && <Dropdown label={label} placeholder="Choose a target connection"
                      selectedKey={matches.some(target => target.id === id) ? id : null}
                      options={matches.map(target => ({ key: target.id, text: target.label === target.id ? target.id : `${target.label} · ${target.id.slice(-8)}` }))}
                      onChange={(_, option) => change(String(option?.key ?? ''))} />}
                    <TextField label={matches.length ? `Connection ID for ${reference.name}` : label} value={id}
                      placeholder="Target connection ID" onChange={(_, value) => change(value ?? '')}
                      errorMessage={id.trim() && !validConnectionId(id.trim()) ? 'Enter the connection ID from the target environment.' : undefined} />
                  </Stack>
                );
              })}
            </>}
            {review.environmentVariables.length > 0 && <>
              <h3>Environment variables</h3>
              {review.environmentVariables.map(variable => <TextField key={variable.name} label={`${variable.label} (${variable.name})`}
                value={variables.get(variable.name) ?? ''}
                onChange={(_, value) => setVariables(previous => new Map(previous).set(variable.name, value ?? ''))} />)}
            </>}
            <p>Use the settings file with Power Platform CLI, or use the selections as a checklist for the import in Power Automate.</p>
            <Stack horizontal wrap tokens={{ childrenGap: 8 }}>
              <PrimaryButton text="Download deployment settings" disabled={Array.from(connections.values()).some(value => !!value.trim() && !validConnectionId(value.trim()))}
                onClick={() => downloadText(`${review.uniqueName.replace(/[^a-z\d._-]/gi, '_')}_settings.json`, JSON.stringify(settings, null, 2))} />
              {importer && <DefaultButton text="Open target Solutions" href={importer} target="_blank" rel="noopener noreferrer" />}
            </Stack>
            <Link href="https://learn.microsoft.com/power-platform/developer/cli/reference/solution#pac-solution-import" target="_blank" rel="noopener noreferrer">Import with Power Platform CLI</Link>
          </>
        )}
      </Stack>
    </Panel>
  );
}
