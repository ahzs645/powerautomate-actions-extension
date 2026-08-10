import { IconButton } from '@fluentui/react/lib/Button';
import { CommandBar, ICommandBarItemProps } from '@fluentui/react/lib/CommandBar';
import {
  DetailsList,
  DetailsListLayoutMode,
  IColumn,
  Selection,
  SelectionMode,
} from '@fluentui/react/lib/DetailsList';
import { Dropdown, IDropdownOption } from '@fluentui/react/lib/Dropdown';
import { Label } from '@fluentui/react/lib/Label';
import { Pivot, PivotItem } from '@fluentui/react/lib/Pivot';
import { ProgressIndicator } from '@fluentui/react/lib/ProgressIndicator';
import { SearchBox } from '@fluentui/react/lib/SearchBox';
import { Stack } from '@fluentui/react/lib/Stack';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { Text } from '@fluentui/react/lib/Text';
import { useMemo, useState } from 'react';
import { LoaderModal } from '../../components/shared/LoaderModal';
import { Messages } from '../../components/shared/Messages';
import { OwnerBadge, StateBadge } from './FlowBadges';
import {
  ANY_STATE,
  countByOwner,
  DEFAULT_FILTERS,
  filterFlows,
  getAvailableStates,
  hasKnownOwners,
  OwnerTab,
} from './flowFilters';
import { FlowSummary } from './flowsApi';
import { useFlowsList } from './useFlowsList';

const listContainerClassName = mergeStyles({
  flex: 1,
  overflowY: 'auto',
  padding: '0 12px',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-fg)',
});

const filterBarClassName = mergeStyles({
  padding: '4px 12px 8px',
  backgroundColor: 'var(--color-bg)',
  borderBottom: '1px solid var(--color-stroke-subtle)',
});

/** Stable id so the Search label's htmlFor survives Fluent's generated ids. */
const SEARCH_INPUT_ID = 'flows-filter-search';

