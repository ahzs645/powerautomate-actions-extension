// AnalysisTab - Compact flow analysis display for popup
// Shows key metrics with option to open full analysis panel

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  mergeStyles,
  Icon,
  PrimaryButton,
  DefaultButton,
  Spinner,
  SpinnerSize,
  ProgressIndicator,
  MessageBar,
  MessageBarType,
} from '@fluentui/react';
import { MetricCard, MetricGrid } from '../shared/MetricCard';
import { NotFlowPageEmptyState, ErrorEmptyState } from '../shared/EmptyState';
import { designTokens, getRatingColor } from '../../styles/theme';
import { FlowAnalyzer, FlowAnalysisResult, SavedFlowAnalysis } from '../../services/FlowAnalyzer';
import { StorageService } from '../../services/StorageService';

export interface AnalysisTabProps {
  isFlowPage: boolean;
  onOpenFullAnalysis?: () => void;
  onExportReport?: () => void;
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

const ratingContainerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  gap: designTokens.spacing.sm,
});

const ratingValueStyles = (rating: number) => mergeStyles({
  fontSize: designTokens.typography.sizes.xxxl,
  fontWeight: designTokens.typography.weights.bold,
  color: getRatingColor(rating),
});

const insightRowStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.md,
  padding: `${designTokens.spacing.sm} 0`,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
  ':last-child': {
    borderBottom: 'none',
  },
});

const insightLabelStyles = mergeStyles({
  flex: 1,
  fontSize: designTokens.typography.sizes.sm,
  color: designTokens.colors.neutralPrimary,
});

const insightValueStyles = (isGood: boolean) => mergeStyles({
  fontSize: designTokens.typography.sizes.sm,
  fontWeight: designTokens.typography.weights.semibold,
  color: isGood ? designTokens.colors.success : designTokens.colors.warning,
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.xs,
});

const actionsRowStyles = mergeStyles({
  display: 'flex',
  gap: designTokens.spacing.md,
  marginTop: designTokens.spacing.md,
});

const triggerCardStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.md,
  padding: designTokens.spacing.md,
  backgroundColor: designTokens.colors.neutralLighter,
  borderRadius: designTokens.radius.sm,
});

