// SolutionTab - Compact solution analysis display for popup
// Upload and analyze Power Automate solution .zip files

import React, { useState, useCallback, useRef } from 'react';
import {
  mergeStyles,
  Icon,
  DefaultButton,
  Spinner,
  SpinnerSize,
  Pivot,
  PivotItem,
} from '@fluentui/react';
import { MetricCard, MetricGrid } from '../shared/MetricCard';
import { EmptyState, ErrorEmptyState } from '../shared/EmptyState';
import { designTokens, getRatingColor } from '../../styles/theme';
import { SolutionAnalyzer, SolutionAnalysisResult, SolutionFlow } from '../../services/SolutionAnalyzer';

export interface SolutionTabProps {
  onOpenFullAnalysis?: () => void;
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

const uploadZoneStyles = mergeStyles({
  border: `2px dashed ${designTokens.colors.primary}`,
  borderRadius: designTokens.radius.md,
  padding: designTokens.spacing.xxl,
  textAlign: 'center',
  backgroundColor: designTokens.colors.primaryLight,
  cursor: 'pointer',
  transition: `all ${designTokens.transitions.normal}`,
  ':hover': {
    backgroundColor: designTokens.colors.infoLight,
    borderColor: designTokens.colors.primaryDark,
  },
});

const flowRowStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.md,
  padding: `${designTokens.spacing.sm} 0`,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
  ':last-child': {
    borderBottom: 'none',
  },
});

const flowNameStyles = mergeStyles({
  flex: 1,
  fontSize: designTokens.typography.sizes.sm,
  fontWeight: designTokens.typography.weights.medium,
  color: designTokens.colors.neutralDark,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const flowStatStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.xs,
  color: designTokens.colors.neutralSecondary,
  minWidth: '50px',
  textAlign: 'center',
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

const metadataRowStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.md,
  padding: `${designTokens.spacing.xs} 0`,
});

const metadataLabelStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.xs,
  color: designTokens.colors.neutralSecondary,
  minWidth: '80px',
});

const metadataValueStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.sm,
  color: designTokens.colors.neutralDark,
});

