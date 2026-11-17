import { DefaultButton } from '@fluentui/react/lib/Button';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { collectConnectionUses, connectionPointer, connectorName, legacyReferences } from './flowConnections';
import { parseEditorText } from './flowPersistence';

const rowClass = mergeStyles({
  padding: '12px 0',
  borderBottom: '1px solid var(--color-stroke)',
  overflowWrap: 'anywhere',
});

interface Props {
  isOpen: boolean;
  onDismiss: () => void;
  text: string;
  onReveal: (pointer: string) => void;
  manageUrl?: string;
  isSolutionFlow: boolean;
}

export function ConnectionsPanel({ isOpen, onDismiss, text, onReveal, manageUrl, isSolutionFlow }: Props) {
  if (!isOpen) return null;
  const parsed = parseEditorText(text, '');
  const refs = parsed.ok ? parsed.doc.connectionReferences : {};
  const legacy = parsed.ok ? legacyReferences(parsed.doc.definition) : {};
  const uses = parsed.ok ? collectConnectionUses(parsed.doc.definition) : [];
  const aliases = new Set([...Object.keys(refs), ...Object.keys(legacy), ...uses.map(use => use.alias)]);

  return (
    <Panel isOpen onDismiss={onDismiss} headerText="Connections" type={PanelType.medium} closeButtonAriaLabel="Close Connections">
      {!parsed.ok && <MessageBar messageBarType={MessageBarType.error}>{parsed.error}</MessageBar>}
      {manageUrl && (
        <p><DefaultButton href={manageUrl} target="_blank" rel="noopener noreferrer"
          text={isSolutionFlow ? 'Open solutions in Power Automate' : 'Manage connections in Power Automate'} /></p>
      )}
      {parsed.ok && aliases.size === 0 && <p>This flow has no connection references.</p>}
      {Array.from(aliases, alias => {
        const ref = Object.prototype.hasOwnProperty.call(refs, alias) ? refs[alias] : undefined;
        const legacyRef = Object.prototype.hasOwnProperty.call(legacy, alias) ? legacy[alias] : undefined;
        const steps = uses.filter(use => use.alias === alias);
        const missing = ref === undefined && (legacyRef === undefined || steps.some(use => !use.fromParameter));
        const connector = connectorName(ref ?? legacyRef) ?? steps[0]?.connectorId?.split('/').pop();
        return (
          <div className={rowClass} key={alias}>
            {connector && <div><strong>{connector}</strong></div>}
            <code>{alias}</code>
            {missing && <div role="status">Missing connection reference</div>}
            {steps.length === 0 ? <div>Unused in this flow</div> : (
              <details>
                <summary>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</summary>
                <ul>
                  {steps.map(use => {
                    const pointer = connectionPointer(use.path);
                    return <li key={pointer}><button type="button" onClick={() => onReveal(pointer)}>{use.kind} · {use.label}</button></li>;
                  })}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
