import React, { useMemo } from 'react';
import {
  Stack,
  Text,
  DetailsList,
  DetailsListLayoutMode,
  SelectionMode,
  IColumn,
  Icon,
  ProgressIndicator,
  mergeStyles,
} from '@fluentui/react';
import {
  ExceptionAnalysisResult,
  ExceptionIssue,
  ScopeInfo,
} from '../../services/ExceptionAnalyzer';
import { MetricCard, MetricRow } from './components/MetricCard';

/** Token colours for on-screen use (ExceptionAnalyzer's hex values serve the HTML report). */
const LEVEL_COLOR: Record<ExceptionIssue['level'], string> = {
  fail: 'var(--color-danger)',
  warning: 'var(--color-fg)',
  info: 'var(--color-info)',
};

const scoreColor = (score: number) =>
  score >= 80 ? 'var(--color-success)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

interface ExceptionAnalysisTabProps {
  exceptionResult: ExceptionAnalysisResult;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-sm)',
  backgroundColor: 'var(--color-bg-card)',
  color: 'var(--color-fg)',
  marginBottom: '12px',
});

const statusIconStyles = (passed: boolean) =>
  mergeStyles({
    fontSize: 20,
    marginRight: 8,
    color: passed ? 'var(--color-success)' : 'var(--color-danger)',
  });

