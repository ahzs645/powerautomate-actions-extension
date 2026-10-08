import { useCallback, useMemo, useState } from "react";
import { IconButton, Dropdown, IDropdownOption, Link, MessageBar, MessageBarType, Spinner, SpinnerSize, TextField, TooltipHost } from '@fluentui/react';
import { IActionModel } from "../models";
import { IUtilityAction } from "../models/IUtilityCatalog";
import { IUtilityFunctionConfig, utilityActionsService } from "../services/UtilityActionsService";
import UtilityActionForm from "./UtilityActionForm";
import { PlaceholderService } from "../services/PlaceholderService";
import CopyWithOptionsModal from "./CopyWithOptionsModal";
import ActionDetailsPanel from "./ActionDetailsPanel";
import ActionRow, { IActionRowButton } from "./ActionRow";
import EmptyState from "./EmptyState";

const ALL_CATEGORIES = '__all__';

export interface IPredefinedActionsListProps {
    actions: IActionModel[];
    isLoading: boolean;
    onRefresh?: () => void;
    changeSelectionFunc?: (action: IActionModel) => void;
    toggleFavoriteFunc?: (action: IActionModel) => void;
    onCopyAction?: (action: IActionModel) => void;
    placeholderService: PlaceholderService;
    searchTerm: string;
    onSearchChange: (searchTerm: string) => void;
    /** Current function configuration, used when generating a configured action. */
    utilityConfig?: IUtilityFunctionConfig;
    /** Receives an action built from the parameter form. */
    onConfiguredAction?: (action: IActionModel) => void;
    /** Opens Settings at a section ('library' or 'utility'). */
    onOpenSettings?: (section: 'library' | 'utility') => void;
}

const isUtilityAction = (action: IActionModel) => !!action.id?.startsWith('utility-');