const triggerIconStyles = mergeStyles({
  width: '36px',
  height: '36px',
  borderRadius: designTokens.radius.sm,
  backgroundColor: designTokens.colors.trigger,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: designTokens.colors.white,
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

export const AnalysisTab: React.FC<AnalysisTabProps> = ({
  isFlowPage,
  onOpenFullAnalysis,
  onExportReport,
}) => {
  const storageService = useMemo(() => new StorageService(), []);
  const [analysisResult, setAnalysisResult] = useState<FlowAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<SavedFlowAnalysis | null>(null);
  const [notification, setNotification] = useState<{ text: string; type: MessageBarType } | null>(null);
  const lastDefinitionRef = useRef<string | null>(null);

  // Check for saved analysis on mount
  useEffect(() => {
    storageService.getSavedFlowAnalysis().then((saved) => {
      if (saved) {
        setSavedAnalysis(saved);
      }
    });
  }, [storageService]);

  // Auto-dismiss notification after 3 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Fetch flow definition from page and analyze
  const analyzeFlow = useCallback(async () => {
    if (!isFlowPage) return;

    setIsLoading(true);
    setError(null);

    try {
      // Request flow definition from content script
      const response = await new Promise<{ success: boolean; definition?: string; name?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'get-flow-definition' },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'No response' });
            }
          }
        );
      });

      if (!response.success || !response.definition) {
        setError(response.error || 'Failed to get flow definition');
        return;
      }

      const analyzer = new FlowAnalyzer();
      const parsed = JSON.parse(response.definition);
      const result = analyzer.analyze(parsed, response.name || 'Flow');
      setAnalysisResult(result);

      // Save analysis for later
      lastDefinitionRef.current = response.definition;
      const savedData: SavedFlowAnalysis = {
        flowDefinition: response.definition,
        flowName: result.name,
        flowId: result.id,
        analysisResult: result,
        savedAt: new Date().toISOString(),
      };
      await storageService.saveFlowAnalysis(savedData);
      setSavedAnalysis(savedData);
    } catch (err) {
      console.error('Analysis error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  }, [isFlowPage, storageService]);

  // Load saved analysis
  const handleLoadSaved = useCallback(async () => {
    if (savedAnalysis) {
      setAnalysisResult(savedAnalysis.analysisResult);
      lastDefinitionRef.current = savedAnalysis.flowDefinition;
      const savedDate = new Date(savedAnalysis.savedAt).toLocaleString();
      setNotification({
        text: `Loaded "${savedAnalysis.flowName}" from ${savedDate}`,
        type: MessageBarType.info,
      });
    }
  }, [savedAnalysis]);

  // Auto-analyze when on flow page
  useEffect(() => {
    if (isFlowPage) {
      analyzeFlow();
    }
  }, [isFlowPage, analyzeFlow]);

  // Show not flow page state
  if (!isFlowPage) {
    return (
      <div className={containerStyles}>
        {notification && (
          <MessageBar
            messageBarType={notification.type}
            onDismiss={() => setNotification(null)}
            styles={{ root: { marginBottom: designTokens.spacing.md } }}
          >
            {notification.text}
          </MessageBar>
        )}
        <NotFlowPageEmptyState />
        {savedAnalysis && (
          <div style={{ marginTop: designTokens.spacing.lg, textAlign: 'center' }}>
            <DefaultButton
              text={`Load Last: ${savedAnalysis.flowName}`}
              iconProps={{ iconName: 'History' }}
              onClick={handleLoadSaved}
              title={`Analyzed on ${new Date(savedAnalysis.savedAt).toLocaleString()}`}
            />
          </div>
        )}
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className={loadingContainerStyles}>
        <Spinner size={SpinnerSize.large} />
        <span style={{ color: designTokens.colors.neutralPrimary }}>
          Analyzing flow...
        </span>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className={containerStyles}>
        <ErrorEmptyState message={error} onRetry={analyzeFlow} />
      </div>
    );
  }

  // Show analysis results
  if (!analysisResult) {
    return (
      <div className={loadingContainerStyles}>
        <DefaultButton
          text="Analyze Flow"
          iconProps={{ iconName: 'Analytics' }}
          onClick={analyzeFlow}
        />
      </div>
    );
  }

  return (
    <div className={containerStyles}>
      {/* Notification */}
      {notification && (
        <MessageBar
          messageBarType={notification.type}
          onDismiss={() => setNotification(null)}
          styles={{ root: { marginBottom: designTokens.spacing.md } }}
        >
          {notification.text}
        </MessageBar>
      )}

      {/* Key Metrics */}
      <MetricGrid columns={4} gap="small">
        <MetricCard
          label="Complexity"
          value={analysisResult.complexity}
          type="complexity"
          size="small"
        />
        <MetricCard
          label="Actions"
          value={analysisResult.actionCount}
          type="default"
          size="small"
        />
        <MetricCard
          label="Variables"
          value={analysisResult.variableCount}
          type="default"
          size="small"
        />
        <MetricCard
          label="Rating"
          value={`${analysisResult.overallRating}%`}
          type="rating"
          customColor={getRatingColor(analysisResult.overallRating)}
          size="small"
        />
      </MetricGrid>

      {/* Overall Rating Card */}
      <div className={cardStyles}>
        <div className={sectionTitleStyles}>Overall Rating</div>
        <div className={ratingContainerStyles}>
          <ProgressIndicator
            percentComplete={analysisResult.overallRating / 100}
            barHeight={8}
            styles={{
              progressBar: {
                backgroundColor: getRatingColor(analysisResult.overallRating),
              },
            }}
          />
          <span className={ratingValueStyles(analysisResult.overallRating)}>
            {analysisResult.overallRating}%
          </span>
        </div>
      </div>

      {/* Quick Insights */}
      <div className={cardStyles}>
        <div className={sectionTitleStyles}>Quick Insights</div>

        <div className={insightRowStyles}>
          <span className={insightLabelStyles}>Main Scope</span>
          <span className={insightValueStyles(analysisResult.hasMainScope)}>
            <Icon iconName={analysisResult.hasMainScope ? 'CheckMark' : 'Cancel'} />
            {analysisResult.hasMainScope ? 'Yes' : 'No'}
          </span>
        </div>

        <div className={insightRowStyles}>
          <span className={insightLabelStyles}>Exception Handling</span>
          <span className={insightValueStyles(analysisResult.hasExceptionScope)}>
            <Icon iconName={analysisResult.hasExceptionScope ? 'CheckMark' : 'Cancel'} />
            {analysisResult.hasExceptionScope ? 'Yes' : 'No'}
          </span>
        </div>

        <div className={insightRowStyles}>
          <span className={insightLabelStyles}>Variable Naming</span>
          <span className={insightValueStyles(analysisResult.variableNamingScore >= 70)}>
            {analysisResult.variableNamingScore}%
          </span>
        </div>

        <div className={insightRowStyles}>
          <span className={insightLabelStyles}>Compose Actions</span>
          <span className={insightValueStyles(analysisResult.composesCount <= 10)}>
            {analysisResult.composesCount}
          </span>
        </div>

        <div className={insightRowStyles}>
          <span className={insightLabelStyles}>Connections</span>
          <span style={{
            fontSize: designTokens.typography.sizes.sm,
            color: designTokens.colors.neutralPrimary,
          }}>
            {analysisResult.connections.length}
          </span>
        </div>
      </div>

      {/* Trigger Info */}
      <div className={cardStyles}>
        <div className={sectionTitleStyles}>Trigger</div>
        <div className={triggerCardStyles}>
          <div className={triggerIconStyles}>
            <Icon iconName="LightningBolt" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: designTokens.typography.sizes.md,
              fontWeight: designTokens.typography.weights.semibold,
              color: designTokens.colors.neutralDark,
            }}>
              {analysisResult.trigger.name}
            </div>
            <div style={{
              fontSize: designTokens.typography.sizes.xs,
              color: designTokens.colors.neutralSecondary,
            }}>
              {analysisResult.trigger.type} • {analysisResult.trigger.connector}
            </div>
          </div>
        </div>
      </div>

      {/* Issues */}
      {(analysisResult.errors.length > 0 || analysisResult.warnings.length > 0) && (
        <div className={cardStyles}>
          <div className={sectionTitleStyles}>Issues</div>
          {analysisResult.errors.map((err, i) => (
            <div key={`err-${i}`} style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing.sm,
              padding: designTokens.spacing.sm,
              color: designTokens.colors.error,
              fontSize: designTokens.typography.sizes.sm,
            }}>
              <Icon iconName="ErrorBadge" />
              {err}
            </div>
          ))}
          {analysisResult.warnings.map((warn, i) => (
            <div key={`warn-${i}`} style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing.sm,
              padding: designTokens.spacing.sm,
              color: designTokens.colors.warning,
              fontSize: designTokens.typography.sizes.sm,
            }}>
              <Icon iconName="Warning" />
              {warn}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className={actionsRowStyles}>
        {onOpenFullAnalysis && (
          <PrimaryButton
            text="Full Analysis"
            iconProps={{ iconName: 'OpenInNewTab' }}
            onClick={onOpenFullAnalysis}
          />
        )}
        <DefaultButton
          text="Refresh"
          iconProps={{ iconName: 'Refresh' }}
          onClick={analyzeFlow}
        />
      </div>
    </div>
  );
};

export default AnalysisTab;
