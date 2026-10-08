import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Checkbox } from '@fluentui/react/lib/Checkbox';
import { Dialog, DialogFooter, DialogType } from '@fluentui/react/lib/Dialog';
import { useEffect, useState } from 'react';

interface FlowIdentity {
  flowName: string;
  /** Friendly environment name, or its id when no name is known. */
  environmentLabel: string;
  /** How the flow will be written, e.g. "the Flow service" or "Dataverse (experimental)". */
  saveMethodLabel?: string;
}

const methodSentence = (verb: string, label?: string) => (label ? ` ${verb} through ${label}.` : '');

export const SaveConfirmDialog: React.FC<
  FlowIdentity & { isOpen: boolean; onConfirm: (dontAskAgain: boolean) => void; onCancel: () => void }
> = ({ isOpen, flowName, environmentLabel, saveMethodLabel, onConfirm, onCancel }) => {
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
> = ({ isOpen, flowName, environmentLabel, saveMethodLabel, isDirty, onConfirm, onCancel }) => (
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
    <DialogFooter>
      <PrimaryButton text="Publish" onClick={onConfirm} />
      <DefaultButton text="Cancel" onClick={onCancel} />
    </DialogFooter>
  </Dialog>
);