export const ExceptionAnalysisTab: React.FC<ExceptionAnalysisTabProps> = ({
  exceptionResult,
}) => {
  const issueColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'level',
        name: 'Level',
        fieldName: 'level',
        minWidth: 60,
        maxWidth: 80,
        onRender: (item: ExceptionIssue) => (
          <Text
            styles={{
              root: {
                color: LEVEL_COLOR[item.level] || 'var(--color-fg)',
                fontWeight: 600,
                textTransform: 'uppercase',
              },
            }}
          >
            {item.level}
          </Text>
        ),
      },
      {
        key: 'area',
        name: 'Area',
        fieldName: 'area',
        minWidth: 100,
        maxWidth: 150,
      },
      {
        key: 'value',
        name: 'Item',
        fieldName: 'value',
        minWidth: 150,
        maxWidth: 200,
      },
      {
        key: 'reason',
        name: 'Reason',
        fieldName: 'reason',
        minWidth: 200,
        isMultiline: true,
      },
    ],
    []
  );

  const scopeColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'name',
        name: 'Scope Name',
        fieldName: 'name',
        minWidth: 150,
        maxWidth: 200,
      },
      {
        key: 'type',
        name: 'Type',
        fieldName: 'type',
        minWidth: 80,
        maxWidth: 100,
        onRender: (item: ScopeInfo) => (
          <Text
            styles={{
              root: {
                color:
                  item.type === 'main'
                    ? 'var(--color-success)'
                    : item.type === 'exception' || item.type === 'catch'
                    ? 'var(--color-fg)'
                    : 'var(--color-fg)',
                fontWeight: item.type !== 'regular' ? 600 : 400,
              },
            }}
          >
            {item.type}
          </Text>
        ),
      },
      {
        key: 'runAfterFailed',
        name: 'Runs After Failed',
        minWidth: 100,
        maxWidth: 120,
        onRender: (item: ScopeInfo) => (
          <Icon
            iconName={item.hasRunAfterFailed ? 'CheckMark' : 'Cancel'}
            styles={{
              root: { color: item.hasRunAfterFailed ? 'var(--color-success)' : 'var(--color-fg-muted)' },
            }}
          />
        ),
      },
      {
        key: 'terminate',
        name: 'Has Terminate',
        minWidth: 100,
        maxWidth: 120,
        onRender: (item: ScopeInfo) => (
          <Icon
            iconName={item.containsTerminate ? 'CheckMark' : 'Cancel'}
            styles={{
              root: { color: item.containsTerminate ? 'var(--color-success)' : 'var(--color-fg-muted)' },
            }}
          />
        ),
      },
      {
        key: 'actions',
        name: 'Actions',
        fieldName: 'actionCount',
        minWidth: 60,
        maxWidth: 80,
      },
    ],
    []
  );

  const failCount = exceptionResult.issues.filter((i) => i.level === 'fail').length;
  const warningCount = exceptionResult.issues.filter((i) => i.level === 'warning').length;
  const infoCount = exceptionResult.issues.filter((i) => i.level === 'info').length;

  return (
    <Stack tokens={{ childrenGap: 16 }} styles={{ root: { padding: '16px' } }}>
      {/* Exception Handling Score */}
      <div className={cardStyles}>
        <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
          Exception Handling Score
        </Text>
        <Stack horizontal tokens={{ childrenGap: 24 }} verticalAlign="center">
          <Stack styles={{ root: { flex: 1 } }}>
            <ProgressIndicator
              percentComplete={exceptionResult.score / 100}
              barHeight={8}
              styles={{
                progressBar: {
                  backgroundColor: scoreColor(exceptionResult.score),
                },
              }}
            />
          </Stack>
          <Text
            variant="xLarge"
            styles={{
              root: {
                fontWeight: 700,
                color: 'var(--color-fg)',
              },
            }}
          >
            {exceptionResult.score}%
          </Text>
        </Stack>
      </div>

      {/* Status Checks */}
      <div className={cardStyles}>
        <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
          Structure Checks
        </Text>
        <Stack tokens={{ childrenGap: 8 }}>
          <Stack horizontal verticalAlign="center">
            <Icon
              iconName={exceptionResult.hasMainScope ? 'CheckMark' : 'Cancel'}
              className={statusIconStyles(exceptionResult.hasMainScope)}
            />
            <Text>
              Main/Try Scope: {exceptionResult.hasMainScope ? exceptionResult.mainScopeName : 'Missing'}
            </Text>
          </Stack>
          <Stack horizontal verticalAlign="center">
            <Icon
              iconName={exceptionResult.hasExceptionScope ? 'CheckMark' : 'Cancel'}
              className={statusIconStyles(exceptionResult.hasExceptionScope)}
            />
            <Text>
              Exception/Catch Scope:{' '}
              {exceptionResult.hasExceptionScope ? exceptionResult.exceptionScopeName : 'Missing'}
            </Text>
          </Stack>
          <Stack horizontal verticalAlign="center">
            <Icon
              iconName={exceptionResult.hasTerminateInException ? 'CheckMark' : 'Cancel'}
              className={statusIconStyles(exceptionResult.hasTerminateInException)}
            />
            <Text>
              Terminate in Exception Scope:{' '}
              {exceptionResult.hasTerminateInException ? 'Present' : 'Missing'}
            </Text>
          </Stack>
          <Stack horizontal verticalAlign="center">
            <Icon iconName="Info" styles={{ root: { fontSize: 20, marginRight: 8, color: 'var(--color-brand)' } }} />
            <Text>Exception Handlers: {exceptionResult.exceptionHandlerCount}</Text>
          </Stack>
        </Stack>
      </div>

      {/* Issue Summary */}
      <MetricRow label="Exception handling issues">
        <MetricCard label="Failures" value={failCount} tone={failCount ? 'danger' : 'success'} />
        <MetricCard label="Warnings" value={warningCount} tone={warningCount ? 'warning' : 'success'} />
        <MetricCard label="Info" value={infoCount} tone={infoCount ? 'info' : 'neutral'} />
      </MetricRow>

      {/* Scope Structure */}
      {exceptionResult.scopeStructure.length > 0 && (
        <div className={cardStyles}>
          <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
            Scope Structure
          </Text>
          <DetailsList
            items={exceptionResult.scopeStructure}
            columns={scopeColumns}
            layoutMode={DetailsListLayoutMode.justified}
            selectionMode={SelectionMode.none}
            isHeaderVisible={true}
            compact
          />
        </div>
      )}

      {/* Issues List */}
      <div className={cardStyles}>
        <Text variant="mediumPlus" styles={{ root: { fontWeight: 600, marginBottom: 12 } }}>
          Issues ({exceptionResult.issues.length})
        </Text>
        {exceptionResult.issues.length > 0 ? (
          <DetailsList
            items={exceptionResult.issues}
            columns={issueColumns}
            layoutMode={DetailsListLayoutMode.justified}
            selectionMode={SelectionMode.none}
            isHeaderVisible={true}
            compact
          />
        ) : (
          <Text styles={{ root: { color: 'var(--color-success)' } }}>
            No issues found. Exception handling looks good!
          </Text>
        )}
      </div>
    </Stack>
  );
};

export default ExceptionAnalysisTab;
