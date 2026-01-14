// EmptyState - Consistent empty state display component
// Used when there's no data to show in tabs

import React from 'react';
import { Icon, PrimaryButton, DefaultButton, mergeStyles } from '@fluentui/react';
import { designTokens } from '../../styles/theme';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  primaryAction?: {
    text: string;
    onClick: () => void;
    iconName?: string;
  };
  secondaryAction?: {
    text: string;
    onClick: () => void;
    iconName?: string;
  };
  size?: 'small' | 'medium' | 'large';
  variant?: 'default' | 'subtle' | 'card';
}

// Size configurations
const sizeConfig = {
  small: {
    iconSize: '32px',
    titleSize: designTokens.typography.sizes.md,
    descriptionSize: designTokens.typography.sizes.sm,
    padding: designTokens.spacing.lg,
    gap: designTokens.spacing.sm,
  },
  medium: {
    iconSize: '48px',
    titleSize: designTokens.typography.sizes.lg,
    descriptionSize: designTokens.typography.sizes.md,
    padding: designTokens.spacing.xxl,
    gap: designTokens.spacing.md,
  },
  large: {
    iconSize: '64px',
    titleSize: designTokens.typography.sizes.xl,
    descriptionSize: designTokens.typography.sizes.md,
    padding: designTokens.spacing.xxxl,
    gap: designTokens.spacing.lg,
  },
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'Info',
  title,
  description,
  primaryAction,
  secondaryAction,
  size = 'medium',
  variant = 'default',
}) => {
  const config = sizeConfig[size];

  const containerStyles = mergeStyles({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: config.padding,
    textAlign: 'center',
    minHeight: size === 'large' ? '300px' : size === 'medium' ? '200px' : '150px',
    ...(variant === 'card' && {
      backgroundColor: designTokens.colors.white,
      borderRadius: designTokens.radius.md,
      boxShadow: designTokens.shadows.card,
      margin: designTokens.spacing.lg,
    }),
    ...(variant === 'subtle' && {
      backgroundColor: designTokens.colors.neutralLighterAlt,
      borderRadius: designTokens.radius.md,
    }),
  });

  const iconContainerStyles = mergeStyles({
    width: config.iconSize,
    height: config.iconSize,
    borderRadius: '50%',
    backgroundColor: designTokens.colors.neutralLighter,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: config.gap,
  });

  const iconStyles = mergeStyles({
    fontSize: `calc(${config.iconSize} * 0.5)`,
    color: designTokens.colors.neutralSecondary,
  });

  const titleStyles = mergeStyles({
    fontSize: config.titleSize,
    fontWeight: designTokens.typography.weights.semibold,
    color: designTokens.colors.neutralDark,
    marginBottom: description ? config.gap : 0,
  });

  const descriptionStyles = mergeStyles({
    fontSize: config.descriptionSize,
    color: designTokens.colors.neutralPrimary,
    maxWidth: '300px',
    lineHeight: designTokens.typography.lineHeights.normal,
  });

  const actionsContainerStyles = mergeStyles({
    display: 'flex',
    gap: designTokens.spacing.md,
    marginTop: designTokens.spacing.lg,
    flexWrap: 'wrap',
    justifyContent: 'center',
  });

  return (
    <div className={containerStyles}>
      <div className={iconContainerStyles}>
        <Icon className={iconStyles} iconName={icon} />
      </div>
      <div className={titleStyles}>{title}</div>
      {description && <div className={descriptionStyles}>{description}</div>}
      {(primaryAction || secondaryAction) && (
        <div className={actionsContainerStyles}>
          {primaryAction && (
            <PrimaryButton
              text={primaryAction.text}
              onClick={primaryAction.onClick}
              iconProps={primaryAction.iconName ? { iconName: primaryAction.iconName } : undefined}
              styles={{
                root: {
                  borderRadius: designTokens.radius.sm,
                },
              }}
            />
          )}
          {secondaryAction && (
            <DefaultButton
              text={secondaryAction.text}
              onClick={secondaryAction.onClick}
              iconProps={secondaryAction.iconName ? { iconName: secondaryAction.iconName } : undefined}
              styles={{
                root: {
                  borderRadius: designTokens.radius.sm,
                },
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

// Preset empty states for common scenarios
export const NoActionsEmptyState: React.FC<{ onStartRecording?: () => void }> = ({ onStartRecording }) => (
  <EmptyState
    icon="Play"
    title="No Recorded Actions"
    description="Start recording to capture Power Automate actions from this page."
    primaryAction={onStartRecording ? {
      text: 'Start Recording',
      onClick: onStartRecording,
      iconName: 'Play',
    } : undefined}
  />
);

export const NoClipboardActionsEmptyState: React.FC<{ onPasteFromClipboard?: () => void }> = ({ onPasteFromClipboard }) => (
  <EmptyState
    icon="Paste"
    title="No Copied Actions"
    description="Copy actions from the recorded tab or paste from clipboard."
    primaryAction={onPasteFromClipboard ? {
      text: 'Get from Clipboard',
      onClick: onPasteFromClipboard,
      iconName: 'Paste',
    } : undefined}
  />
);

export const NoFavoritesEmptyState: React.FC = () => (
  <EmptyState
    icon="FavoriteStar"
    title="No Favorites"
    description="Mark actions as favorites to quickly access them later."
  />
);

export const NoPredefinedActionsEmptyState: React.FC<{ onConfigureUrl?: () => void }> = ({ onConfigureUrl }) => (
  <EmptyState
    icon="CloudDownload"
    title="No Predefined Actions"
    description="Configure a URL to load predefined actions from your organization."
    primaryAction={onConfigureUrl ? {
      text: 'Configure URL',
      onClick: onConfigureUrl,
      iconName: 'Settings',
    } : undefined}
  />
);

export const NoSearchResultsEmptyState: React.FC<{ searchTerm: string; onClear?: () => void }> = ({ searchTerm, onClear }) => (
  <EmptyState
    icon="SearchIssue"
    title="No Results Found"
    description={`No actions match "${searchTerm}". Try a different search term.`}
    size="small"
    primaryAction={onClear ? {
      text: 'Clear Search',
      onClick: onClear,
      iconName: 'Cancel',
    } : undefined}
  />
);

export const NotFlowPageEmptyState: React.FC = () => (
  <EmptyState
    icon="Flow"
    title="Not a Flow Page"
    description="Navigate to a Power Automate flow editor page to use this feature."
    size="small"
    variant="subtle"
  />
);

export const LoadingEmptyState: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <EmptyState
    icon="ProgressRingDots"
    title={message}
    size="small"
    variant="subtle"
  />
);

export const ErrorEmptyState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <EmptyState
    icon="ErrorBadge"
    title="Something went wrong"
    description={message}
    primaryAction={onRetry ? {
      text: 'Retry',
      onClick: onRetry,
      iconName: 'Refresh',
    } : undefined}
  />
);

export default EmptyState;
