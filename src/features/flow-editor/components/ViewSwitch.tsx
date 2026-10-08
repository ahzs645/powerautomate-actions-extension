import { Icon } from '@fluentui/react/lib/Icon';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { useRef } from 'react';

export type EditorView = 'json' | 'diagram' | 'split';

export const EDITOR_VIEWS: Array<{ key: EditorView; text: string; icon: string; title: string }> = [
  { key: 'json', text: 'JSON', icon: 'Code', title: 'JSON editor only' },
  { key: 'diagram', text: 'Diagram', icon: 'Flow', title: 'Diagram only' },
  { key: 'split', text: 'Split', icon: 'DoubleColumn', title: 'JSON and diagram side by side' },
];

export function isEditorView(value: unknown): value is EditorView {
  return value === 'json' || value === 'diagram' || value === 'split';
}

const groupClass = mergeStyles({
  display: 'inline-flex',
  padding: 2,
  gap: 2,
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-stroke)',
});

const optionClass = (checked: boolean) =>
  mergeStyles({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    padding: '0 10px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    font: 'inherit',
    fontSize: 'var(--font-size-sm)',
    fontWeight: checked ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
    cursor: 'pointer',
    color: checked ? 'var(--color-fg)' : 'var(--color-fg-secondary)',
    backgroundColor: checked ? 'var(--color-bg-card)' : 'transparent',
    boxShadow: checked ? 'var(--shadow-sm)' : 'none',
    selectors: {
      ':hover': { color: 'var(--color-fg)' },
      ':focus-visible': { outline: '2px solid var(--color-brand)', outlineOffset: '1px' },
    },
  });

/**
 * Segmented "JSON | Diagram | Split" control. A radio group: Tab reaches the
 * selected option, arrow keys move between options, as WAI-ARIA describes.
 */
export const ViewSwitch: React.FC<{ value: EditorView; onChange: (view: EditorView) => void }> = ({
  value,
  onChange,
}) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + EDITOR_VIEWS.length) % EDITOR_VIEWS.length;
    onChange(EDITOR_VIEWS[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div className={groupClass} role="radiogroup" aria-label="Editor view">
      {EDITOR_VIEWS.map((view, index) => {
        const checked = view.key === value;
        return (
          <button
            key={view.key}
            ref={(el) => (refs.current[index] = el)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={view.title}
            className={optionClass(checked)}
            onClick={() => onChange(view.key)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1);
              }
            }}
          >
            <Icon iconName={view.icon} aria-hidden />
            {view.text}
          </button>
        );
      })}
    </div>
  );
};