export const SolutionTab: React.FC<SolutionTabProps> = ({
  onOpenFullAnalysis,
}) => {
  const [analysisResult, setAnalysisResult] = useState<SolutionAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState('flows');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file upload
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setError('Please upload a .zip solution file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const analyzer = new SolutionAnalyzer();
      const result = await analyzer.analyzeSolution(file);
      setAnalysisResult(result);
    } catch (err) {
      console.error('Error analyzing solution:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle input change
  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  // Handle drag and drop
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // Clear results
  const handleClear = useCallback(() => {
    setAnalysisResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Calculate aggregate metrics
  const aggregateMetrics = analysisResult ? {
    totalFlows: analysisResult.flows.length,
    totalActions: analysisResult.flows.reduce((sum, f) => sum + (f.analysis?.actionCount || 0), 0),
    avgComplexity: analysisResult.flows.length > 0
      ? Math.round(analysisResult.flows.reduce((sum, f) => sum + (f.analysis?.complexity || 0), 0) / analysisResult.flows.length)
      : 0,
    avgRating: analysisResult.flows.length > 0
      ? Math.round(analysisResult.flows.reduce((sum, f) => sum + (f.analysis?.overallRating || 0), 0) / analysisResult.flows.length)
      : 0,
  } : null;

  // Show loading state
  if (isLoading) {
    return (
      <div className={loadingContainerStyles}>
        <Spinner size={SpinnerSize.large} />
        <span style={{ color: designTokens.colors.neutralPrimary }}>
          Analyzing solution...
        </span>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className={containerStyles}>
        <ErrorEmptyState message={error} onRetry={handleClear} />
      </div>
    );
  }

  // Show upload zone if no results
  if (!analysisResult) {
    return (
      <div className={containerStyles}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
        <div
          className={uploadZoneStyles}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Icon
            iconName="CloudUpload"
            style={{
              fontSize: '48px',
              color: designTokens.colors.primary,
              marginBottom: designTokens.spacing.md,
            }}
          />
          <div style={{
            fontSize: designTokens.typography.sizes.md,
            fontWeight: designTokens.typography.weights.semibold,
            color: designTokens.colors.neutralDark,
            marginBottom: designTokens.spacing.xs,
          }}>
            Upload Solution File
          </div>
          <div style={{
            fontSize: designTokens.typography.sizes.sm,
            color: designTokens.colors.neutralPrimary,
          }}>
            Drag & drop or click to upload a .zip solution file
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerStyles}>
      {/* Solution Metadata */}
      <div className={cardStyles}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: designTokens.spacing.md,
        }}>
          <div>
            <div style={{
              fontSize: designTokens.typography.sizes.lg,
              fontWeight: designTokens.typography.weights.semibold,
              color: designTokens.colors.neutralDark,
            }}>
              {analysisResult.name}
            </div>
            <div style={{
              fontSize: designTokens.typography.sizes.xs,
              color: designTokens.colors.neutralSecondary,
            }}>
              Version {analysisResult.version}
            </div>
          </div>
          <DefaultButton
            text="Clear"
            iconProps={{ iconName: 'Delete' }}
            onClick={handleClear}
          />
        </div>

        <div className={metadataRowStyles}>
          <span className={metadataLabelStyles}>Publisher:</span>
          <span className={metadataValueStyles}>{analysisResult.publisher}</span>
        </div>
      </div>

      {/* Aggregate Metrics */}
      {aggregateMetrics && (
        <MetricGrid columns={4} gap="small">
          <MetricCard
            label="Flows"
            value={aggregateMetrics.totalFlows}
            type="info"
            size="small"
          />
          <MetricCard
            label="Actions"
            value={aggregateMetrics.totalActions}
            type="default"
            size="small"
          />
          <MetricCard
            label="Avg Complexity"
            value={aggregateMetrics.avgComplexity}
            type="complexity"
            size="small"
          />
          <MetricCard
            label="Avg Rating"
            value={`${aggregateMetrics.avgRating}%`}
            type="rating"
            customColor={getRatingColor(aggregateMetrics.avgRating)}
            size="small"
          />
        </MetricGrid>
      )}

      {/* Tabbed Content */}
      <div className={cardStyles}>
        <Pivot
          selectedKey={selectedTab}
          onLinkClick={(item) => setSelectedTab(item?.props.itemKey || 'flows')}
          styles={{ root: { marginBottom: designTokens.spacing.md } }}
        >
          <PivotItem headerText={`Flows (${analysisResult.flows.length})`} itemKey="flows" />
          <PivotItem headerText={`Connections (${analysisResult.connections.length})`} itemKey="connections" />
          <PivotItem headerText={`Variables (${analysisResult.environmentVariables.length})`} itemKey="variables" />
        </Pivot>

        {/* Flows Tab */}
        {selectedTab === 'flows' && (
          <div>
            {analysisResult.flows.length === 0 ? (
              <EmptyState
                icon="Flow"
                title="No Flows Found"
                description="This solution doesn't contain any Power Automate flows."
                size="small"
              />
            ) : (
              <>
                {/* Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: designTokens.spacing.md,
                  padding: `${designTokens.spacing.xs} 0`,
                  borderBottom: `2px solid ${designTokens.colors.neutralLight}`,
                  marginBottom: designTokens.spacing.sm,
                }}>
                  <span style={{ flex: 1, fontSize: designTokens.typography.sizes.xs, color: designTokens.colors.neutralSecondary }}>
                    Name
                  </span>
                  <span className={flowStatStyles}>Actions</span>
                  <span className={flowStatStyles}>Rating</span>
                </div>

                {/* Flow List */}
                {analysisResult.flows.slice(0, 10).map((flow, idx) => (
                  <div key={idx} className={flowRowStyles}>
                    <Icon iconName="Flow" style={{ color: designTokens.colors.primary, fontSize: '14px' }} />
                    <span className={flowNameStyles} title={flow.displayName}>
                      {flow.displayName}
                    </span>
                    <span className={flowStatStyles}>
                      {flow.analysis?.actionCount || '-'}
                    </span>
                    <span className={flowStatStyles} style={{
                      color: flow.analysis ? getRatingColor(flow.analysis.overallRating) : designTokens.colors.neutralSecondary,
                      fontWeight: designTokens.typography.weights.semibold,
                    }}>
                      {flow.analysis ? `${flow.analysis.overallRating}%` : '-'}
                    </span>
                  </div>
                ))}

                {analysisResult.flows.length > 10 && (
                  <div style={{
                    textAlign: 'center',
                    padding: designTokens.spacing.md,
                    color: designTokens.colors.neutralSecondary,
                    fontSize: designTokens.typography.sizes.xs,
                  }}>
                    Showing 10 of {analysisResult.flows.length} flows
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Connections Tab */}
        {selectedTab === 'connections' && (
          <div>
            {analysisResult.connections.length === 0 ? (
              <EmptyState
                icon="PlugConnected"
                title="No Connections"
                description="This solution doesn't define any connections."
                size="small"
              />
            ) : (
              analysisResult.connections.map((conn, idx) => (
                <div key={idx} className={flowRowStyles}>
                  <Icon iconName="PlugConnected" style={{ color: designTokens.colors.info, fontSize: '14px' }} />
                  <span className={flowNameStyles}>{conn.displayName}</span>
                  <span className={flowStatStyles}>{conn.connectorId}</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Environment Variables Tab */}
        {selectedTab === 'variables' && (
          <div>
            {analysisResult.environmentVariables.length === 0 ? (
              <EmptyState
                icon="Variable"
                title="No Environment Variables"
                description="This solution doesn't define any environment variables."
                size="small"
              />
            ) : (
              analysisResult.environmentVariables.map((variable, idx) => (
                <div key={idx} className={flowRowStyles}>
                  <Icon iconName="Variable" style={{ color: designTokens.colors.variable, fontSize: '14px' }} />
                  <span className={flowNameStyles}>{variable.displayName}</span>
                  <span className={flowStatStyles}>{variable.type}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {onOpenFullAnalysis && (
        <DefaultButton
          text="Open Full Analysis"
          iconProps={{ iconName: 'OpenInNewTab' }}
          onClick={onOpenFullAnalysis}
        />
      )}
    </div>
  );
};

export default SolutionTab;
