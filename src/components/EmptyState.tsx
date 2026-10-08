import { Icon, Link } from '@fluentui/react';
export interface IEmptyStateProps {
    iconName: string;
    title: string;
    /** One-line how-to. */
    hint?: React.ReactNode;
    actionText?: string;
    onAction?: () => void;
}

const EmptyState: React.FC<IEmptyStateProps> = ({ iconName, title, hint, actionText, onAction }) => (
    <div className="empty-state" role="status">
        <Icon iconName={iconName} className="empty-state-icon" aria-hidden="true" />
        <div className="empty-state-title">{title}</div>
        {hint && <div className="empty-state-hint">{hint}</div>}
        {actionText && onAction && (
            <Link className="empty-state-action" onClick={onAction}>{actionText}</Link>
        )}
    </div>
);

export default EmptyState;
