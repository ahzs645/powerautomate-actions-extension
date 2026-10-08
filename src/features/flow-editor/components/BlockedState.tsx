import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Icon } from '@fluentui/react/lib/Icon';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { ReactNode } from 'react';

export interface BlockedStateAction {
  text: string;
  onClick?: () => void;
  /** Opens in a new tab. */
  href?: string;
  primary?: boolean;
}

const wrapClass = mergeStyles({
  flex: 1,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '48px 16px',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-fg)',
});

const cardClass = mergeStyles({
  maxWidth: 560,
  width: '100%',
  padding: '24px 28px',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--color-stroke)',
  backgroundColor: 'var(--color-bg-card)',
  boxShadow: 'var(--shadow-md)',
  lineHeight: 'var(--line-height-md)',
  selectors: {
    p: { margin: '8px 0' },
    ol: { margin: '8px 0', paddingLeft: 20 },
    li: { margin: '4px 0' },
  },
});

const titleClass = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: '0 0 4px',
  fontSize: 'var(--font-size-xl)',
  fontWeight: 'var(--font-weight-semibold)',
});

/**
 * A full-page explanation for a state the page cannot get out of by itself
 * (missing parameters, no sign-in token). Unlike a dismissible message bar it
 * never leaves the user looking at a blank page.
 */
export const BlockedState: React.FC<{
  icon: string;
  title: string;
  children: ReactNode;
  actions?: BlockedStateAction[];
}> = ({ icon, title, children, actions = [] }) => (
  <div className={wrapClass}>
    <section className={cardClass} role="alert" aria-labelledby="blocked-state-title">
      <h2 id="blocked-state-title" className={titleClass}>
        <Icon iconName={icon} aria-hidden styles={{ root: { color: 'var(--color-brand)', fontSize: 22 } }} />
        {title}
      </h2>
      {children}
      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {actions.map((action) => {
            const Button = action.primary ? PrimaryButton : DefaultButton;
            return (
              <Button
                key={action.text}
                text={action.text}
                onClick={action.onClick}
                href={action.href}
                target={action.href ? '_blank' : undefined}
                rel={action.href ? 'noopener noreferrer' : undefined}
              />
            );
          })}
        </div>
      )}
    </section>
  </div>
);
