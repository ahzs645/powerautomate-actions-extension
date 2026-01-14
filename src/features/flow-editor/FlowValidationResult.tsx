import React, { useMemo } from 'react';
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
  Pivot,
  PivotItem,
  mergeStyles,
  Icon,
} from '@fluentui/react';
import { FlowError } from './types';
import { SchemaValidator, ValidationIssue, SchemaValidationResult } from '../../services/SchemaValidator';

export interface FlowValidationResultProps {
  warnings: FlowError[];
  errors: FlowError[];
  isOpen: boolean;
  onClose: () => void;
  flowDefinition?: string;
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
    minWidth: '80px',
  });

export const FlowValidationResult: React.FC<FlowValidationResultProps> = ({
  warnings,
  errors,
  isOpen,
  onClose,
  flowDefinition,
}) => {
  // Perform schema validation when panel is open
  const schemaResult = useMemo<SchemaValidationResult | null>(() => {
    if (!isOpen || !flowDefinition) return null;

    try {
      const parsed = JSON.parse(flowDefinition);
      const validator = new SchemaValidator();
      // Validate the definition part of the flow
      return validator.validateFlow(parsed.definition || parsed);
    } catch (error) {
      return {
        isValid: false,
        issues: [{
          path: '',
          message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
          keyword: 'parse',
          severity: 'error',
          schemaPath: '',
        }],
        errorCount: 1,
        warningCount: 0,
      };
    }
  }, [isOpen, flowDefinition]);

  const apiErrorColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'operation',
        name: 'Operation',
        minWidth: 150,
        maxWidth: 200,
        onRender: (item: FlowError) => (
          <Text styles={{ root: { fontWeight: 600 } }}>{item.operationName}</Text>
        ),
      },
      {
        key: 'description',
        name: 'Description',
        minWidth: 200,
        maxWidth: 400,
        isResizable: true,
        onRender: (item: FlowError) => <Text>{item.errorDescription}</Text>,
      },
      {
        key: 'fix',
        name: 'Fix Instructions',
        minWidth: 200,
        isResizable: true,
        onRender: (item: FlowError) => (
          <Text
            styles={{ root: { cursor: 'pointer', color: '#0078d4' } }}
            onClick={() => navigator.clipboard.writeText(item.fixInstructions.markdownText)}
            title="Click to copy"
          >
            {item.fixInstructions.markdownText}
          </Text>
        ),
      },
    ],
    []
  );

  const schemaIssueColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'severity',
        name: '',
        minWidth: 30,
        maxWidth: 30,
        onRender: (item: ValidationIssue) => (
          <Icon
            iconName={item.severity === 'error' ? 'ErrorBadge' : 'Warning'}
            styles={{
              root: {
                color: SchemaValidator.getSeverityColor(item.severity),
                fontSize: 16,
              },
            }}
          />
        ),
      },
      {
        key: 'path',
        name: 'Path',
        minWidth: 150,
        maxWidth: 250,
        isResizable: true,
        onRender: (item: ValidationIssue) => (
          <Text styles={{ root: { fontFamily: 'Consolas, monospace', fontSize: 12 } }}>
            {item.path}
          </Text>
        ),
      },
      {
        key: 'message',
        name: 'Message',
        minWidth: 200,
        isResizable: true,
        onRender: (item: ValidationIssue) => <Text>{item.message}</Text>,
      },
      {
        key: 'keyword',
        name: 'Type',
        minWidth: 80,
        maxWidth: 100,
        onRender: (item: ValidationIssue) => (
          <Text styles={{ root: { color: '#605e5c', fontSize: 12 } }}>{item.keyword}</Text>
        ),
      },
    ],
    []
  );

  const totalErrors = errors.length + (schemaResult?.errorCount || 0);
  const totalWarnings = warnings.length + (schemaResult?.warningCount || 0);
  const hasIssues = totalErrors > 0 || totalWarnings > 0;

  return (
    <Panel
      headerText="Flow Validation Results"
      isOpen={isOpen}
      onDismiss={onClose}
      type={PanelType.large}
      closeButtonAriaLabel="Close"
    >
      <Stack tokens={{ childrenGap: 16, padding: 16 }}>
        {/* Summary Metrics */}
        <Stack horizontal tokens={{ childrenGap: 12 }}>
          <div className={metricStyles(totalErrors > 0 ? '#d13438' : '#107c10')}>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
              {totalErrors}
            </Text>
            <Text variant="small" styles={{ root: { color: '#fff' } }}>
              Errors
            </Text>
          </div>
          <div className={metricStyles(totalWarnings > 0 ? '#ff8c00' : '#107c10')}>
            <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
              {totalWarnings}
            </Text>
            <Text variant="small" styles={{ root: { color: '#fff' } }}>
              Warnings
            </Text>
          </div>
        </Stack>

        {/* No Issues */}
        {!hasIssues && (
          <MessageBar messageBarType={MessageBarType.success}>
            <strong>Validation passed!</strong> No errors or warnings found.
          </MessageBar>
        )}

        {/* Results Tabs */}
        {hasIssues && (
          <Pivot>
            {/* API Errors */}
            {errors.length > 0 && (
              <PivotItem headerText={`API Errors (${errors.length})`} itemIcon="Error">
                <div className={cardStyles}>
                  <DetailsList
                    items={errors}
                    columns={apiErrorColumns}
                    layoutMode={DetailsListLayoutMode.justified}
                    selectionMode={SelectionMode.none}
                    isHeaderVisible={true}
                    compact
                  />
                </div>
              </PivotItem>
            )}

            {/* API Warnings */}
            {warnings.length > 0 && (
              <PivotItem headerText={`API Warnings (${warnings.length})`} itemIcon="Warning">
                <div className={cardStyles}>
                  <DetailsList
                    items={warnings}
                    columns={apiErrorColumns}
                    layoutMode={DetailsListLayoutMode.justified}
                    selectionMode={SelectionMode.none}
                    isHeaderVisible={true}
                    compact
                  />
                </div>
              </PivotItem>
            )}

            {/* Schema Validation */}
            {schemaResult && schemaResult.issues.length > 0 && (
              <PivotItem
                headerText={`Schema Issues (${schemaResult.issues.length})`}
                itemIcon="CodeEdit"
              >
                <div className={cardStyles}>
                  <MessageBar
                    messageBarType={
                      schemaResult.errorCount > 0 ? MessageBarType.error : MessageBarType.warning
                    }
                    styles={{ root: { marginBottom: 12 } }}
                  >
                    {SchemaValidator.getSummary(schemaResult)}
                  </MessageBar>
                  <DetailsList
                    items={schemaResult.issues}
                    columns={schemaIssueColumns}
                    layoutMode={DetailsListLayoutMode.justified}
                    selectionMode={SelectionMode.none}
                    isHeaderVisible={true}
                    compact
                  />
                </div>
              </PivotItem>
            )}
          </Pivot>
        )}
      </Stack>
    </Panel>
  );
};

export default FlowValidationResult;
