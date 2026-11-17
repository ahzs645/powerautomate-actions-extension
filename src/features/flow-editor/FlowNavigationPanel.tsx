import { Link } from '@fluentui/react/lib/Link';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { SearchBox } from '@fluentui/react/lib/SearchBox';
import { Stack } from '@fluentui/react/lib/Stack';
import { useMemo, useState } from 'react';
import { workflowNavigation } from './workflowNavigation';

export type NavigationMode = 'actions' | 'settings';

export function FlowNavigationPanel({ mode, text, onDismiss, onReveal }: {
  mode: NavigationMode; text: string; onDismiss: () => void; onReveal: (pointer: string) => void;
}) {
  const [search, setSearch] = useState('');
  const navigation = useMemo(() => {
    try { return workflowNavigation(text); } catch { return undefined; }
  }, [text]);
  const matches = (value: string) => search.trim().toLowerCase().split(/\s+/).every(term => value.toLowerCase().replace(/_/g, ' ').includes(term.replace(/_/g, ' ')));
  const settings = navigation?.settings.filter(setting => matches(setting.name));
  const operations = navigation?.operations.filter(operation => matches(`${operation.label} ${operation.type} ${operation.kind}`));

  return (
    <Panel isOpen onDismiss={onDismiss} type={PanelType.medium}
      headerText={mode === 'actions' ? 'Find action' : 'Environment variables and flow parameters'} closeButtonAriaLabel="Close">
      <Stack tokens={{ childrenGap: 12, padding: '16px 0' }} styles={{ root: { overflowWrap: 'anywhere' } }}>
        {!navigation ? <p>Fix the flow JSON to see its steps and settings.</p> : (
          <>
            <SearchBox ariaLabel={mode === 'actions' ? 'Search steps' : 'Search settings'} autoFocus
              placeholder={mode === 'actions' ? 'Search steps by name, scope, or type' : 'Search settings'}
              value={search} onChange={(_, value) => setSearch(value ?? '')} />
            {mode === 'settings' ? (settings?.length ? (
              <ul>{settings.map(setting => (
                <li key={setting.name}><strong>{setting.name}</strong>
                  {setting.locations.length ? (
                    <details><summary>Where used ({setting.locations.length})</summary>
                      <ul>{setting.locations.map(location => <li key={location.pointer}>
                        <Link onClick={() => onReveal(location.pointer)}>{location.operation ? `${location.operation.label} · ` : ''}{location.field}</Link>
                      </li>)}</ul>
                    </details>
                  ) : <div>No direct expressions found.</div>}
                </li>
              ))}</ul>
            ) : <p role="status">No matching settings.</p>) : (operations?.length ? (
              <ul>{operations.map(operation => <li key={operation.pointer}>
                <Link onClick={() => onReveal(operation.pointer)}>{operation.label}</Link> · {operation.kind}{operation.type && ` · ${operation.type}`}
              </li>)}</ul>
            ) : <p role="status">No matching steps.</p>)}
          </>
        )}
      </Stack>
    </Panel>
  );
}
