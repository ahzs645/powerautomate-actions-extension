import React, { useMemo, useState } from 'react';
import {
  Stack,
  Text,
  DetailsList,
  DetailsListLayoutMode,
  SelectionMode,
  IColumn,
  SearchBox,
  Icon,
  mergeStyles,
  MessageBar,
  MessageBarType,
} from '@fluentui/react';
import { FlowAction } from '../../services/FlowAnalyzer';

interface ApiActionsTabProps {
  actions: FlowAction[];
  onExportCsv: (data: any[], filename: string) => void;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: '#fff',
  marginBottom: '12px',
});

const warningCardStyles = mergeStyles({
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: '#fff4ce',
  borderLeft: '4px solid #ff8c00',
  marginBottom: '12px',
});

export const ApiActionsTab: React.FC<ApiActionsTabProps> = ({
  actions,
  onExportCsv,
}) => {
  const [searchText, setSearchText] = useState('');

  // Filter for API-related actions
  const apiActions = useMemo(() => {
    return actions.filter(
      (a) =>
        a.Type === 'OpenApiConnection' ||
        a.Type === 'ApiConnection' ||
        a.Type === 'Http' ||
        a.Type === 'HttpWebhook' ||
        a.Type === 'OpenApiConnectionWebhook' ||
        a.Type === 'ApiConnectionWebhook' ||
        a.connector.includes('shared_')
    );
  }, [actions]);

  // Apply search filter
  const filteredActions = useMemo(() => {
    if (!searchText) return apiActions;
    const lowerSearch = searchText.toLowerCase();
    return apiActions.filter(
      (a) =>
        a.Name.toLowerCase().includes(lowerSearch) ||
        a.connector.toLowerCase().includes(lowerSearch) ||
        a.step.toLowerCase().includes(lowerSearch) ||
        a.detail.toLowerCase().includes(lowerSearch)
    );
  }, [apiActions, searchText]);

  // Find issues
  const issues = useMemo(() => {
    const issueList: { action: string; issue: string; severity: 'warning' | 'info' }[] = [];

    for (const action of apiActions) {
      // Check GetItems without filter
      if (
        (action.step.includes('GetItems') || action.Name.toLowerCase().includes('get items')) &&
        !action.filter
      ) {
        issueList.push({
          action: action.Name,
          issue: 'Missing filter query - may return too many items',
          severity: 'warning',
        });
      }

      // Check pagination
      if (
        (action.step.includes('GetItems') || action.Name.toLowerCase().includes('get items')) &&
        action.pagination === 'No'
      ) {
        issueList.push({
          action: action.Name,
          issue: 'Pagination not enabled - may miss items if list exceeds threshold',
          severity: 'info',
        });
      }

      // Check for missing retry policy on HTTP actions
      if (
        (action.Type === 'Http' || action.Type === 'HttpWebhook') &&
        action.retry === 'Default'
      ) {
        issueList.push({
          action: action.Name,
          issue: 'Using default retry policy - consider configuring custom retry',
          severity: 'info',
        });
      }

      // Check for secure inputs
      if (action.secure === 'Yes') {
        issueList.push({
          action: action.Name,
          issue: 'Secure inputs enabled - values hidden in run history',
          severity: 'info',
        });
      }
    }

    return issueList;
  }, [apiActions]);

  const columns: IColumn[] = useMemo(
    () => [
      {
        key: 'name',
        name: 'Name',
        fieldName: 'Name',
        minWidth: 150,
        maxWidth: 200,
        isResizable: true,
      },
      {
        key: 'step',
        name: 'Operation',
        fieldName: 'step',
        minWidth: 100,
        maxWidth: 150,
        isResizable: true,
      },
      {
        key: 'connector',
        name: 'Connector',
        fieldName: 'connector',
        minWidth: 120,
        maxWidth: 180,
        isResizable: true,
      },
      {
        key: 'filter',
        name: 'Filter',
        fieldName: 'filter',
        minWidth: 100,
        maxWidth: 200,
        isResizable: true,
        onRender: (item: FlowAction) => (
          <Text
            styles={{
              root: {
                color: item.filter ? '#323130' : '#a19f9d',
                fontStyle: item.filter ? 'normal' : 'italic',
              },
            }}
          >
            {item.filter || 'None'}
          </Text>
        ),
      },
      {
        key: 'pagination',
        name: 'Pagination',
        minWidth: 80,
        maxWidth: 100,
        onRender: (item: FlowAction) => (
          <Icon
            iconName={item.pagination === 'Yes' ? 'CheckMark' : 'Cancel'}
            styles={{
              root: { color: item.pagination === 'Yes' ? '#107c10' : '#a19f9d' },
            }}
          />
        ),
      },
      {
        key: 'retry',
        name: 'Retry Policy',
        fieldName: 'retry',
        minWidth: 80,
        maxWidth: 120,
        isResizable: true,
        onRender: (item: FlowAction) => (
          <Text
            styles={{
              root: {
                color: item.retry !== 'Default' ? '#107c10' : '#a19f9d',
              },
            }}
          >
            {item.retry === 'Default' ? 'Default' : 'Custom'}
          </Text>
        ),
      },
      {
        key: 'secure',
        name: 'Secure',
        minWidth: 60,
        maxWidth: 80,
        onRender: (item: FlowAction) => (
          <Icon
            iconName={item.secure === 'Yes' ? 'Lock' : ''}
            styles={{
              root: { color: item.secure === 'Yes' ? '#0078d4' : 'transparent' },
            }}
          />
        ),
      },
      {
        key: 'tier',
        name: 'Tier',
        fieldName: 'tier',
        minWidth: 70,
        maxWidth: 90,
        onRender: (item: FlowAction) => (
          <Text
            styles={{
              root: {
                color: item.tier === 'Premium' ? '#8764b8' : '#107c10',
                fontWeight: 600,
              },
            }}
          >
            {item.tier}
          </Text>
        ),
      },
    ],
    []
  );

  return (
    <Stack tokens={{ childrenGap: 16 }} styles={{ root: { padding: '16px' } }}>
      {/* Summary */}
      <div className={cardStyles}>
        <Stack horizontal tokens={{ childrenGap: 24 }}>
          <Stack>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700 } }}>
              {apiActions.length}
            </Text>
            <Text variant="small">API Actions</Text>
          </Stack>
          <Stack>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#8764b8' } }}>
              {apiActions.filter((a) => a.tier === 'Premium').length}
            </Text>
            <Text variant="small">Premium</Text>
          </Stack>
          <Stack>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#ff8c00' } }}>
              {issues.filter((i) => i.severity === 'warning').length}
            </Text>
            <Text variant="small">Warnings</Text>
          </Stack>
        </Stack>
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className={warningCardStyles}>
          <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 8 } }}>
            API Configuration Issues
          </Text>
          <Stack tokens={{ childrenGap: 4 }}>
            {issues.slice(0, 5).map((issue, idx) => (
              <Stack key={idx} horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
                <Icon
                  iconName={issue.severity === 'warning' ? 'Warning' : 'Info'}
                  styles={{
                    root: {
                      color: issue.severity === 'warning' ? '#ff8c00' : '#0078d4',
                    },
                  }}
                />
                <Text>
                  <strong>{issue.action}:</strong> {issue.issue}
                </Text>
              </Stack>
            ))}
            {issues.length > 5 && (
              <Text styles={{ root: { color: '#605e5c', fontStyle: 'italic' } }}>
                ... and {issues.length - 5} more issues
              </Text>
            )}
          </Stack>
        </div>
      )}

      {/* Search and Export */}
      <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center">
        <SearchBox
          placeholder="Search API actions..."
          value={searchText}
          onChange={(_, newValue) => setSearchText(newValue || '')}
          styles={{ root: { width: 250 } }}
        />
        <Text
          styles={{ root: { color: '#0078d4', cursor: 'pointer' } }}
          onClick={() =>
            onExportCsv(
              filteredActions.map((a) => ({
                Name: a.Name,
                Operation: a.step,
                Connector: a.connector,
                Filter: a.filter || '',
                Pagination: a.pagination,
                Retry: a.retry,
                Secure: a.secure,
                Tier: a.tier,
              })),
              'api-actions'
            )
          }
        >
          Export CSV
        </Text>
      </Stack>

      {/* Actions List */}
      <div className={cardStyles}>
        {filteredActions.length > 0 ? (
          <DetailsList
            items={filteredActions}
            columns={columns}
            layoutMode={DetailsListLayoutMode.justified}
            selectionMode={SelectionMode.none}
            isHeaderVisible={true}
            compact
          />
        ) : (
          <MessageBar messageBarType={MessageBarType.info}>
            No API actions found in this flow.
          </MessageBar>
        )}
      </div>
    </Stack>
  );
};

export default ApiActionsTab;