const PredefinedActionsList: React.FC<IPredefinedActionsListProps> = (props) => {
    const [selectedActionForDetails, setSelectedActionForDetails] = useState<IActionModel | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
    const [configuringAction, setConfiguringAction] = useState<IUtilityAction | null>(null);
    const [actionForCopyWithOptions, setActionForCopyWithOptions] = useState<IActionModel | null>(null);

    const showActionDetails = useCallback((action: IActionModel) => {
        setSelectedActionForDetails(action);
        setIsPanelOpen(true);
    }, []);

    const hideActionDetails = useCallback(() => {
        setIsPanelOpen(false);
        setSelectedActionForDetails(null);
    }, []);

    /** Utility presets carry a catalog route, so the parameter form can be offered. */
    const getCatalogAction = useCallback((action: IActionModel): IUtilityAction | undefined => {
        if (!action.id?.startsWith('utility-') || action.id.startsWith('utility-parse-')) {
            return undefined;
        }
        return utilityActionsService.getAction(action.id.replace('utility-', ''));
    }, []);

    const handleCopyWithOptions = useCallback((filled: IActionModel) => {
        setActionForCopyWithOptions(null);
        props.onCopyAction?.(filled);
    }, [props]);

    const handleSaveAsFavorite = useCallback((filled: IActionModel) => {
        props.toggleFavoriteFunc?.({ ...filled, isFavorite: false });
    }, [props]);

    const renderAction = useCallback((action: IActionModel) => {
        const catalogAction = getCatalogAction(action);
        // Only {{UPPER_CASE}} placeholders warrant the dialog. Expressions such as
        // @outputs('...') are already-wired dynamic content (the utility recipes
        // are full of them) and paste fine as they are.
        const hasPlaceholders = props.placeholderService.extractPlaceholders(action.actionJson || '').length > 0;

        const extraButtons: IActionRowButton[] = [];
        if (hasPlaceholders) {
            extraButtons.push({
                key: 'copy-with-options',
                iconName: 'VariableGroup',
                label: 'Copy with options (fill placeholders)',
                onClick: () => setActionForCopyWithOptions(action),
                className: 'App-Action-Info',
            });
        }
        if (catalogAction && props.onConfiguredAction) {
            extraButtons.push({
                key: 'configure',
                iconName: 'EditSolid12',
                label: 'Configure parameters',
                onClick: () => setConfiguringAction(catalogAction),
                className: 'App-Action-Configure',
            });
        }

        return (
            <ActionRow
                key={action.id}
                action={action}
                rowTitle={action.description || action.url}
                onToggleSelect={props.changeSelectionFunc}
                onShowDetails={showActionDetails}
                onToggleFavorite={props.toggleFavoriteFunc}
                extraButtons={extraButtons}
            />
        );
    }, [props, showActionDetails, getCatalogAction]);

    const categoryOptions = useMemo<IDropdownOption[]>(() => {
        const categories: string[] = [];
        for (const action of props.actions) {
            if (action.category && categories.indexOf(action.category) === -1) {
                categories.push(action.category);
            }
        }
        return [
            { key: ALL_CATEGORIES, text: `All categories (${props.actions.length})` },
            ...categories.map(category => ({
                key: category,
                text: `${category} (${props.actions.filter(a => a.category === category).length})`,
            })),
        ];
    }, [props.actions]);

    // Search matches description as well as title; with 40+ presets the title
    // alone is often not what the user remembers.
    const filteredActions = useMemo(() => {
        const term = props.searchTerm?.trim().toLowerCase() || '';
        return props.actions.filter(action => {
            if (categoryFilter !== ALL_CATEGORIES && action.category !== categoryFilter) {
                return false;
            }
            if (term === '') { return true; }
            return action.title.toLowerCase().includes(term)
                || (action.description?.toLowerCase().includes(term) ?? false);
        });
    }, [props.actions, props.searchTerm, categoryFilter]);

    /** Group into category sections, preserving first-seen order. */
    const groupedActions = useMemo(() => {
        const groups: { category: string; actions: IActionModel[] }[] = [];
        for (const action of filteredActions) {
            const category = action.category || 'Other';
            let group = groups.find(g => g.category === category);
            if (!group) {
                group = { category, actions: [] };
                groups.push(group);
            }
            group.actions.push(action);
        }
        return groups;
    }, [filteredActions]);

    const clearFilters = useCallback(() => {
        setCategoryFilter(ALL_CATEGORIES);
        props.onSearchChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.onSearchChange]);

    const renderSearch = () => (
        <div className="list-toolbar list-toolbar--wrap">
            <TextField
                className="list-toolbar-search"
                placeholder="Search by title or description..."
                ariaLabel="Search library by title or description"
                value={props.searchTerm}
                onChange={(_event, newValue) => props.onSearchChange(newValue || '')}
                iconProps={{ iconName: 'Search' }}
            />
            <Dropdown
                className="list-toolbar-filter"
                selectedKey={categoryFilter}
                options={categoryOptions}
                onChange={(_e, option) => setCategoryFilter((option?.key as string) || ALL_CATEGORIES)}
                ariaLabel="Filter by category"
            />
            {props.onRefresh && (
                <TooltipHost content="Refresh library">
                    <IconButton
                        iconProps={{ iconName: 'Refresh' }}
                        ariaLabel="Refresh library"
                        onClick={props.onRefresh}
                    />
                </TooltipHost>
            )}
        </div>
    );

    if (props.isLoading) {
        return (
            <div className="list-loading">
                <Spinner size={SpinnerSize.medium} label="Loading predefined actions..." />
            </div>
        );
    }

    // Only nag about the Function App URL when utility presets are on screen.
    const visibleUnresolvedUtility = filteredActions.some(action =>
        isUtilityAction(action) && utilityActionsService.hasUnresolvedTokens(action));

    const renderEmpty = () => {
        if (props.actions.length === 0) {
            return (
                <EmptyState
                    iconName="Library"
                    title="No predefined actions available"
                    hint="Turn on the default catalog or add an action pack URL in Settings."
                    actionText={props.onOpenSettings ? 'Open library settings' : undefined}
                    onAction={props.onOpenSettings ? () => props.onOpenSettings!('library') : undefined}
                />
            );
        }
        const term = props.searchTerm?.trim() || '';
        const categoryLabel = categoryFilter === ALL_CATEGORIES ? 'all categories' : categoryFilter;
        return (
            <EmptyState
                iconName="SearchIssue"
                title={term ? `No actions match '${term}' in ${categoryLabel}` : `No actions in ${categoryLabel}`}
                actionText="Clear filters"
                onAction={clearFilters}
            />
        );
    };

    return (
        <>
            {renderSearch()}
            {visibleUnresolvedUtility && (
                <MessageBar messageBarType={MessageBarType.warning} isMultiline={true}>
                    Set the Function App URL in Settings to make the utility presets runnable.{' '}
                    {props.onOpenSettings && (
                        <Link onClick={() => props.onOpenSettings!('utility')}>Open utility settings</Link>
                    )}
                </MessageBar>
            )}
            <div className="App-Actions">
                {filteredActions.length === 0 ? renderEmpty() : (
                    groupedActions.map(group => (
                        <div key={group.category} role="group" aria-label={group.category}>
                            <div className="list-group-header">{group.category}</div>
                            {group.actions.map((action) => renderAction(action))}
                        </div>
                    ))
                )}
            </div>
            {actionForCopyWithOptions && (
                <CopyWithOptionsModal
                    action={actionForCopyWithOptions}
                    placeholderService={props.placeholderService}
                    onCopy={handleCopyWithOptions}
                    onSaveAsFavorite={handleSaveAsFavorite}
                    onDismiss={() => setActionForCopyWithOptions(null)}
                />
            )}
            <ActionDetailsPanel
                action={selectedActionForDetails}
                isOpen={isPanelOpen}
                onDismiss={hideActionDetails}
                placeholderService={props.placeholderService}
            />
            <UtilityActionForm
                action={configuringAction}
                config={props.utilityConfig || {}}
                isOpen={configuringAction !== null}
                onDismiss={() => setConfiguringAction(null)}
                onApply={(action) => props.onConfiguredAction?.(action)}
            />
        </>
    );
};

export default PredefinedActionsList;
