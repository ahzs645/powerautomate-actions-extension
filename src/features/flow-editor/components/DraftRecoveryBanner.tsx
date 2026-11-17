import { MessageBarButton } from '@fluentui/react/lib/Button';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import type { DraftRecovery } from '../useDraftRecovery';

export function DraftRecoveryBanner({ recovery }: { recovery: DraftRecovery }) {
  return (
    <>
      {recovery.hasDraft && (
        <MessageBar
          messageBarType={MessageBarType.warning}
          actions={
            <>
              <MessageBarButton onClick={recovery.restore}>Restore my work</MessageBarButton>
              <MessageBarButton onClick={recovery.discard}>Keep loaded version</MessageBarButton>
            </>
          }
        >
          {recovery.baselineChanged
            ? 'The loaded flow differs from the version your edits were based on. Compare with the loaded version before saving.'
            : 'Unsaved edits are available for this flow.'}
        </MessageBar>
      )}
      {recovery.unavailable && (
        <MessageBar messageBarType={MessageBarType.warning}>
          Browser session recovery is unavailable. Use Download JSON to keep a copy of your work.
        </MessageBar>
      )}
    </>
  );
}
