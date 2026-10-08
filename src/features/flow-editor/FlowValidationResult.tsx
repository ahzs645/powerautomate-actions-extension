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
  Link,
} from '@fluentui/react';
import { FlowError } from './types';
import { SchemaValidator, ValidationIssue } from '../../services/SchemaValidator';
import { checkerFailures, countIssues, ValidationReport } from './flowValidation';
import { MetricCard, MetricRow } from './components/MetricCard';

export interface FlowValidationResultProps {
  report: ValidationReport | null;
  isOpen: boolean;
  onClose: () => void;
  /** Jump the editor to a JSON pointer in the editor document (e.g. `/definition/actions/X`). */
  onRevealPointer?: (pointer: string) => void;
  /** Jump the editor to an action or trigger by name. */
  onRevealOperation?: (name: string) => void;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-sm)',
  backgroundColor: 'var(--color-bg-card)',
  color: 'var(--color-fg)',
  marginBottom: '12px',
});

const monoStyles = { root: { fontFamily: 'var(--font-family-mono)', fontSize: 12 } };

export const FlowValidationResult: React.FC<FlowValidationResultProps> = ({
  report,
  isOpen,
  onClose,
  onRevealPointer,
  onRevealOperation,
}) => {
  const errors: FlowError[] = report?.errorsCheck.status === 'ok' ? report.errorsCheck.items : [];
  const warnings: FlowError[] = report?.warningsCheck.status === 'ok' ? report.warningsCheck.items : [];
  const schemaResult = report?.schema || null;
  const failures = report ? checkerFailures(report) : [];
  const counts = report ? countIssues(report) : null;

  const apiErrorColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'operation',
        name: 'Operation',
        minWidth: 150,
        maxWidth: 220,
        isResizable: true,
        onRender: (item: FlowError) =>
          onRevealOperation && item.operationName ? (
            <Link
              onClick={() => onRevealOperation(item.operationName)}
              title="Show this operation in the editor"
              styles={{ root: { fontWeight: 600 } }}
            >
              {item.operationName}
            </Link>
          ) : (
            <Text styles={{ root: { fontWeight: 600 } }}>{item.operationName}</Text>
          ),
      },
      {
        key: 'description',
        name: 'Description',
        minWidth: 200,
        maxWidth: 400,
        isResizable: true,
        isMultiline: true,
        onRender: (item: FlowError) => <Text>{item.errorDescription}</Text>,
      },
      {
        key: 'fix',
        name: 'How to fix',
        minWidth: 200,
        isResizable: true,
        isMultiline: true,
        onRender: (item: FlowError) => <Text>{item.fixInstructions?.markdownText}</Text>,
      },
    ],
    [onRevealOperation]
  );

  const schemaIssueColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'severity',
        name: 'Severity',
        isIconOnly: true,
        minWidth: 24,
        maxWidth: 24,
        onRender: (item: ValidationIssue) => (
          <Icon
            iconName={item.severity === 'error' ? 'ErrorBadge' : 'Warning'}
            aria-label={item.severity}
            styles={{
              root: { color: SchemaValidator.getSeverityColor(item.severity), fontSize: 16 },
            }}
          />
        ),
      },
      {
        key: 'path',
        name: 'Path',
        minWidth: 180,
        maxWidth: 320,
        isResizable: true,
        isMultiline: true,
        onRender: (item: ValidationIssue) =>
          onRevealPointer && item.instancePath !== undefined ? (
            <Link
              onClick={() => onRevealPointer(`/definition${item.instancePath}`)}
              title="Show this location in the editor"
              styles={monoStyles}
            >
              {item.path}
            </Link>
          ) : (
            <Text styles={monoStyles}>{item.path}</Text>
          ),
      },
      {
        key: 'message',
        name: 'Message',
        minWidth: 200,
        isResizable: true,
        isMultiline: true,
        onRender: (item: ValidationIssue) => <Text>{item.message}</Text>,
      },
    ],
    [onRevealPointer]
  );

  const hasIssues = !!counts && counts.errors + counts.warnings > 0;

  return (
    <Panel
      headerText="Validation results"
      isOpen={isOpen}
      onDismiss={onClose}
      type={PanelType.large}
      closeButtonAriaLabel="Close"
    >
      {!report ? (
        <Text>Run Validate to check the flow.</Text>
      ) : (
        <Stack tokens={{ childrenGap: 16 }} styles={{ root: { paddingTop: 12 } }}>
          <MetricRow label="Validation summary">
            {/* With the checker down, "0" is only a partial count: no green for it. */}
            <MetricCard
              label="Errors"
              value={counts!.errors}
              tone={counts!.errors > 0 ? 'danger' : failures.length ? 'neutral' : 'success'}
            />
            <MetricCard
              label="Warnings"
              value={counts!.warnings}
              tone={counts!.warnings > 0 ? 'warning' : failures.length ? 'neutral' : 'success'}
            />
            <MetricCard
              label="Flow checker"
              value={failures.length ? 'Unavailable' : 'Ran'}
              tone={failures.length ? 'warning' : 'success'}
              hint="Connectors & expressions"
            />
            <MetricCard
              label="Schema check"
              value={schemaResult && schemaResult.issues.length ? schemaResult.issues.length : 'Passed'}
              tone={schemaResult && schemaResult.errorCount ? 'danger' : schemaResult?.warningCount ? 'warning' : 'success'}
              hint="Definition structure"
            />
          </MetricRow>

          {failures.length > 0 && (
            <MessageBar messageBarType={MessageBarType.warning} isMultiline>
              <strong>Flow checker unavailable:</strong> {failures.join('; ')}. Only the schema check ran,
              so connector and expression problems are not reported. Use Reconnect (in the … menu) if your
              sign-in expired, then validate again.
            </MessageBar>
          )}

          {!hasIssues && failures.length === 0 && (
            <MessageBar messageBarType={MessageBarType.success}>
              <strong>Validation passed.</strong> No errors or warnings found.
            </MessageBar>
          )}

          {hasIssues && (
            <Pivot aria-label="Validation results by source">
              {schemaResult && schemaResult.issues.length > 0 && (
                <PivotItem headerText={`Schema (${schemaResult.issues.length})`} itemIcon="CodeEdit">
                  <div className={cardStyles}>
                    <Text block styles={{ root: { marginBottom: 8, color: 'var(--color-fg-secondary)' } }}>
                      {SchemaValidator.getSummary(schemaResult)}. Select a path to show it in the editor.
                    </Text>
                    <DetailsList
                      items={schemaResult.issues}
                      columns={schemaIssueColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible
                      compact
                    />
                  </div>
                </PivotItem>
              )}
              {errors.length > 0 && (
                <PivotItem headerText={`Flow checker errors (${errors.length})`} itemIcon="Error">
                  <div className={cardStyles}>
                    <DetailsList
                      items={errors}
                      columns={apiErrorColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible
                      compact
                    />
                  </div>
                </PivotItem>
              )}
              {warnings.length > 0 && (
                <PivotItem headerText={`Flow checker warnings (${warnings.length})`} itemIcon="Warning">
                  <div className={cardStyles}>
                    <DetailsList
                      items={warnings}
                      columns={apiErrorColumns}
                      layoutMode={DetailsListLayoutMode.justified}
                      selectionMode={SelectionMode.none}
                      isHeaderVisible
                      compact
                    />
                  </div>
                </PivotItem>
              )}
            </Pivot>
          )}
        </Stack>
      )}
    </Panel>
  );
};

export default FlowValidationResult;
