import { useCallback, useMemo, useState } from "react";
import { Icon, TextField, Panel, PanelType, Spinner, SpinnerSize, Checkbox, Dropdown, IDropdownOption, MessageBar, MessageBarType } from "@fluentui/react";
import { IActionModel } from "../models";
import { IUtilityAction } from "../models/IUtilityCatalog";
import { IUtilityFunctionConfig, utilityActionsService } from "../services/UtilityActionsService";
import UtilityActionForm from "./UtilityActionForm";

const ALL_CATEGORIES = '__all__';
import { PlaceholderService } from "../services/PlaceholderService";
import CopyWithOptionsModal from "./CopyWithOptionsModal";

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
}

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

    const renderActionDetails = useCallback(() => {
        if (!selectedActionForDetails) return null;

        let parsedBody: any = null;
        let parsedHeaders: any = null;
        let parsedActionData: any = null;
        
        try {
            parsedActionData = JSON.parse(selectedActionForDetails.actionJson);
            parsedBody = parsedActionData.body || selectedActionForDetails.body;
            parsedHeaders = parsedActionData.headers;
        } catch (e) {
            parsedBody = selectedActionForDetails.body;
        }

        return (
            <Panel
                isOpen={isPanelOpen}
                onDismiss={hideActionDetails}
                type={PanelType.custom}
                customWidth="450px"
                headerText={`Action Details: ${selectedActionForDetails.title}`}
                closeButtonAriaLabel="Close"
                styles={{
                    content: { padding: '20px' }
                }}
            >
                <div style={{ fontSize: '14px', lineHeight: '1.5' }}>
                    <div style={{ marginBottom: '15px' }}>
                        <strong>URL:</strong>
                        <div style={{ 
                            backgroundColor: 'var(--color-bg-subtle)', 
                            padding: '8px', 
                            marginTop: '5px', 
                            borderRadius: '4px',
                            wordBreak: 'break-all',
                            fontFamily: 'monospace',
                            fontSize: '12px'
                        }}>
                            {selectedActionForDetails.url}
                        </div>
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                        <strong>Method:</strong>
                        <div style={{ 
                            backgroundColor: 'var(--color-bg-subtle)', 
                            padding: '8px', 
                            marginTop: '5px', 
                            borderRadius: '4px',
                            fontFamily: 'monospace',
                            fontSize: '12px'
                        }}>
                            {selectedActionForDetails.method}
                        </div>
                    </div>

                    {parsedHeaders && (
                        <div style={{ marginBottom: '15px' }}>
                            <strong>Headers:</strong>
                            <div style={{ 
                                backgroundColor: 'var(--color-bg-subtle)', 
                                padding: '8px', 
                                marginTop: '5px', 
                                borderRadius: '4px',
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                whiteSpace: 'pre-wrap'
                            }}>
                                {JSON.stringify(parsedHeaders, null, 2)}
                            </div>
                        </div>
                    )}

                    {parsedBody && (
                        <div style={{ marginBottom: '15px' }}>
                            <strong>Body:</strong>
                            <div style={{ 
                                backgroundColor: 'var(--color-bg-subtle)', 
                                padding: '8px', 
                                marginTop: '5px', 
                                borderRadius: '4px',
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                whiteSpace: 'pre-wrap',
                                maxHeight: '300px',
                                overflowY: 'auto'
                            }}>
                                {typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody, null, 2)}
                            </div>
                        </div>
                    )}

                    <div style={{ marginBottom: '15px' }}>
                        <strong>Raw Action JSON:</strong>
                        <div style={{ 
                            backgroundColor: 'var(--color-bg-subtle)', 
                            padding: '8px', 
                            marginTop: '5px', 
                            borderRadius: '4px',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            whiteSpace: 'pre-wrap',
                            maxHeight: '200px',
                            overflowY: 'auto'
                        }}>
                            {parsedActionData ? JSON.stringify(parsedActionData, null, 2) : selectedActionForDetails.actionJson}
                        </div>
                    </div>
                </div>
            </Panel>
        );
    }, [selectedActionForDetails, isPanelOpen, hideActionDetails]);

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

        return (
            <div className='App-Action-Row' key={action.id} title={action.description || action.url}>
                <Checkbox className='App-Action-Checkbox' checked={action.isSelected} defaultChecked={action.isSelected} onChange={() => { props.changeSelectionFunc?.(action) }}></Checkbox>
                <img src={action.icon} className='App-Action-Icon' alt={action.title}></img>
                <span className='App-Action-Element'>
                    {action.title}
                    {action.warning && (
                        <Icon
                            iconName='Warning'
                            title={action.warning}
                            style={{ color: 'var(--color-danger)', marginLeft: '6px', verticalAlign: 'middle' }}
                        />
                    )}
                </span>
                <span className='App-Action-Element'>{action.method}</span>
                <Icon
                    className='App-Action-Info'
                    iconName='Info'
                    onClick={() => showActionDetails(action)}
                    title="Show Action Details"
                ></Icon>
                {hasPlaceholders && (
                    <Icon
                        className='App-Action-Info'
                        iconName='VariableGroup'
                        onClick={() => setActionForCopyWithOptions(action)}
                        title="Copy with options (fill placeholders)"
                        style={{ color: 'var(--color-brand)' }}
                    ></Icon>
                )}
                {props.toggleFavoriteFunc && (
                    <Icon
                        className='App-Action-Favorite'
                        iconName={action.isFavorite ? 'FavoriteStarFill' : 'FavoriteStar'}
                        onClick={() => { props.toggleFavoriteFunc!(action) }}
                        title={action.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                    ></Icon>
                )}
                {catalogAction && props.onConfiguredAction ? (
                    <Icon
                        iconName='Settings'
                        onClick={() => setConfiguringAction(catalogAction)}
                        title="Fill in parameters before pasting"
                        style={{ cursor: 'pointer', width: '30px' }}
                    />
                ) : (
                    <div style={{ width: '30px' }}></div>
                )}
            </div>
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

    const renderHeader = useCallback(() => {
        const headerClassName = `App-Action-Header ${props.toggleFavoriteFunc ? 'App-Action-Header--with-favorite' : 'App-Action-Header--without-favorite'}`;
        return (
            <div className={headerClassName}>
                <span>Select</span>
                <span></span>
                <span>Title</span>
                <span>Method</span>
                <span>Info</span>
                {props.toggleFavoriteFunc && <span>Fav</span>}
                <span></span>
            </div>
        );
    }, [props.toggleFavoriteFunc]);

    const renderSearch = useCallback(() => {
        return (
            <div style={{ padding: '10px 20px', backgroundColor: 'var(--color-bg-subtle)', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <TextField
                    placeholder="Search by title or description..."
                    value={props.searchTerm}
                    onChange={(_event, newValue) => props.onSearchChange(newValue || '')}
                    styles={{
                        root: { flex: 1 },
                        field: { fontSize: '14px' }
                    }}
                    iconProps={{ iconName: 'Search' }}
                />
                <Dropdown
                    selectedKey={categoryFilter}
                    options={categoryOptions}
                    onChange={(_e, option) => setCategoryFilter((option?.key as string) || ALL_CATEGORIES)}
                    styles={{ root: { minWidth: 170 } }}
                    ariaLabel="Filter by category"
                />
                {props.onRefresh && (
                    <Icon
                        iconName="Refresh"
                        onClick={props.onRefresh}
                        title="Refresh predefined actions"
                        style={{ cursor: 'pointer', fontSize: '16px', color: 'var(--color-success)' }}
                    />
                )}
            </div>
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.searchTerm, props.onSearchChange, props.onRefresh, categoryFilter, categoryOptions]);

    if (props.isLoading) {
        return (
            <div style={{ padding: '20px', textAlign: 'center' }}>
                <Spinner size={SpinnerSize.medium} label="Loading predefined actions..." />
            </div>
        );
    }

    const hasUnresolvedTokens = props.actions.some(action => utilityActionsService.hasUnresolvedTokens(action));

    return (
        <>
            <div>{renderHeader()}</div>
            <div>{renderSearch()}</div>
            {hasUnresolvedTokens && (
                <MessageBar messageBarType={MessageBarType.warning} isMultiline={false}>
                    Set the Function App URL in Settings to make these presets runnable.
                </MessageBar>
            )}
            <div className="App-Actions">
                {filteredActions.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-fg-secondary)' }}>
                        <Icon iconName="Info" style={{ fontSize: '24px', marginBottom: '10px' }} />
                        <div>No predefined actions available</div>
                    </div>
                ) : (
                    groupedActions.map(group => (
                        <div key={group.category}>
                            <div style={{
                                padding: '6px 20px',
                                backgroundColor: 'var(--color-bg-subtle)',
                                borderTop: '1px solid var(--color-stroke-subtle)',
                                borderBottom: '1px solid var(--color-stroke-subtle)',
                                fontSize: '11px',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.4px',
                                color: 'var(--color-fg-secondary)',
                            }}>
                                {group.category}
                            </div>
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
            {renderActionDetails()}
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
