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
  Modal,
  IconButton,
} from '@fluentui/react';
import { FlowAction } from '../../services/FlowAnalyzer';

interface InputAnalysisTabProps {
  actions: FlowAction[];
  onExportCsv: (data: any[], filename: string) => void;
}

interface ActionInput {
  actionName: string;
  actionType: string;
  hasSecureInputs: boolean;
  hasEnvironmentVars: boolean;
  inputSummary: string;
  rawInputs: string;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: '#fff',
  marginBottom: '12px',
});

const secureCardStyles = mergeStyles({
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: '#f0f6ff',
  borderLeft: '4px solid #0078d4',
  marginBottom: '12px',
});

export const InputAnalysisTab: React.FC<InputAnalysisTabProps> = ({
  actions,
  onExportCsv,
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedInput, setSelectedInput] = useState<ActionInput | null>(null);

  // Extract and analyze inputs from actions
  const actionInputs: ActionInput[] = useMemo(() => {
    return actions.map((action) => {
      let rawInputs = '';
      let inputSummary = '';
      let hasEnvironmentVars = false;

      try {
        if (action.object) {
          const actionObj = JSON.parse(action.object);
          if (actionObj.inputs) {
            rawInputs = JSON.stringify(actionObj.inputs, null, 2);

            // Check for environment variables
            const inputStr = JSON.stringify(actionObj.inputs);
            hasEnvironmentVars =
              inputStr.includes('@parameters(') ||
              inputStr.includes("@parameters('") ||
              inputStr.includes('@{parameters(');

            // Create summary
            const summaryParts: string[] = [];
            if (actionObj.inputs.method) {
              summaryParts.push(`Method: ${actionObj.inputs.method}`);
            }
            if (actionObj.inputs.uri) {
              summaryParts.push(`URI: ${actionObj.inputs.uri.substring(0, 50)}...`);
            }
            if (actionObj.inputs.path) {
              summaryParts.push(`Path: ${actionObj.inputs.path}`);
            }
            if (actionObj.inputs.host?.operationId) {
              summaryParts.push(`Operation: ${actionObj.inputs.host.operationId}`);
            }
            inputSummary = summaryParts.join(', ') || 'See details';
          }
        }
      } catch {
        // Ignore parse errors
      }

      return {
        actionName: action.Name,
        actionType: action.Type,
        hasSecureInputs: action.secure === 'Yes',
        hasEnvironmentVars,
        inputSummary: inputSummary || action.detail || '-',
        rawInputs: rawInputs || '{}',
      };
    });
  }, [actions]);

  // Apply search filter
  const filteredInputs = useMemo(() => {
    if (!searchText) return actionInputs;
    const lowerSearch = searchText.toLowerCase();
    return actionInputs.filter(
      (i) =>
        i.actionName.toLowerCase().includes(lowerSearch) ||
        i.actionType.toLowerCase().includes(lowerSearch) ||
        i.inputSummary.toLowerCase().includes(lowerSearch)
    );
  }, [actionInputs, searchText]);

  // Stats
  const secureCount = actionInputs.filter((i) => i.hasSecureInputs).length;
  const envVarCount = actionInputs.filter((i) => i.hasEnvironmentVars).length;

  const columns: IColumn[] = useMemo(
    () => [
      {
        key: 'name',
        name: 'Action Name',
        fieldName: 'actionName',
        minWidth: 150,
        maxWidth: 200,
        isResizable: true,
      },
      {
        key: 'type',
        name: 'Type',
        fieldName: 'actionType',
        minWidth: 100,
        maxWidth: 150,
        isResizable: true,
      },
      {
        key: 'secure',
        name: 'Secure',
        minWidth: 60,
        maxWidth: 80,
        onRender: (item: ActionInput) => (
          <Icon
            iconName={item.hasSecureInputs ? 'Lock' : ''}
            styles={{
              root: {
                color: item.hasSecureInputs ? '#0078d4' : 'transparent',
                fontSize: 16,
              },
            }}
          />
        ),
      },
      {
        key: 'envVar',
        name: 'Env Vars',
        minWidth: 60,
        maxWidth: 80,
        onRender: (item: ActionInput) => (
          <Icon
            iconName={item.hasEnvironmentVars ? 'Variable' : ''}
            styles={{
              root: {
                color: item.hasEnvironmentVars ? '#8764b8' : 'transparent',
                fontSize: 16,
              },
            }}
          />
        ),
      },
      {
        key: 'summary',
        name: 'Input Summary',
        fieldName: 'inputSummary',
        minWidth: 200,
        isResizable: true,
      },
      {
        key: 'view',
        name: '',
        minWidth: 60,
        maxWidth: 60,
        onRender: (item: ActionInput) => (
          <IconButton
            iconProps={{ iconName: 'View' }}
            title="View Details"
            onClick={() => setSelectedInput(item)}
            styles={{ root: { height: 24 } }}
          />
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
              {actionInputs.length}
            </Text>
            <Text variant="small">Total Actions</Text>
          </Stack>
          <Stack>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#0078d4' } }}>
              {secureCount}
            </Text>
            <Text variant="small">Secure Inputs</Text>
          </Stack>
          <Stack>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#8764b8' } }}>
              {envVarCount}
            </Text>
            <Text variant="small">Use Env Variables</Text>
          </Stack>
        </Stack>
      </div>

      {/* Security Info */}
      {secureCount > 0 && (
        <div className={secureCardStyles}>
          <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
            <Icon iconName="Lock" styles={{ root: { color: '#0078d4', fontSize: 20 } }} />
            <Text>
              <strong>{secureCount} action(s)</strong> have secure inputs enabled. Input values are
              hidden in run history for these actions.
            </Text>
          </Stack>
        </div>
      )}

      {/* Environment Variables Info */}
      {envVarCount > 0 && (
        <div className={cardStyles} style={{ backgroundColor: '#f5f0ff', borderLeft: '4px solid #8764b8' }}>
          <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
            <Icon iconName="Variable" styles={{ root: { color: '#8764b8', fontSize: 20 } }} />
            <Text>
              <strong>{envVarCount} action(s)</strong> reference environment variables using
              @parameters(). These values are configured at the solution level.
            </Text>
          </Stack>
        </div>
      )}

      {/* Search and Export */}
      <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center">
        <SearchBox
          placeholder="Search actions..."
          value={searchText}
          onChange={(_, newValue) => setSearchText(newValue || '')}
          styles={{ root: { width: 250 } }}
        />
        <Text
          styles={{ root: { color: '#0078d4', cursor: 'pointer' } }}
          onClick={() =>
            onExportCsv(
              filteredInputs.map((i) => ({
                Name: i.actionName,
                Type: i.actionType,
                SecureInputs: i.hasSecureInputs ? 'Yes' : 'No',
                EnvironmentVars: i.hasEnvironmentVars ? 'Yes' : 'No',
                Summary: i.inputSummary,
              })),
              'action-inputs'
            )
          }
        >
          Export CSV
        </Text>
      </Stack>

      {/* Actions List */}
      <div className={cardStyles}>
        <DetailsList
          items={filteredInputs}
          columns={columns}
          layoutMode={DetailsListLayoutMode.justified}
          selectionMode={SelectionMode.none}
          isHeaderVisible={true}
          compact
        />
      </div>

      {/* Input Details Modal */}
      <Modal
        isOpen={!!selectedInput}
        onDismiss={() => setSelectedInput(null)}
        isBlocking={false}
        styles={{
          main: {
            maxWidth: 800,
            width: '90%',
            maxHeight: '80vh',
          },
        }}
      >
        {selectedInput && (
          <Stack tokens={{ childrenGap: 16 }} styles={{ root: { padding: 24 } }}>
            <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
              <Text variant="xLarge" styles={{ root: { fontWeight: 600 } }}>
                {selectedInput.actionName}
              </Text>
              <IconButton
                iconProps={{ iconName: 'Cancel' }}
                onClick={() => setSelectedInput(null)}
              />
            </Stack>

            <Stack horizontal tokens={{ childrenGap: 16 }}>
              <Text>
                <strong>Type:</strong> {selectedInput.actionType}
              </Text>
              {selectedInput.hasSecureInputs && (
                <Stack horizontal tokens={{ childrenGap: 4 }} verticalAlign="center">
                  <Icon iconName="Lock" styles={{ root: { color: '#0078d4' } }} />
                  <Text>Secure Inputs</Text>
                </Stack>
              )}
              {selectedInput.hasEnvironmentVars && (
                <Stack horizontal tokens={{ childrenGap: 4 }} verticalAlign="center">
                  <Icon iconName="Variable" styles={{ root: { color: '#8764b8' } }} />
                  <Text>Environment Variables</Text>
                </Stack>
              )}
            </Stack>

            <Text variant="mediumPlus" styles={{ root: { fontWeight: 600 } }}>
              Raw Inputs
            </Text>
            <pre
              style={{
                backgroundColor: '#f3f2f1',
                padding: 16,
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: 400,
                fontSize: 12,
                fontFamily: 'Consolas, Monaco, monospace',
              }}
            >
              {selectedInput.rawInputs}
            </pre>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default InputAnalysisTab;
