import React, { useState, useMemo, useCallback } from 'react';
import {
  Panel,
  PanelType,
  Stack,
  Text,
  DetailsList,
  DetailsListLayoutMode,
  SelectionMode,
  IColumn,
  MessageBar,
  MessageBarType,
  DefaultButton,
  PrimaryButton,
  mergeStyles,
  Icon,
} from '@fluentui/react';
import {
  FlowComparisonService,
  FlowComparisonResult,
  FlowDifference,
} from '../../services/FlowComparisonService';

interface FlowComparisonPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
  currentFlowDefinition: string;
  flowName: string;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: '#fff',
  marginBottom: '12px',
});

const metricStyles = (color: string) =>
  mergeStyles({
    padding: '12px 16px',
    borderRadius: '8px',
    backgroundColor: color,
    color: '#fff',
    textAlign: 'center',
    minWidth: '100px',
  });

export const FlowComparisonPanel: React.FC<FlowComparisonPanelProps> = ({
  isOpen,
  onDismiss,
  currentFlowDefinition,
  flowName,
}) => {
  const [comparisonResult, setComparisonResult] = useState<FlowComparisonResult | null>(null);
  const [hasStoredFlow, setHasStoredFlow] = useState(false);

  const comparisonService = useMemo(() => new FlowComparisonService(), []);

  // Check for stored flow on open
  React.useEffect(() => {
    if (isOpen) {
      setHasStoredFlow(comparisonService.hasStoredFlow());
      setComparisonResult(null);
    }
  }, [isOpen, comparisonService]);

  const handleStoreFlow = useCallback(() => {
    try {
      const parsed = JSON.parse(currentFlowDefinition);
      comparisonService.storeFlowForComparison(parsed);
      setHasStoredFlow(true);
      setComparisonResult(null);
    } catch (error) {
      console.error('Error storing flow:', error);
    }
  }, [currentFlowDefinition, comparisonService]);

  const handleCompare = useCallback(() => {
    try {
      const parsed = JSON.parse(currentFlowDefinition);
      const result = comparisonService.compareWithStored(parsed);
      setComparisonResult(result);
    } catch (error) {
      console.error('Error comparing flows:', error);
    }
  }, [currentFlowDefinition, comparisonService]);

  const handleClearStored = useCallback(() => {
    comparisonService.clearStoredFlow();
    setHasStoredFlow(false);
    setComparisonResult(null);
  }, [comparisonService]);

  const columns: IColumn[] = useMemo(
    () => [
      {
        key: 'kind',
        name: 'Type',
        minWidth: 80,
        maxWidth: 100,
        onRender: (item: FlowDifference) => (
          <Text
            styles={{
              root: {
                color: FlowComparisonService.getDifferenceColor(item.kind),
                fontWeight: 600,
              },
            }}
          >
            {FlowComparisonService.getDifferenceLabel(item.kind)}
          </Text>
        ),
      },
      {
        key: 'path',
        name: 'Path',
        fieldName: 'pathString',
        minWidth: 200,
        maxWidth: 400,
        isResizable: true,
        onRender: (item: FlowDifference) => (
          <Text
            styles={{
              root: { fontFamily: 'Consolas, monospace', fontSize: 12 },
            }}
          >
            {item.pathString || 'root'}
          </Text>
        ),
      },
      {
        key: 'lhs',
        name: 'Original Value',
        minWidth: 150,
        maxWidth: 250,
        isResizable: true,
        onRender: (item: FlowDifference) => (
          <Text
            styles={{
              root: {
                color: item.kind === 'D' ? '#d13438' : '#605e5c',
                fontSize: 12,
                fontFamily: 'Consolas, monospace',
              },
            }}
          >
            {item.lhs !== undefined ? truncateValue(item.lhs) : '-'}
          </Text>
        ),
      },
      {
        key: 'rhs',
        name: 'New Value',
        minWidth: 150,
        maxWidth: 250,
        isResizable: true,
        onRender: (item: FlowDifference) => (
          <Text
            styles={{
              root: {
                color: item.kind === 'N' ? '#107c10' : '#605e5c',
                fontSize: 12,
                fontFamily: 'Consolas, monospace',
              },
            }}
          >
            {item.rhs !== undefined ? truncateValue(item.rhs) : '-'}
          </Text>
        ),
      },
    ],
    []
  );

  return (
    <Panel
      isOpen={isOpen}
      onDismiss={onDismiss}
      type={PanelType.large}
      headerText={`Flow Comparison: ${flowName}`}
      closeButtonAriaLabel="Close"
    >
      <Stack tokens={{ childrenGap: 16, padding: 16 }}>
        {/* Instructions */}
        <MessageBar messageBarType={MessageBarType.info}>
          <strong>How to compare flows:</strong> First, store a baseline version of your flow.
          Then make changes and click "Compare" to see what changed.
        </MessageBar>

        {/* Actions */}
        <Stack horizontal tokens={{ childrenGap: 12 }}>
          <PrimaryButton
            iconProps={{ iconName: 'Save' }}
            text={hasStoredFlow ? 'Update Baseline' : 'Store as Baseline'}
            onClick={handleStoreFlow}
          />
          {hasStoredFlow && (
            <>
              <DefaultButton
                iconProps={{ iconName: 'Compare' }}
                text="Compare with Baseline"
                onClick={handleCompare}
              />
              <DefaultButton
                iconProps={{ iconName: 'Delete' }}
                text="Clear Baseline"
                onClick={handleClearStored}
              />
            </>
          )}
        </Stack>

        {/* Status */}
        {hasStoredFlow && !comparisonResult && (
          <div className={cardStyles} style={{ backgroundColor: '#f0f6ff' }}>
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
              <Icon iconName="CheckMark" styles={{ root: { color: '#107c10' } }} />
              <Text>Baseline flow stored. Make changes and click "Compare" to see differences.</Text>
            </Stack>
          </div>
        )}

        {/* Results */}
        {comparisonResult && (
          <>
            {/* Summary */}
            <div className={cardStyles}>
              <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
                Comparison Summary
              </Text>
              <Stack horizontal tokens={{ childrenGap: 12 }} wrap>
                <div className={metricStyles('#107c10')}>
                  <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                    {comparisonResult.newItems.length}
                  </Text>
                  <Text variant="small" styles={{ root: { color: '#fff' } }}>
                    Added
                  </Text>
                </div>
                <div className={metricStyles('#d13438')}>
                  <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                    {comparisonResult.deletedItems.length}
                  </Text>
                  <Text variant="small" styles={{ root: { color: '#fff' } }}>
                    Removed
                  </Text>
                </div>
                <div className={metricStyles('#ff8c00')}>
                  <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                    {comparisonResult.editedItems.length}
                  </Text>
                  <Text variant="small" styles={{ root: { color: '#fff' } }}>
                    Changed
                  </Text>
                </div>
                <div className={metricStyles('#0078d4')}>
                  <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
                    {comparisonResult.arrayChanges.length}
                  </Text>
                  <Text variant="small" styles={{ root: { color: '#fff' } }}>
                    Array Changes
                  </Text>
                </div>
              </Stack>
            </div>

            {/* Category Summary */}
            <div className={cardStyles}>
              <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
                Changes by Category
              </Text>
              <Stack horizontal tokens={{ childrenGap: 24 }} wrap>
                <Text>
                  <strong>Actions:</strong> +{comparisonResult.summary.actionsAdded} / -{comparisonResult.summary.actionsRemoved} / ~{comparisonResult.summary.actionsModified}
                </Text>
                <Text>
                  <strong>Variables:</strong> {comparisonResult.summary.variablesChanged} changes
                </Text>
                <Text>
                  <strong>Connections:</strong> {comparisonResult.summary.connectionsChanged} changes
                </Text>
                <Text>
                  <strong>Other:</strong> {comparisonResult.summary.otherChanges} changes
                </Text>
              </Stack>
            </div>

            {/* No differences */}
            {!comparisonResult.hasDifferences && (
              <MessageBar messageBarType={MessageBarType.success}>
                No differences found. The flows are identical.
              </MessageBar>
            )}

            {/* Differences List */}
            {comparisonResult.hasDifferences && (
              <div className={cardStyles}>
                <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
                  All Differences ({comparisonResult.totalDifferences})
                </Text>
                <DetailsList
                  items={comparisonResult.differences}
                  columns={columns}
                  layoutMode={DetailsListLayoutMode.justified}
                  selectionMode={SelectionMode.none}
                  isHeaderVisible={true}
                  compact
                />
              </div>
            )}
          </>
        )}
      </Stack>
    </Panel>
  );
};

function truncateValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.length > 50) {
    return str.substring(0, 47) + '...';
  }
  return str;
}

export default FlowComparisonPanel;
