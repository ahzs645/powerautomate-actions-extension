import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Checkbox } from '@fluentui/react/lib/Checkbox';
import { Dialog, DialogFooter, DialogType } from '@fluentui/react/lib/Dialog';
import { useEffect, useState } from 'react';
import type { ConnectionChange } from '../flowConnections';

interface FlowIdentity {
  flowName: string;
  /** Friendly environment name, or its id when no name is known. */
  environmentLabel: string;
  /** How the flow will be written, e.g. "the Flow service" or "Dataverse (experimental)". */
  saveMethodLabel?: string;
  connectionChanges?: ConnectionChange[];
}

const methodSentence = (verb: string, label?: string) => (label ? ` ${verb} through ${label}.` : '');

function ConnectionChangeList({ changes }: { changes?: ConnectionChange[] }) {
  if (!changes?.length) return null;
  return (
    <div>
      <strong>Connection changes</strong>
      <ul style={{ maxHeight: 240, overflow: 'auto', overflowWrap: 'anywhere' }}>
        {changes.map(change => (
          <li key={change.key}>
            {change.text}
            {!!change.fields?.length && <div>{change.fields.join(', ')}</div>}
            {change.uses.length > 0 && <div>{change.uses.map(use => `${use.kind} ${use.label}`).join(', ')}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const SaveConfirmDialog: React.FC<
  FlowIdentity & { isOpen: boolean; onConfirm: (dontAskAgain: boolean) => void; onCancel: () => void }
> = ({ isOpen, flowName, environmentLabel, saveMethodLabel, connectionChanges, onConfirm, onCancel }) => {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  useEffect(() => {
    if (isOpen) setDontAskAgain(false);
  }, [isOpen]);

  return (
    <Dialog
      hidden={!isOpen}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: `Save "${flowName}"?`,
        subText:
          `This overwrites the flow's draft in ${environmentLabel} with the JSON in the editor. ` +
          'The published version keeps running until you publish.' +
          methodSentence('Saved', saveMethodLabel),
      }}
      modalProps={{ isBlocking: true }}
      minWidth={420}
    >
      <ConnectionChangeList changes={connectionChanges} />
      <Checkbox
        label="Don't ask again"
        checked={dontAskAgain}
        onChange={(_, checked) => setDontAskAgain(!!checked)}
      />
      <DialogFooter>
        <PrimaryButton text="Save" onClick={() => onConfirm(dontAskAgain)} />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

export const PublishConfirmDialog: React.FC<
  FlowIdentity & { isOpen: boolean; isDirty: boolean; onConfirm: () => void; onCancel: () => void }
> = ({ isOpen, flowName, environmentLabel, saveMethodLabel, connectionChanges, isDirty, onConfirm, onCancel }) => (
  <Dialog
    hidden={!isOpen}
    onDismiss={onCancel}
    dialogContentProps={{
      type: DialogType.normal,
      title: `Publish "${flowName}"?`,
      subText:
        `${isDirty ? 'Your unsaved changes are saved first, then the' : 'The'} flow is published in ` +
        `${environmentLabel}. New runs use the published version straight away.` +
        methodSentence('Saved and published', saveMethodLabel),
    }}
    modalProps={{ isBlocking: true }}
    minWidth={440}
  >
    <ConnectionChangeList changes={connectionChanges} />
    <DialogFooter>
      <PrimaryButton text="Publish" onClick={onConfirm} />
      <DefaultButton text="Cancel" onClick={onCancel} />
    </DialogFooter>
  </Dialog>
);
