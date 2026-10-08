import { IconButton, IButtonStyles, Checkbox, Icon } from '@fluentui/react';
import { IActionModel } from "../models";

const rowButtonStyles: IButtonStyles = {
    root: { width: 28, height: 28, flexShrink: 0, color: 'inherit' },
    rootHovered: { background: 'var(--color-bg-subtle)' },
    rootPressed: { background: 'var(--color-stroke-subtle)' },
    icon: { fontSize: 14 },
};

export interface IActionRowButton {
    key: string;
    iconName: string;
    /** Visible tooltip; the accessible name also carries the action title. */
    label: string;
    onClick: () => void;
    className?: string;
}

export interface IActionRowProps {
    action: IActionModel;
    onToggleSelect?: (action: IActionModel) => void;
    /** Legacy single-select bookmark instead of a checkbox. */
    useSelectButton?: boolean;
    onShowDetails: (action: IActionModel) => void;
    onToggleFavorite?: (action: IActionModel) => void;
    onDelete?: (action: IActionModel) => void;
    /** Extra per-row buttons rendered before the favourite star (copy with options, configure). */
    extraButtons?: IActionRowButton[];
    /** Native tooltip for the whole row (URL or description). */
    rowTitle?: string;
}

/** The badge is fixed-width; anything unusual is clipped by CSS. */
export function methodBadgeText(method: string | undefined): string {
    return (method || '').toUpperCase() || '—';
}

const ActionRow: React.FC<IActionRowProps> = ({
    action, onToggleSelect, useSelectButton, onShowDetails, onToggleFavorite, onDelete, extraButtons, rowTitle,
}) => {
    const method = (action.method || '').toUpperCase();
    return (
        <div className={`App-Action-Row${action.isSelected ? ' is-selected' : ''}`} title={rowTitle}>
            {useSelectButton ? (
                <IconButton
                    className='App-Action-Select'
                    iconProps={{ iconName: 'SingleBookmark' }}
                    title="Select Action To Copy"
                    ariaLabel={`Select ${action.title}`}
                    onClick={() => onToggleSelect?.(action)}
                    styles={rowButtonStyles}
                />
            ) : (
                <Checkbox
                    className='App-Action-Checkbox'
                    checked={!!action.isSelected}
                    ariaLabel={action.title}
                    onChange={() => onToggleSelect?.(action)}
                />
            )}
            <img src={action.icon} className='App-Action-Icon' alt={action.title}></img>
            <span className='App-Action-Title' title={action.title}>
                {action.title}
            </span>
            {action.warning && (
                <Icon
                    iconName='Warning'
                    title={action.warning}
                    aria-label={action.warning}
                    className='App-Action-Warning'
                />
            )}
            <span className={`App-Action-Method method-${method.toLowerCase() || 'none'}`} title={method}>
                {methodBadgeText(action.method)}
            </span>
            <div className='App-Action-Buttons'>
                <IconButton
                    className='App-Action-Info'
                    iconProps={{ iconName: 'Info' }}
                    title="Show Action Details"
                    ariaLabel={`Show details for ${action.title}`}
                    onClick={() => onShowDetails(action)}
                    styles={rowButtonStyles}
                />
                {extraButtons?.map(button => (
                    <IconButton
                        key={button.key}
                        className={button.className}
                        iconProps={{ iconName: button.iconName }}
                        title={button.label}
                        ariaLabel={`${button.label}: ${action.title}`}
                        onClick={button.onClick}
                        styles={rowButtonStyles}
                    />
                ))}
                {onToggleFavorite && (
                    <IconButton
                        className='App-Action-Favorite'
                        iconProps={{ iconName: action.isFavorite ? 'FavoriteStarFill' : 'FavoriteStar' }}
                        title={action.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                        ariaLabel={`${action.isFavorite ? 'Remove from favorites' : 'Add to favorites'}: ${action.title}`}
                        aria-pressed={!!action.isFavorite}
                        onClick={() => onToggleFavorite(action)}
                        styles={rowButtonStyles}
                    />
                )}
                {onDelete && (
                    <IconButton
                        className='App-Action-Delete'
                        iconProps={{ iconName: 'Delete' }}
                        title="Delete"
                        ariaLabel={`Delete ${action.title}`}
                        onClick={() => onDelete(action)}
                        styles={rowButtonStyles}
                    />
                )}
            </div>
        </div>
    );
};

export default ActionRow;