function formatDate(value?: string): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export const FlowsListPage: React.FC = () => {
  const {
    flows,
    isLoading,
    progress,
    loadFlows,
    downloadFlow,
    downloadFlowsAsZip,
    openInEditor,
    messages,
    onDismissed,
  } = useFlowsList();

  const [search, setSearch] = useState<string>(DEFAULT_FILTERS.search);
  const [owner, setOwner] = useState<OwnerTab>(DEFAULT_FILTERS.owner);
  const [state, setState] = useState<string>(DEFAULT_FILTERS.state);
  const [selectedCount, setSelectedCount] = useState<number>(0);

  const filters = useMemo(() => ({ search, owner, state }), [search, owner, state]);
  const filteredFlows = useMemo(() => filterFlows(flows, filters), [flows, filters]);
  const ownerCounts = useMemo(() => countByOwner(flows, filters), [flows, filters]);
  const showOwnerTabs = useMemo(() => hasKnownOwners(flows), [flows]);

  const stateOptions: IDropdownOption[] = useMemo(
    () => [
      { key: ANY_STATE, text: 'Any status' },
      ...getAvailableStates(flows).map((value) => ({ key: value, text: value })),
    ],
    [flows]
  );

  const selection = useMemo(() => {
    const sel: Selection = new Selection({
      onSelectionChanged: () => setSelectedCount(sel.getSelectedCount()),
    });
    return sel;
    // Selection tracks rows by index, so it has to be rebuilt when filtering
    // changes which rows are on screen - otherwise the wrong flows get downloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFlows]);

  const columns: IColumn[] = useMemo(
    () => [
      {
        key: 'displayName',
        name: 'Flow',
        fieldName: 'displayName',
        minWidth: 220,
        maxWidth: 520,
        isResizable: true,
      },
      {
        key: 'scope',
        name: 'Owner',
        minWidth: 90,
        maxWidth: 110,
        onRender: (flow: FlowSummary) => <OwnerBadge scope={flow.scope} />,
      },
      {
        key: 'state',
        name: 'Status',
        minWidth: 110,
        maxWidth: 130,
        onRender: (flow: FlowSummary) => <StateBadge state={flow.state} />,
      },
      {
        key: 'lastModifiedTime',
        name: 'Modified',
        minWidth: 150,
        maxWidth: 190,
        onRender: (flow: FlowSummary) => formatDate(flow.lastModifiedTime),
      },
      {
        key: 'actions',
        name: 'Actions',
        minWidth: 90,
        maxWidth: 90,
        onRender: (flow: FlowSummary) => (
          <Stack horizontal tokens={{ childrenGap: 4 }}>
            <IconButton
              iconProps={{ iconName: 'Download' }}
              title={`Download "${flow.displayName}" as JSON`}
              ariaLabel={`Download ${flow.displayName} as JSON`}
              onClick={() => downloadFlow(flow)}
            />
            <IconButton
              iconProps={{ iconName: 'Edit' }}
              title={`Open "${flow.displayName}" in the JSON editor`}
              ariaLabel={`Open ${flow.displayName} in the JSON editor`}
              onClick={() => openInEditor(flow)}
            />
          </Stack>
        ),
      },
    ],
    [downloadFlow, openInEditor]
  );

  const commandBarItems: ICommandBarItemProps[] = useMemo(
    () => [
      {
        key: 'count',
        text:
          filteredFlows.length === flows.length
            ? `${flows.length} flow${flows.length === 1 ? '' : 's'}`
            : `${filteredFlows.length} of ${flows.length} flows`,
      },
      {
        key: 'refresh',
        text: 'Refresh',
        iconProps: { iconName: 'Refresh' },
        onClick: () => {
          loadFlows();
        },
      },
      {
        key: 'downloadSelected',
        text: selectedCount > 0 ? `Download selected (${selectedCount})` : 'Download selected',
        iconProps: { iconName: 'ZipFolder' },
        disabled: selectedCount === 0,
        onClick: () => {
          downloadFlowsAsZip(selection.getSelection() as FlowSummary[]);
        },
      },
      {
        key: 'downloadFiltered',
        // Downloading "all" while a filter hides rows would be a nasty surprise,
        // so the label follows whatever is currently on screen.
        text:
          filteredFlows.length === flows.length
            ? 'Download all (.zip)'
            : `Download filtered (${filteredFlows.length})`,
        iconProps: { iconName: 'Download' },
        disabled: filteredFlows.length === 0,
        onClick: () => {
          downloadFlowsAsZip(filteredFlows);
        },
      },
    ],
    [flows, filteredFlows, selection, selectedCount, loadFlows, downloadFlowsAsZip]
  );

  return (
    <Stack styles={{ root: { flex: 1, overflow: 'hidden', backgroundColor: 'var(--color-bg)' } }}>
      <CommandBar items={commandBarItems} />
      <Messages items={messages} onDismissed={onDismissed} />

      {progress && (
        <ProgressIndicator
          label={`Downloading definitions (${progress.done}/${progress.total})`}
          percentComplete={progress.total ? progress.done / progress.total : 0}
          styles={{ root: { padding: '0 12px' } }}
        />
      )}

      {showOwnerTabs && (
        <Pivot
          selectedKey={owner}
          onLinkClick={(item) => setOwner((item?.props.itemKey as OwnerTab) || 'all')}
          styles={{ root: { padding: '0 12px' } }}
        >
          <PivotItem itemKey="all" headerText="All" itemCount={ownerCounts.all} />
          <PivotItem itemKey="personal" headerText="Mine" itemCount={ownerCounts.personal} />
          <PivotItem itemKey="team" headerText="Shared with me" itemCount={ownerCounts.team} />
        </Pivot>
      )}

      <div className={filterBarClassName}>
        {/* Both controls are label-over-input so they share a baseline. Aligning a
            bare SearchBox against a labelled Dropdown only ever lines up one edge. */}
        <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="end" wrap>
          <Stack.Item>
            <Label htmlFor={SEARCH_INPUT_ID}>Search</Label>
            <SearchBox
              id={SEARCH_INPUT_ID}
              placeholder="Filter flows by name"
              value={search}
              onChange={(_, newValue) => setSearch(newValue || '')}
              onClear={() => setSearch('')}
              styles={{ root: { width: 300 } }}
            />
          </Stack.Item>
          <Dropdown
            label="Status"
            selectedKey={state}
            options={stateOptions}
            onChange={(_, option) => setState((option?.key as string) || ANY_STATE)}
            styles={{ root: { width: 170 } }}
          />
        </Stack>
      </div>

      <div className={listContainerClassName}>
        {!isLoading && flows.length === 0 ? (
          <Text styles={{ root: { display: 'block', padding: 16, color: 'var(--color-fg-secondary)' } }}>
            No flows found in this environment.
          </Text>
        ) : !isLoading && filteredFlows.length === 0 ? (
          <Text styles={{ root: { display: 'block', padding: 16, color: 'var(--color-fg-secondary)' } }}>
            No flows match the current filters.
          </Text>
        ) : (
          <DetailsList
            items={filteredFlows}
            columns={columns}
            getKey={(flow: FlowSummary) => flow.id}
            setKey={`flows-${owner}-${state}-${filteredFlows.length}`}
            selection={selection}
            selectionMode={SelectionMode.multiple}
            selectionPreservedOnEmptyClick
            layoutMode={DetailsListLayoutMode.justified}
            ariaLabelForSelectionColumn="Toggle selection"
            checkButtonAriaLabel="Select flow"
          />
        )}
      </div>

      {isLoading && !progress && <LoaderModal />}
    </Stack>
  );
};
