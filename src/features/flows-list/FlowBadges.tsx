import { Icon } from '@fluentui/react/lib/Icon';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { FlowSummary } from './flowsApi';

interface BadgeTone {
  /** CSS custom property names so the badge follows the light/dark tokens */
  background: string;
  color: string;
  iconName?: string;
}

// Flat tints rather than saturated fills, so a long list of badges reads as data
// instead of a wall of alerts. Colours come from theme/tokens.css.
const STATE_TONES: Record<string, BadgeTone> = {
  Started: { background: 'var(--color-success-bg)', color: 'var(--color-success)', iconName: 'PlayResume' },
  Stopped: { background: 'var(--color-bg-subtle)', color: 'var(--color-fg-secondary)', iconName: 'CirclePause' },
  Suspended: { background: 'var(--color-warning-bg)', color: 'var(--color-warning)', iconName: 'Warning' },
  Deleted: { background: 'var(--color-danger-bg)', color: 'var(--color-danger)', iconName: 'Blocked' },
};

const UNKNOWN_TONE: BadgeTone = {
  background: 'var(--color-bg-subtle)',
  color: 'var(--color-fg-secondary)',
};

const OWNER_TONES: Record<string, BadgeTone> = {
  personal: { background: 'var(--color-info-bg)', color: 'var(--color-info)', iconName: 'Contact' },
  team: { background: 'var(--color-accent-bg)', color: 'var(--color-accent)', iconName: 'People' },
};

const badgeClassName = (tone: BadgeTone) =>
  mergeStyles({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '1px 8px',
    borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    lineHeight: '18px',
    whiteSpace: 'nowrap',
    backgroundColor: tone.background,
    color: tone.color,
    border: '1px solid currentColor',
  });

const Badge: React.FC<{ tone: BadgeTone; text: string }> = ({ tone, text }) => (
  <span className={badgeClassName(tone)}>
    {tone.iconName && <Icon iconName={tone.iconName} styles={{ root: { fontSize: 11 } }} />}
    <span>{text}</span>
  </span>
);

export const StateBadge: React.FC<{ state?: string }> = ({ state }) => {
  if (!state) {
    return null;
  }
  return <Badge tone={STATE_TONES[state] || UNKNOWN_TONE} text={state} />;
};

export const OwnerBadge: React.FC<{ scope: FlowSummary['scope'] }> = ({ scope }) => {
  if (scope === 'unknown') {
    return null;
  }
  return (
    <Badge tone={OWNER_TONES[scope]} text={scope === 'personal' ? 'Mine' : 'Shared'} />
  );
};
