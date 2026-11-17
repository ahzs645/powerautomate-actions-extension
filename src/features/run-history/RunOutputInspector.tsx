import { DefaultButton } from '@fluentui/react/lib/Button';
import { Link } from '@fluentui/react/lib/Link';
import { useState } from 'react';
import { copyText } from '../flow-editor/browserActions';
import type { RecentStep, RunOutput } from './runHistoryApi';
import { outputExpression } from './runPayload';

type FieldPath = Array<string | number>;

function OutputFields({ value, path, onCopy }: { value: object; path: FieldPath; onCopy: (path: FieldPath) => void }) {
  const [limit, setLimit] = useState(100);
  const entries = Object.entries(value);
  return (
    <>
      <ul>{entries.slice(0, limit).map(([label, field]) => {
        const next = [...path, Array.isArray(value) ? Number(label) : label];
        return <OutputField key={label} label={Array.isArray(value) ? `[${label}]` : label} value={field} path={next} onCopy={onCopy} />;
      })}</ul>
      {entries.length > limit && <DefaultButton text="Show more fields" onClick={() => setLimit(old => old + 100)} />}
    </>
  );
}

function OutputField({ label, value, path, onCopy }: { label: string; value: unknown; path: FieldPath; onCopy: (path: FieldPath) => void }) {
  const [expanded, setExpanded] = useState(false);
  const copy = <Link onClick={() => onCopy(path)} ariaLabel={`Copy expression for ${label}`}><code>{label}</code></Link>;
  if (value !== null && typeof value === 'object') {
    return <li><details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{copy} · {Array.isArray(value) ? 'Array' : 'Object'}</summary>
      {expanded && <OutputFields value={value} path={path} onCopy={onCopy} />}
    </details></li>;
  }
  const text = String(JSON.stringify(value) ?? '');
  return <li>{copy} · <code>{text.length > 240 ? `${text.slice(0, 240)}…` : text}</code></li>;
}

export function RunOutputInspector({ result, step }: { result: RunOutput; step: RecentStep }) {
  const [message, setMessage] = useState('');
  if (result.status !== 'available') {
    return <p>{result.status === 'secured' ? 'This step’s output is secured.' : 'Power Automate has no output to show for this step.'}</p>;
  }
  const onCopy = async (path: FieldPath) => {
    const expression = outputExpression(step.name, step.kind, path);
    setMessage(await copyText(expression) ? `Copied ${expression}` : 'Clipboard access was unavailable.');
  };
  return (
    <section aria-label={`Output for ${step.name}`}>
      <p>Select a field name to copy its Power Automate expression.</p>
      <DefaultButton text="Copy whole output expression" onClick={() => void onCopy([])} />
      {result.value !== null && typeof result.value === 'object'
        ? <OutputFields value={result.value} path={[]} onCopy={path => void onCopy(path)} />
        : <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result.value)}</pre>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
