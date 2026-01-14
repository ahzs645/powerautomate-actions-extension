// StatusBar - Notifications and contextual messages display
// Replaces the MessageBar with a more compact, modern design

import React, { useEffect, useState, useCallback } from 'react';
import { Icon, mergeStyles } from '@fluentui/react';
import { designTokens } from '../../styles/theme';

export type NotificationType = 'success' | 'warning' | 'error' | 'info';

export interface Notification {
  id?: string;
  message: string;
  type: NotificationType;
  autoDismiss?: boolean;
  autoDismissMs?: number;
}

export interface StatusBarProps {
  notification?: Notification | null;
  hoverMessage?: string | null;
  onDismiss?: () => void;
  compact?: boolean;
}

// Type configurations
const typeConfig: Record<NotificationType, { icon: string; bgColor: string; textColor: string; borderColor: string }> = {
  success: {
    icon: 'CheckMark',
    bgColor: designTokens.colors.successLight,
    textColor: designTokens.colors.success,
    borderColor: designTokens.colors.success,
  },
  warning: {
    icon: 'Warning',
    bgColor: designTokens.colors.warningLight,
    textColor: '#8a6d00',
    borderColor: designTokens.colors.warning,
  },
  error: {
    icon: 'ErrorBadge',
    bgColor: designTokens.colors.errorLight,
    textColor: designTokens.colors.error,
    borderColor: designTokens.colors.error,
  },
  info: {
    icon: 'Info',
    bgColor: designTokens.colors.infoLight,
    textColor: designTokens.colors.info,
    borderColor: designTokens.colors.info,
  },
};

const containerStyles = (type: NotificationType | null, compact: boolean) => mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.sm,
  padding: compact ? `${designTokens.spacing.xs} ${designTokens.spacing.md}` : `${designTokens.spacing.sm} ${designTokens.spacing.lg}`,
  backgroundColor: type ? typeConfig[type].bgColor : designTokens.colors.neutralLighter,
  borderLeft: type ? `3px solid ${typeConfig[type].borderColor}` : `3px solid transparent`,
  minHeight: compact ? '28px' : '36px',
  transition: `all ${designTokens.transitions.fast}`,
  flexShrink: 0,
});

const iconContainerStyles = (type: NotificationType | null) => mergeStyles({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: type ? typeConfig[type].textColor : designTokens.colors.neutralSecondary,
  fontSize: '14px',
});

const messageStyles = (type: NotificationType | null, compact: boolean) => mergeStyles({
  flex: 1,
  fontSize: compact ? designTokens.typography.sizes.xs : designTokens.typography.sizes.sm,
  color: type ? typeConfig[type].textColor : designTokens.colors.neutralPrimary,
  fontWeight: type ? designTokens.typography.weights.medium : designTokens.typography.weights.regular,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const dismissButtonStyles = mergeStyles({
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  border: 'none',
  color: designTokens.colors.neutralSecondary,
  transition: `all ${designTokens.transitions.fast}`,
  ':hover': {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    color: designTokens.colors.neutralDark,
  },
});

const hoverMessageStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.sm,
  padding: `${designTokens.spacing.xs} ${designTokens.spacing.lg}`,
  backgroundColor: designTokens.colors.neutralLighter,
  minHeight: '28px',
  flexShrink: 0,
});

const hoverMessageTextStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.xs,
  color: designTokens.colors.neutralPrimary,
  fontStyle: 'italic',
});

export const StatusBar: React.FC<StatusBarProps> = ({
  notification,
  hoverMessage,
  onDismiss,
  compact = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  // Handle auto-dismiss
  useEffect(() => {
    if (notification) {
      setIsVisible(true);
      if (notification.autoDismiss !== false) {
        const timeout = setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => onDismiss?.(), 200);
        }, notification.autoDismissMs || 5000);
        return () => clearTimeout(timeout);
      }
    } else {
      setIsVisible(false);
    }
  }, [notification, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onDismiss?.(), 100);
  }, [onDismiss]);

  // Show notification if present
  if (notification && isVisible) {
    const config = typeConfig[notification.type];
    return (
      <div className={containerStyles(notification.type, compact)}>
        <div className={iconContainerStyles(notification.type)}>
          <Icon iconName={config.icon} />
        </div>
        <span className={messageStyles(notification.type, compact)}>
          {notification.message}
        </span>
        <button
          className={dismissButtonStyles}
          onClick={handleDismiss}
          title="Dismiss"
        >
          <Icon iconName="Cancel" style={{ fontSize: '10px' }} />
        </button>
      </div>
    );
  }

  // Show hover message if present (contextual help)
  if (hoverMessage) {
    return (
      <div className={hoverMessageStyles}>
        <Icon iconName="Info" style={{ fontSize: '12px', color: designTokens.colors.neutralSecondary }} />
        <span className={hoverMessageTextStyles}>{hoverMessage}</span>
      </div>
    );
  }

  // Empty state - minimal height placeholder
  return (
    <div style={{
      height: compact ? '28px' : '36px',
      backgroundColor: designTokens.colors.neutralLighter,
      borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
      flexShrink: 0,
    }} />
  );
};

// Toast notification component for floating notifications
export interface ToastNotificationProps {
  notification: Notification | null;
  onDismiss: () => void;
  position?: 'top' | 'bottom';
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  notification,
  onDismiss,
  position = 'top',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (notification) {
      setIsVisible(true);
      setIsExiting(false);

      if (notification.autoDismiss !== false) {
        const timeout = setTimeout(() => {
          setIsExiting(true);
          setTimeout(() => {
            setIsVisible(false);
            onDismiss();
          }, 200);
        }, notification.autoDismissMs || 3000);
        return () => clearTimeout(timeout);
      }
    }
  }, [notification, onDismiss]);

  if (!notification || !isVisible) return null;

  const config = typeConfig[notification.type];

  const toastStyles = mergeStyles({
    position: 'fixed',
    [position]: '16px',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: designTokens.spacing.sm,
    padding: `${designTokens.spacing.md} ${designTokens.spacing.lg}`,
    backgroundColor: designTokens.colors.white,
    borderRadius: designTokens.radius.md,
    boxShadow: designTokens.shadows.elevated,
    borderLeft: `4px solid ${config.borderColor}`,
    zIndex: designTokens.zIndex.tooltip,
    maxWidth: '400px',
    animation: isExiting
      ? 'toastExit 0.2s ease-out forwards'
      : 'toastEnter 0.2s ease-out forwards',
  });

  const keyframes = `
    @keyframes toastEnter {
      from { opacity: 0; transform: translateX(100%); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes toastExit {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(100%); }
    }
  `;

  return (
    <>
      <style>{keyframes}</style>
      <div className={toastStyles}>
        <Icon iconName={config.icon} style={{ color: config.textColor, fontSize: '16px' }} />
        <span style={{
          flex: 1,
          fontSize: designTokens.typography.sizes.sm,
          color: designTokens.colors.neutralDark,
        }}>
          {notification.message}
        </span>
        <button
          className={dismissButtonStyles}
          onClick={() => {
            setIsExiting(true);
            setTimeout(() => {
              setIsVisible(false);
              onDismiss();
            }, 200);
          }}
        >
          <Icon iconName="Cancel" style={{ fontSize: '10px' }} />
        </button>
      </div>
    </>
  );
};

export default StatusBar;
