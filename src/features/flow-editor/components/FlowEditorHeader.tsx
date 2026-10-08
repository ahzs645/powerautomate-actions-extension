import { IButtonStyles } from '@fluentui/react/lib/Button';
import { CommandBar, ICommandBarItemProps } from '@fluentui/react/lib/CommandBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { ReactNode } from 'react';

const headerClass = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 52,
  padding: '0 4px 0 16px',
  backgroundColor: 'var(--color-bg-card)',
  borderBottom: '1px solid var(--color-stroke)',
  color: 'var(--color-fg)',
});

const titleBlockClass = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  minWidth: 0,
  maxWidth: '38%',
  flex: '0 1 auto',
  padding: '6px 0',
});

const titleRowClass = mergeStyles({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

const flowNameClass = mergeStyles({
  margin: 0,
  fontSize: 'var(--font-size-lg)',
  lineHeight: 'var(--line-height-lg)',
  fontWeight: 'var(--font-weight-semibold)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const envClass = mergeStyles({
  fontSize: 'var(--font-size-sm)',
  lineHeight: 'var(--line-height-sm)',
  color: 'var(--color-fg-secondary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const chipClass = mergeStyles({
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '1px 8px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid var(--color-warning)',
  backgroundColor: 'var(--color-warning-bg)',
  color: 'var(--color-fg)',
  fontSize: 'var(--font-size-sm)',
  lineHeight: '18px',
  fontWeight: 'var(--font-weight-semibold)',
  whiteSpace: 'nowrap',
  selectors: {
    '::before': {
      content: '""',
      width: 6,
      height: 6,
      borderRadius: '50%',
      backgroundColor: 'var(--color-warning)',
    },
  },
});

const commandsClass = mergeStyles({ flex: '1 1 auto', minWidth: 0 });

/**
 * Command buttons paint Fluent's body colour by default, which shows up as dark
 * blocks on the card-coloured header in dark mode. Let the header show through.
 */
const transparentButtonStyles: IButtonStyles = {
  root: { backgroundColor: 'transparent' },
  rootHovered: { backgroundColor: 'var(--color-bg-subtle)' },
  rootPressed: { backgroundColor: 'var(--color-stroke-subtle)' },
  rootExpanded: { backgroundColor: 'var(--color-bg-subtle)' },
  rootDisabled: { backgroundColor: 'transparent' },
};

function mergeButtonStyles(base: IButtonStyles, extra?: IButtonStyles): IButtonStyles {
  if (!extra) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = (base as Record<string, unknown>)[key];
    merged[key] = existing ? [existing, value] : value;
  }
  return merged as IButtonStyles;
}

export interface FlowEditorHeaderProps {
  flowName: string;
  /** Second line under the name: environment name and/or id. */
  environmentLabel?: string;
  environmentTitle?: string;
  isDirty: boolean;
  items: ICommandBarItemProps[];
  overflowItems: ICommandBarItemProps[];
  /** Right-aligned content, e.g. the view switch. */
  farContent?: ReactNode;
}

/**
 * Flow title (not a button: it is what you are editing, not something to click),
 * the unsaved-changes chip, and the grouped command bar.
 */
export const FlowEditorHeader: React.FC<FlowEditorHeaderProps> = ({
  flowName,
  environmentLabel,
  environmentTitle,
  isDirty,
  items,
  overflowItems,
  farContent,
}) => (
  <header className={headerClass}>
    <div className={titleBlockClass}>
      <div className={titleRowClass}>
        <h1 className={flowNameClass} title={flowName}>
          {flowName}
        </h1>
        {isDirty && (
          <span className={chipClass} role="status">
            Unsaved changes
          </span>
        )}
      </div>
      {environmentLabel && (
        <span className={envClass} title={environmentTitle || environmentLabel}>
          {environmentLabel}
        </span>
      )}
    </div>
    <div className={commandsClass}>
      <CommandBar
        items={items.map((item) => ({
          ...item,
          buttonStyles: mergeButtonStyles(transparentButtonStyles, item.buttonStyles),
        }))}
        overflowItems={overflowItems}
        overflowButtonProps={{
          ariaLabel: 'More commands',
          title: 'More commands',
          styles: transparentButtonStyles,
        }}
        ariaLabel="Flow commands"
        styles={{ root: { padding: 0, height: 44, backgroundColor: 'transparent' } }}
      />
    </div>
    {farContent && <div style={{ flex: '0 0 auto' }}>{farContent}</div>}
  </header>
);

/**
 * Starts a new command group with a thin rule on its left. Applied as button
 * styles rather than a separate divider item, so nothing odd lands in the
 * overflow menu when the bar runs out of room.
 */
export const groupStartStyles: ICommandBarItemProps['buttonStyles'] = {
  root: {
    marginLeft: 13,
    position: 'relative',
    overflow: 'visible',
    selectors: {
      '::before': {
        content: '""',
        position: 'absolute',
        left: -7,
        top: 12,
        bottom: 12,
        width: 1,
        backgroundColor: 'var(--color-stroke)',
      },
    },
  },
};

/** The primary command (Save) uses the brand fill. */
export const primaryCommandStyles: ICommandBarItemProps['buttonStyles'] = {
  root: {
    backgroundColor: 'var(--color-brand)',
    color: 'var(--color-brand-text)',
    borderRadius: 'var(--radius-sm)',
    margin: '6px 2px',
    height: 32,
  },
  rootHovered: { backgroundColor: 'var(--color-brand-hover)', color: 'var(--color-brand-text)' },
  rootPressed: { backgroundColor: 'var(--color-brand-hover)', color: 'var(--color-brand-text)' },
  rootDisabled: { backgroundColor: 'var(--color-bg-subtle)', margin: '6px 2px', height: 32 },
  icon: { color: 'var(--color-brand-text)' },
  iconHovered: { color: 'var(--color-brand-text)' },
  iconPressed: { color: 'var(--color-brand-text)' },
};
