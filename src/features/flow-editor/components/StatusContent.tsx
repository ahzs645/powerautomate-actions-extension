// Content for the editor's status MessageBar: errors with the request ids
// Microsoft support asks for, the "changed elsewhere" conflict, the offer to
// retry a failed save through Dataverse, and the Dataverse fallback notice.

import { MessageBarButton } from '@fluentui/react/lib/Button';
import { Checkbox } from '@fluentui/react/lib/Checkbox';
import { Link } from '@fluentui/react/lib/Link';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { useState } from 'react';
import type { DiagnosticRequestIds } from '../../../services/Diagnostics';
import { copyText } from '../browserActions';

const codeClass = mergeStyles({
  fontFamily: 'var(--font-family-mono, Consolas, monospace)',
  fontSize: '0.92em',
  userSelect: 'all',
});

const detailClass = mergeStyles({ display: 'block', marginTop: 4 });

const actionsClass = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
});

/** Request ids carried by an ApiError / DataverseFlowError, when any. */
export function requestIdsOf(error: unknown): DiagnosticRequestIds | undefined {
  const ids = (error as { requestIds?: DiagnosticRequestIds } | null | undefined)?.requestIds;
  if (!ids || typeof ids !== 'object') return undefined;
  return ids.serviceRequestId || ids.correlationRequestId || ids.clientRequestId ? ids : undefined;
}

export function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** The id to quote first: the service's own id, else the correlation id, else ours. */
export function primaryRequestId(ids: DiagnosticRequestIds): string | undefined {
  return ids.serviceRequestId || ids.correlationRequestId || ids.clientRequestId;
}

/** Plain-text details for a support request (no tokens, no flow content). */
export function errorDetailsText(
  summary: string,
  error: { status?: number; code?: string; requestIds?: DiagnosticRequestIds } | undefined,
  now: Date = new Date()
): string {
  const ids = error?.requestIds || {};
  const lines = [summary];
  if (error?.status) lines.push(`HTTP status: ${error.status}`);
  if (error?.code) lines.push(`Error code: ${error.code}`);
  if (ids.serviceRequestId) lines.push(`Service request id: ${ids.serviceRequestId}`);
  if (ids.correlationRequestId) lines.push(`Correlation request id: ${ids.correlationRequestId}`);
  if (ids.clientRequestId) lines.push(`Client request id: ${ids.clientRequestId}`);
  lines.push(`Time (UTC): ${now.toISOString()}`);
  return lines.join('\n');
}

export const CopyDetailsLink: React.FC<{ details: string }> = ({ details }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Link
      onClick={async () => setState((await copyText(details)) ? 'copied' : 'failed')}
      aria-live="polite"
    >
      {state === 'copied' ? 'Details copied' : state === 'failed' ? "Couldn't copy — select the id instead" : 'Copy details'}
    </Link>
  );
};

/** An error line; with request ids it adds the id and a "Copy details" link. */
export const ErrorText: React.FC<{ text: string; error?: unknown }> = ({ text, error }) => {
  const ids = requestIdsOf(error);
  const id = ids && primaryRequestId(ids);
  if (!ids || !id) return <>{text}</>;
  const source = error as { status?: number; code?: string };
  return (
    <>
      {text}
      <span className={detailClass}>
        Request id: <span className={codeClass}>{id}</span>{' '}
        <CopyDetailsLink
          details={errorDetailsText(text, { status: source?.status, code: source?.code, requestIds: ids })}
        />
      </span>
    </>
  );
};

export const CONFLICT_TEXT =
  'This flow was changed elsewhere since you loaded it. Reload to get the latest version ' +
  '(your edits stay in the editor — copy them first).';

export const ConflictActions: React.FC<{ onReload: () => void; onDownload: () => void }> = ({
  onReload,
  onDownload,
}) => (
  <div className={actionsClass}>
    <MessageBarButton text="Reload" iconProps={{ iconName: 'Refresh' }} onClick={onReload} />
    <MessageBarButton text="Download my JSON" iconProps={{ iconName: 'Download' }} onClick={onDownload} />
  </div>
);

export const DataverseOfferActions: React.FC<{ onTry: (rememberForEnvironment: boolean) => void }> = ({
  onTry,
}) => {
  const [remember, setRemember] = useState(false);
  return (
    <div className={actionsClass}>
      <MessageBarButton
        text="Try saving through Dataverse (experimental)"
        iconProps={{ iconName: 'Database' }}
        onClick={() => onTry(remember)}
      />
      <Checkbox
        label="Use for this environment"
        checked={remember}
        onChange={(_, checked) => setRemember(!!checked)}
      />
    </div>
  );
};

export function missingReferencesSentence(referenceKeys: string[]): string {
  const list = referenceKeys.join(', ');
  return (
    `Dataverse saving needs a logical name for every connection reference, and ` +
    `${referenceKeys.length === 1 ? 'this one has' : 'these have'} none: ${list}. ` +
    'Connections that are not solution connection references cannot be saved through Dataverse.'
  );
}
