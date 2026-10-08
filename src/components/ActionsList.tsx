import { useCallback, useState } from "react";
import { IconButton, TextField, TooltipHost } from '@fluentui/react';
import { IActionModel, Mode } from "../models";
import { PlaceholderService } from "../services/PlaceholderService";
import ActionDetailsPanel from "./ActionDetailsPanel";
import ActionRow from "./ActionRow";
import EmptyState, { IEmptyStateProps } from "./EmptyState";

export interface IActionsListProps {
    actions: IActionModel[];
    mode: Mode;
    changeSelectionFunc: (action: IActionModel) => void;
    deleteActionFunc: (action: IActionModel) => void;
    editActionFunc?: (action: IActionModel) => void;
    showButton: boolean;
    toggleFavoriteFunc?: (action: IActionModel) => void;
    searchTerm: string;
    onSearchChange: (searchTerm: string) => void;
    placeholderService: PlaceholderService;
    /** Shown when the list itself is empty (not when a search hides everything). */
    emptyState?: IEmptyStateProps;
    /** Extra controls in the search row, e.g. "Import from designer". */
    toolbar?: React.ReactNode;
    /** Clears the whole list; the caller confirms first. */
    onClearAll?: () => void;
    clearLabel?: string;
    /** Number of items before search filtering, for the empty-state choice. */
    totalCount?: number;
}

const ActionsList: React.FC<IActionsListProps> = (props) => {
    const { searchTerm, onSearchChange } = props;
    const [selectedActionForDetails, setSelectedActionForDetails] = useState<IActionModel | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);

    const showActionDetails = useCallback((action: IActionModel) => {
        setSelectedActionForDetails(action);
        setIsPanelOpen(true);
    }, []);

    const hideActionDetails = useCallback(() => {
        setIsPanelOpen(false);
        setSelectedActionForDetails(null);
    }, []);

    const actions = props.actions || [];
    const totalCount = props.totalCount ?? actions.length;
    const hasSearch = !!searchTerm && searchTerm.trim() !== '';

    const renderBody = () => {
        if (actions.length > 0) {
            return actions.map((action, index) => (
                <ActionRow
                    key={action.id || index}
                    action={action}
                    rowTitle={action.url}
                    useSelectButton={props.showButton}
                    onToggleSelect={props.changeSelectionFunc}
                    onShowDetails={showActionDetails}
                    onToggleFavorite={props.toggleFavoriteFunc}
                    onDelete={props.deleteActionFunc}
                />
            ));
        }
        if (hasSearch && totalCount > 0) {
            return (
                <EmptyState
                    iconName="SearchIssue"
                    title={`No actions match '${searchTerm.trim()}'`}
                    actionText="Clear search"
                    onAction={() => onSearchChange('')}
                />
            );
        }
        return props.emptyState ? <EmptyState {...props.emptyState} /> : null;
    };

    return <>
        <div className="list-toolbar">
            <TextField
                className="list-toolbar-search"
                placeholder="Search actions by title..."
                ariaLabel="Search actions by title"
                value={searchTerm}
                onChange={(_event, newValue) => onSearchChange(newValue || '')}
                iconProps={{ iconName: 'Search' }}
            />
            {props.toolbar}
            {props.onClearAll && totalCount > 0 && (
                <TooltipHost content={props.clearLabel || 'Clear all'}>
                    <IconButton
                        className="list-toolbar-clear"
                        iconProps={{ iconName: 'Broom' }}
                        ariaLabel={props.clearLabel || 'Clear all'}
                        onClick={props.onClearAll}
                    />
                </TooltipHost>
            )}
        </div>
        <div className="App-Actions">{renderBody()}</div>
        <ActionDetailsPanel
            action={selectedActionForDetails}
            isOpen={isPanelOpen}
            onDismiss={hideActionDetails}
            placeholderService={props.placeholderService}
            onSave={props.editActionFunc}
        />
    </>;
}

export default ActionsList;
