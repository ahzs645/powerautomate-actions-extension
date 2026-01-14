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
  ExceptionAnalyzer,
  ScopeInfo,
} from '../../services/ExceptionAnalyzer';

interface ExceptionAnalysisTabProps {
  exceptionResult: ExceptionAnalysisResult;
}

const cardStyles = mergeStyles({
  padding: '16px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  backgroundColor: '#fff',
  marginBottom: '12px',
});

const metricCardStyles = (color: string) =>
  mergeStyles({
    padding: '12px 16px',
    borderRadius: '8px',
    backgroundColor: color,
    color: '#fff',
    minWidth: '100px',
    textAlign: 'center',
  });

const statusIconStyles = (passed: boolean) =>
  mergeStyles({
    fontSize: 20,
    marginRight: 8,
    color: passed ? '#107c10' : '#d13438',
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
                color: ExceptionAnalyzer.getIssueLevelColor(item.level),
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
                    ? '#107c10'
                    : item.type === 'exception' || item.type === 'catch'
                    ? '#ff8c00'
                    : '#323130',
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
              root: { color: item.hasRunAfterFailed ? '#107c10' : '#a19f9d' },
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
              root: { color: item.containsTerminate ? '#107c10' : '#a19f9d' },
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
                  backgroundColor: ExceptionAnalyzer.getScoreColor(exceptionResult.score),
                },
              }}
            />
          </Stack>
          <Text
            variant="xLarge"
            styles={{
              root: {
                fontWeight: 700,
                color: ExceptionAnalyzer.getScoreColor(exceptionResult.score),
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
            <Icon iconName="Info" styles={{ root: { fontSize: 20, marginRight: 8, color: '#0078d4' } }} />
            <Text>Exception Handlers: {exceptionResult.exceptionHandlerCount}</Text>
          </Stack>
        </Stack>
      </div>

      {/* Issue Summary */}
      <Stack horizontal tokens={{ childrenGap: 12 }}>
        <div className={metricCardStyles('#d13438')}>
          <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
            {failCount}
          </Text>
          <Text variant="small" styles={{ root: { color: '#fff' } }}>
            Failures
          </Text>
        </div>
        <div className={metricCardStyles('#ff8c00')}>
          <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
            {warningCount}
          </Text>
          <Text variant="small" styles={{ root: { color: '#fff' } }}>
            Warnings
          </Text>
        </div>
        <div className={metricCardStyles('#0078d4')}>
          <Text variant="xLarge" styles={{ root: { fontWeight: 700, color: '#fff' } }}>
            {infoCount}
          </Text>
          <Text variant="small" styles={{ root: { color: '#fff' } }}>
            Info
          </Text>
        </div>
      </Stack>

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
          <Text styles={{ root: { color: '#107c10' } }}>
            No issues found. Exception handling looks good!
          </Text>
        )}
      </div>
    </Stack>
  );
};

export default ExceptionAnalysisTab;
