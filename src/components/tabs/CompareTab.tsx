// CompareTab - Compact flow comparison display for popup
// Store baseline and compare flow changes

import React, { useState, useCallback, useEffect } from 'react';
import {
  mergeStyles,
  Icon,
  PrimaryButton,
  DefaultButton,
  Spinner,
  SpinnerSize,
} from '@fluentui/react';
import { MetricCard, MetricGrid } from '../shared/MetricCard';
import { EmptyState, NotFlowPageEmptyState, ErrorEmptyState } from '../shared/EmptyState';
import { designTokens } from '../../styles/theme';
import { FlowComparisonService, FlowComparisonResult } from '../../services/FlowComparisonService';

export interface CompareTabProps {
  isFlowPage: boolean;
  onOpenFullComparison?: () => void;
}

const containerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'auto',
  padding: designTokens.spacing.lg,
  gap: designTokens.spacing.lg,
});

const cardStyles = mergeStyles({
  padding: designTokens.spacing.lg,
  borderRadius: designTokens.radius.md,
  backgroundColor: designTokens.colors.white,
  boxShadow: designTokens.shadows.card,
});

const sectionTitleStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.md,
  fontWeight: designTokens.typography.weights.semibold,
  color: designTokens.colors.neutralDark,
  marginBottom: designTokens.spacing.md,
});

const statusBadgeStyles = (isStored: boolean) => mergeStyles({
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing.xs,
  padding: `${designTokens.spacing.xs} ${designTokens.spacing.md}`,
  borderRadius: designTokens.radius.sm,
  fontSize: designTokens.typography.sizes.sm,
  fontWeight: designTokens.typography.weights.medium,
  backgroundColor: isStored ? designTokens.colors.successLight : designTokens.colors.neutralLighter,
  color: isStored ? designTokens.colors.success : designTokens.colors.neutralPrimary,
});

const actionsRowStyles = mergeStyles({
  display: 'flex',
  gap: designTokens.spacing.md,
  flexWrap: 'wrap',
});

const changeRowStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.sm,
  padding: `${designTokens.spacing.sm} 0`,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
  ':last-child': {
    borderBottom: 'none',
  },
});

const changePathStyles = mergeStyles({
  flex: 1,
  fontSize: designTokens.typography.sizes.xs,
  fontFamily: designTokens.typography.fontFamilyMono,
  color: designTokens.colors.neutralPrimary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const loadingContainerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  gap: designTokens.spacing.md,
  padding: designTokens.spacing.xxl,
});

const summaryCardStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  gap: designTokens.spacing.md,
});

