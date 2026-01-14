// AppHeader - Modern 2-row header with grouped action icons
// Row 1: Logo and title
// Row 2: Grouped action buttons (Recording, Clipboard, Analysis, Settings)

import React, { useCallback } from 'react';
import { Icon, TooltipHost, mergeStyles, DirectionalHint } from '@fluentui/react';
import { designTokens } from '../../styles/theme';

export interface HeaderAction {
  key: string;
  iconName: string;
  title: string;
  hoverMessage: string;
  onClick: () => void;
  isActive?: boolean;
  isRecording?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  badge?: string | number;
}

export interface HeaderActionGroup {
  key: string;
  label?: string;
  actions: HeaderAction[];
}

export interface AppHeaderProps {
  title?: string;
  actionGroups: HeaderActionGroup[];
  recordingTimeLeft?: string | null;
  onHoverMessageChange?: (message: string | null) => void;
}

// Styles
const headerContainerStyles = mergeStyles({
  background: `linear-gradient(180deg, ${designTokens.colors.headerBgGradientStart} 0%, ${designTokens.colors.headerBgGradientEnd} 100%)`,
  color: designTokens.colors.headerText,
  flexShrink: 0,
});

const titleRowStyles = mergeStyles({
  height: designTokens.layout.headerTitleHeight,
  display: 'flex',
  alignItems: 'center',
  padding: `0 ${designTokens.spacing.lg}`,
  borderBottom: `1px solid ${designTokens.colors.headerBorder}`,
  gap: designTokens.spacing.md,
});

const logoStyles = mergeStyles({
  width: '24px',
  height: '24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const titleStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.md,
  fontWeight: designTokens.typography.weights.semibold,
  letterSpacing: '0.3px',
});

const actionsRowStyles = mergeStyles({
  height: designTokens.layout.headerActionsHeight,
  display: 'flex',
  alignItems: 'center',
  padding: `0 ${designTokens.spacing.sm}`,
  gap: designTokens.spacing.xs,
});

const actionGroupStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.xxs,
  padding: `0 ${designTokens.spacing.sm}`,
  borderRight: `1px solid ${designTokens.colors.headerBorder}`,
  height: '28px',
  ':last-child': {
    borderRight: 'none',
  },
});

const actionGroupLabelStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.xxs,
  color: designTokens.colors.headerTextMuted,
  marginRight: designTokens.spacing.xs,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  display: 'none', // Hidden by default, show on wider screens
  '@media (min-width: 500px)': {
    display: 'block',
  },
});

const iconButtonStyles = mergeStyles({
  width: designTokens.layout.iconButtonSize,
  height: designTokens.layout.iconButtonSize,
  borderRadius: designTokens.radius.sm,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: `all ${designTokens.transitions.fast}`,
  color: 'rgba(255, 255, 255, 0.85)',
  backgroundColor: 'transparent',
  border: 'none',
  position: 'relative',
  ':hover': {
    backgroundColor: designTokens.colors.headerIconHover,
    color: designTokens.colors.white,
  },
  ':disabled': {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
});

const iconButtonActiveStyles = mergeStyles({
  backgroundColor: designTokens.colors.primary,
  color: designTokens.colors.white,
  ':hover': {
    backgroundColor: designTokens.colors.primaryHover,
  },
});

const recordingPulseKeyframes = `
  @keyframes recordingPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

const iconButtonRecordingStyles = mergeStyles({
  color: '#ff4444',
  animation: 'recordingPulse 1.5s ease-in-out infinite',
});

const badgeStyles = mergeStyles({
  position: 'absolute',
  top: '-4px',
  right: '-4px',
  backgroundColor: designTokens.colors.error,
  color: designTokens.colors.white,
  fontSize: '9px',
  fontWeight: designTokens.typography.weights.bold,
  minWidth: '14px',
  height: '14px',
  borderRadius: '7px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 4px',
});

const spacerStyles = mergeStyles({
  flex: 1,
});

export const AppHeader: React.FC<AppHeaderProps> = ({
  title = 'Power Automate Actions',
  actionGroups,
  recordingTimeLeft,
  onHoverMessageChange,
}) => {
  const handleMouseEnter = useCallback((message: string) => {
    onHoverMessageChange?.(message);
  }, [onHoverMessageChange]);

  const handleMouseLeave = useCallback(() => {
    onHoverMessageChange?.(null);
  }, [onHoverMessageChange]);

  const renderActionButton = useCallback((action: HeaderAction) => {
    if (action.hidden) return null;

    const buttonClasses = [
      iconButtonStyles,
      action.isActive && iconButtonActiveStyles,
      action.isRecording && iconButtonRecordingStyles,
    ].filter(Boolean).join(' ');

    const button = (
      <button
        key={action.key}
        className={buttonClasses}
        onClick={action.onClick}
        disabled={action.disabled}
        onMouseEnter={() => handleMouseEnter(action.hoverMessage)}
        onMouseLeave={handleMouseLeave}
        title={action.title}
      >
        <Icon iconName={action.iconName} style={{ fontSize: '14px' }} />
        {action.badge && <span className={badgeStyles}>{action.badge}</span>}
      </button>
    );

    return (
      <TooltipHost
        key={action.key}
        content={action.title}
        directionalHint={DirectionalHint.bottomCenter}
        calloutProps={{ gapSpace: 4 }}
      >
        {button}
      </TooltipHost>
    );
  }, [handleMouseEnter, handleMouseLeave]);

  const renderActionGroup = useCallback((group: HeaderActionGroup, index: number) => {
    const visibleActions = group.actions.filter(a => !a.hidden);
    if (visibleActions.length === 0) return null;

    return (
      <div key={group.key} className={actionGroupStyles}>
        {group.label && <span className={actionGroupLabelStyles}>{group.label}</span>}
        {visibleActions.map(renderActionButton)}
      </div>
    );
  }, [renderActionButton]);

  // Separate settings from other groups (should be on the right)
  const mainGroups = actionGroups.filter(g => g.key !== 'settings');
  const settingsGroup = actionGroups.find(g => g.key === 'settings');

  return (
    <header className={headerContainerStyles}>
      {/* Inject keyframes for recording animation */}
      <style>{recordingPulseKeyframes}</style>

      {/* Title Row */}
      <div className={titleRowStyles}>
        <div className={logoStyles}>
          <Icon iconName="Flow" style={{ fontSize: '20px' }} />
        </div>
        <span className={titleStyles}>{title}</span>
        {recordingTimeLeft && (
          <span style={{
            marginLeft: 'auto',
            fontSize: designTokens.typography.sizes.sm,
            color: '#ff4444',
            fontWeight: designTokens.typography.weights.medium,
          }}>
            Recording: {recordingTimeLeft}
          </span>
        )}
      </div>

      {/* Actions Row */}
      <div className={actionsRowStyles}>
        {mainGroups.map(renderActionGroup)}
        <div className={spacerStyles} />
        {settingsGroup && renderActionGroup(settingsGroup, -1)}
      </div>
    </header>
  );
};

export default AppHeader;
