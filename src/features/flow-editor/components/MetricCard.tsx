import { mergeStyles } from '@fluentui/react/lib/Styling';
import { ReactNode } from 'react';

/**
 * Status a metric communicates. Each tone maps to a token pair in theme/tokens.css
 * (`--color-<tone>-bg` behind `--color-fg` text), which keeps text contrast at or
 * above 4.5:1 in both light and dark themes. Saturated fills with white text (the
 * old cards: white on #ff8c00 is 2.2:1) are deliberately not offered.
 */
export type MetricTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';

const TONE_VARS: Record<MetricTone, { bg: string; edge: string }> = {
  success: { bg: 'var(--color-success-bg)', edge: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-bg)', edge: 'var(--color-warning)' },
  danger: { bg: 'var(--color-danger-bg)', edge: 'var(--color-danger)' },
  info: { bg: 'var(--color-info-bg)', edge: 'var(--color-info)' },
  accent: { bg: 'var(--color-accent-bg)', edge: 'var(--color-accent)' },
  neutral: { bg: 'var(--color-bg-subtle)', edge: 'var(--color-stroke)' },
};

const cardClass = (tone: MetricTone) =>
  mergeStyles({
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '10px 14px 10px 12px',
    minWidth: 104,
    borderRadius: 'var(--radius-md)',
    borderLeft: `4px solid ${TONE_VARS[tone].edge}`,
    backgroundColor: TONE_VARS[tone].bg,
    color: 'var(--color-fg)',
    boxSizing: 'border-box',
  });

const labelClass = mergeStyles({
  fontSize: 'var(--font-size-sm)',
  lineHeight: 'var(--line-height-sm)',
  color: 'var(--color-fg-secondary)',
  fontWeight: 'var(--font-weight-semibold)',
});

const valueClass = mergeStyles({
  fontSize: 24,
  lineHeight: '30px',
  fontWeight: 'var(--font-weight-bold)',
  color: 'var(--color-fg)',
  fontVariantNumeric: 'tabular-nums',
});

const hintClass = mergeStyles({
  fontSize: 'var(--font-size-xs)',
  lineHeight: '14px',
  color: 'var(--color-fg-secondary)',
});

export interface MetricCardProps {
  label: string;
  /** `null`/`undefined` render as an em dash: the metric does not apply. */
  value: ReactNode | null | undefined;
  tone?: MetricTone;
  /** One short line under the value, e.g. the threshold the tone came from. */
  hint?: string;
  title?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, tone = 'neutral', hint, title }) => {
  const missing = value === null || value === undefined || value === '';
  return (
    <div className={cardClass(tone)} title={title} data-tone={tone}>
      <span className={labelClass}>{label}</span>
      <span className={valueClass} aria-label={missing ? `${label}: not applicable` : undefined}>
        {missing ? '—' : value}
      </span>
      {hint && <span className={hintClass}>{hint}</span>}
    </div>
  );
};

const rowClass = mergeStyles({ display: 'flex', flexWrap: 'wrap', gap: 12 });

export const MetricRow: React.FC<{ children: ReactNode; label?: string }> = ({ children, label }) => (
  <div className={rowClass} role="group" aria-label={label}>
    {children}
  </div>
);

/** Map FlowAnalyzer's traffic-light names onto tones. */
export function toneFromRating(color: string): MetricTone {
  switch (color) {
    case 'green':
      return 'success';
    case 'orange':
      return 'warning';
    case 'red':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default MetricCard;