export const CompareTab: React.FC<CompareTabProps> = ({
  isFlowPage,
  onOpenFullComparison,
}) => {
  const [hasStoredFlow, setHasStoredFlow] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<FlowComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonService] = useState(() => new FlowComparisonService());

  // Check for stored flow on mount
  useEffect(() => {
    setHasStoredFlow(comparisonService.hasStoredFlow());
  }, [comparisonService]);

  // Get current flow definition from page
  const getCurrentFlowDefinition = useCallback(async (): Promise<{ success: boolean; definition?: any; name?: string; error?: string }> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'get-flow-definition' },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else if (response?.success && response.definition) {
            try {
              const parsed = JSON.parse(response.definition);
              resolve({ success: true, definition: parsed, name: response.name });
            } catch (e) {
              resolve({ success: false, error: 'Invalid flow definition' });
            }
          } else {
            resolve({ success: false, error: response?.error || 'Failed to get flow' });
          }
        }
      );
    });
  }, []);

  // Store current flow as baseline
  const handleStoreFlow = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getCurrentFlowDefinition();
      if (!result.success || !result.definition) {
        setError(result.error || 'Failed to get flow definition');
        return;
      }

      comparisonService.storeFlowForComparison(result.definition);
      setHasStoredFlow(true);
      setComparisonResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store flow');
    } finally {
      setIsLoading(false);
    }
  }, [comparisonService, getCurrentFlowDefinition]);

  // Compare with stored baseline
  const handleCompare = useCallback(async () => {
    if (!hasStoredFlow) {
      setError('No baseline stored. Store a flow first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await getCurrentFlowDefinition();
      if (!result.success || !result.definition) {
        setError(result.error || 'Failed to get flow definition');
        return;
      }

      const comparison = comparisonService.compareWithStored(result.definition);
      setComparisonResult(comparison);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setIsLoading(false);
    }
  }, [comparisonService, hasStoredFlow, getCurrentFlowDefinition]);

  // Clear stored baseline
  const handleClear = useCallback(() => {
    comparisonService.clearStoredFlow();
    setHasStoredFlow(false);
    setComparisonResult(null);
    setError(null);
  }, [comparisonService]);

  // Show not flow page state
  if (!isFlowPage) {
    return (
      <div className={containerStyles}>
        <NotFlowPageEmptyState />
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className={loadingContainerStyles}>
        <Spinner size={SpinnerSize.large} />
        <span style={{ color: designTokens.colors.neutralPrimary }}>
          Processing...
        </span>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className={containerStyles}>
        <ErrorEmptyState message={error} onRetry={handleCompare} />
      </div>
    );
  }

  return (
    <div className={containerStyles}>
      {/* Status Card */}
      <div className={cardStyles}>
        <div className={sectionTitleStyles}>Comparison Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: designTokens.spacing.md }}>
          <span className={statusBadgeStyles(hasStoredFlow)}>
            <Icon iconName={hasStoredFlow ? 'CheckMark' : 'Cancel'} />
            {hasStoredFlow ? 'Baseline Stored' : 'No Baseline'}
          </span>
        </div>

        <div className={actionsRowStyles} style={{ marginTop: designTokens.spacing.md }}>
          <PrimaryButton
            text="Store Baseline"
            iconProps={{ iconName: 'Save' }}
            onClick={handleStoreFlow}
          />
          <DefaultButton
            text="Compare"
            iconProps={{ iconName: 'BranchCompare' }}
            onClick={handleCompare}
            disabled={!hasStoredFlow}
          />
          <DefaultButton
            text="Clear"
            iconProps={{ iconName: 'Delete' }}
            onClick={handleClear}
            disabled={!hasStoredFlow}
          />
        </div>
      </div>

      {/* Comparison Results */}
      {comparisonResult && (
        <>
          {/* Summary Metrics */}
          <MetricGrid columns={4} gap="small">
            <MetricCard
              label="Added"
              value={comparisonResult.summary.actionsAdded}
              type="success"
              size="small"
            />
            <MetricCard
              label="Removed"
              value={comparisonResult.summary.actionsRemoved}
              type="error"
              size="small"
            />
            <MetricCard
              label="Modified"
              value={comparisonResult.summary.actionsModified}
              type="warning"
              size="small"
            />
            <MetricCard
              label="Other"
              value={comparisonResult.summary.otherChanges}
              type="info"
              size="small"
            />
          </MetricGrid>

          {/* Changes Summary */}
          {(comparisonResult.summary.variablesChanged > 0 || comparisonResult.summary.connectionsChanged > 0) && (
            <div className={cardStyles}>
              <div className={sectionTitleStyles}>Other Changes</div>
              <div className={summaryCardStyles}>
                {comparisonResult.summary.variablesChanged > 0 && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: `${designTokens.spacing.sm} 0`,
                    borderBottom: comparisonResult.summary.connectionsChanged > 0
                      ? `1px solid ${designTokens.colors.neutralLight}`
                      : 'none',
                  }}>
                    <span style={{
                      fontSize: designTokens.typography.sizes.sm,
                      color: designTokens.colors.neutralPrimary,
                    }}>
                      Variables
                    </span>
                    <span style={{
                      fontSize: designTokens.typography.sizes.sm,
                      fontWeight: designTokens.typography.weights.semibold,
                      color: designTokens.colors.primary,
                    }}>
                      {comparisonResult.summary.variablesChanged} changes
                    </span>
                  </div>
                )}
                {comparisonResult.summary.connectionsChanged > 0 && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: `${designTokens.spacing.sm} 0`,
                  }}>
                    <span style={{
                      fontSize: designTokens.typography.sizes.sm,
                      color: designTokens.colors.neutralPrimary,
                    }}>
                      Connections
                    </span>
                    <span style={{
                      fontSize: designTokens.typography.sizes.sm,
                      fontWeight: designTokens.typography.weights.semibold,
                      color: designTokens.colors.primary,
                    }}>
                      {comparisonResult.summary.connectionsChanged} changes
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recent Changes (limited view) */}
          {comparisonResult.differences.length > 0 && (
            <div className={cardStyles}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: designTokens.spacing.md,
              }}>
                <div className={sectionTitleStyles} style={{ marginBottom: 0 }}>
                  Recent Changes
                </div>
                <span style={{
                  fontSize: designTokens.typography.sizes.xs,
                  color: designTokens.colors.neutralSecondary,
                }}>
                  Showing {Math.min(5, comparisonResult.differences.length)} of {comparisonResult.differences.length}
                </span>
              </div>

              {comparisonResult.differences.slice(0, 5).map((diff, idx) => (
                <div key={idx} className={changeRowStyles}>
                  <Icon
                    iconName={
                      diff.kind === 'N' ? 'Add' :
                      diff.kind === 'D' ? 'Remove' :
                      diff.kind === 'E' ? 'Edit' : 'List'
                    }
                    style={{
                      color: FlowComparisonService.getDifferenceColor(diff.kind),
                      fontSize: '12px',
                    }}
                  />
                  <span className={changePathStyles} title={diff.pathString}>
                    {diff.pathString || 'root'}
                  </span>
                  <span style={{
                    fontSize: designTokens.typography.sizes.xxs,
                    color: FlowComparisonService.getDifferenceColor(diff.kind),
                    fontWeight: designTokens.typography.weights.medium,
                  }}>
                    {FlowComparisonService.getDifferenceLabel(diff.kind)}
                  </span>
                </div>
              ))}

              {comparisonResult.differences.length > 5 && onOpenFullComparison && (
                <DefaultButton
                  text={`View All ${comparisonResult.differences.length} Changes`}
                  iconProps={{ iconName: 'OpenInNewTab' }}
                  onClick={onOpenFullComparison}
                  style={{ marginTop: designTokens.spacing.md }}
                />
              )}
            </div>
          )}

          {/* No Changes */}
          {comparisonResult.differences.length === 0 && (
            <EmptyState
              icon="CheckMark"
              title="No Changes Detected"
              description="The current flow matches the stored baseline."
              size="small"
              variant="subtle"
            />
          )}
        </>
      )}

      {/* Initial State - No comparison yet */}
      {!comparisonResult && hasStoredFlow && (
        <EmptyState
          icon="BranchCompare"
          title="Ready to Compare"
          description="Click 'Compare' to see what changed since the baseline was stored."
          size="medium"
          variant="subtle"
          primaryAction={{
            text: 'Compare Now',
            onClick: handleCompare,
            iconName: 'BranchCompare',
          }}
        />
      )}
    </div>
  );
};

export default CompareTab;
