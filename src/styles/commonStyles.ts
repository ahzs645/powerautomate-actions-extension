// Shared styles using Fluent UI mergeStyles
// Reusable style definitions for components

import { mergeStyles, keyframes } from '@fluentui/react';
import { designTokens } from './theme';

// ============================================
// Card Styles
// ============================================

export const cardStyles = mergeStyles({
  padding: designTokens.spacing.lg,
  borderRadius: designTokens.radius.md,
  backgroundColor: designTokens.colors.white,
  boxShadow: designTokens.shadows.card,
  transition: `box-shadow ${designTokens.transitions.normal}`,
  ':hover': {
    boxShadow: designTokens.shadows.cardHover,
  },
});

export const cardStylesNoHover = mergeStyles({
  padding: designTokens.spacing.lg,
  borderRadius: designTokens.radius.md,
  backgroundColor: designTokens.colors.white,
  boxShadow: designTokens.shadows.card,
});

export const cardStylesElevated = mergeStyles({
  padding: designTokens.spacing.lg,
  borderRadius: designTokens.radius.md,
  backgroundColor: designTokens.colors.white,
  boxShadow: designTokens.shadows.elevated,
});

// ============================================
// Metric Card Styles
// ============================================

export const metricCardStyles = (color: string) =>
  mergeStyles({
    padding: `${designTokens.spacing.md} ${designTokens.spacing.lg}`,
    borderRadius: designTokens.radius.md,
    backgroundColor: color,
    color: designTokens.colors.white,
    textAlign: 'center',
    minWidth: '80px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: designTokens.spacing.xs,
  });

export const metricCardCompactStyles = (color: string) =>
  mergeStyles({
    padding: designTokens.spacing.sm,
    borderRadius: designTokens.radius.sm,
    backgroundColor: color,
    color: designTokens.colors.white,
    textAlign: 'center',
    minWidth: '60px',
  });

// ============================================
// Action Row/Card Styles
// ============================================

export const actionRowStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  padding: `${designTokens.spacing.md} ${designTokens.spacing.lg}`,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
  gap: designTokens.spacing.md,
  transition: `background-color ${designTokens.transitions.fast}`,
  ':hover': {
    backgroundColor: designTokens.colors.neutralLighter,
  },
});

export const actionCardStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  padding: `${designTokens.spacing.md} ${designTokens.spacing.lg}`,
  margin: `${designTokens.spacing.sm} ${designTokens.spacing.lg}`,
  backgroundColor: designTokens.colors.white,
  borderRadius: designTokens.radius.md,
  boxShadow: designTokens.shadows.sm,
  gap: designTokens.spacing.md,
  transition: `all ${designTokens.transitions.normal}`,
  ':hover': {
    boxShadow: designTokens.shadows.md,
    transform: 'translateY(-1px)',
  },
});

// ============================================
// Header Styles
// ============================================

export const headerStyles = mergeStyles({
  background: `linear-gradient(180deg, ${designTokens.colors.headerBgGradientStart} 0%, ${designTokens.colors.headerBgGradientEnd} 100%)`,
  color: designTokens.colors.headerText,
});

export const headerTitleRowStyles = mergeStyles({
  height: designTokens.layout.headerTitleHeight,
  display: 'flex',
  alignItems: 'center',
  padding: `0 ${designTokens.spacing.lg}`,
  borderBottom: `1px solid ${designTokens.colors.headerBorder}`,
});

export const headerActionsRowStyles = mergeStyles({
  height: designTokens.layout.headerActionsHeight,
  display: 'flex',
  alignItems: 'center',
  padding: `0 ${designTokens.spacing.md}`,
  gap: designTokens.spacing.sm,
});

export const headerGroupStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  gap: designTokens.spacing.xs,
  padding: `0 ${designTokens.spacing.sm}`,
  borderRight: `1px solid rgba(255, 255, 255, 0.15)`,
  ':last-child': {
    borderRight: 'none',
  },
});

// ============================================
// Button Styles
// ============================================

export const iconButtonStyles = mergeStyles({
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
  ':hover': {
    backgroundColor: designTokens.colors.headerIconHover,
    color: designTokens.colors.white,
  },
});

export const iconButtonActiveStyles = mergeStyles({
  backgroundColor: designTokens.colors.primary,
  color: designTokens.colors.white,
});

// Recording animation
const pulseAnimation = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.5 },
});

export const iconButtonRecordingStyles = mergeStyles({
  color: '#ff4444',
  animationName: pulseAnimation,
  animationDuration: '1.5s',
  animationIterationCount: 'infinite',
});

// ============================================
// Section Styles
// ============================================

export const sectionHeaderStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.md,
  fontWeight: designTokens.typography.weights.semibold,
  color: designTokens.colors.neutralDark,
  marginBottom: designTokens.spacing.md,
});

export const sectionSubheaderStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.sm,
  fontWeight: designTokens.typography.weights.medium,
  color: designTokens.colors.neutralPrimary,
  marginBottom: designTokens.spacing.sm,
});

// ============================================
// Status Badge Styles
// ============================================

export const badgeStyles = (color: string, bgColor: string) =>
  mergeStyles({
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${designTokens.spacing.xxs} ${designTokens.spacing.sm}`,
    borderRadius: designTokens.radius.sm,
    fontSize: designTokens.typography.sizes.xs,
    fontWeight: designTokens.typography.weights.semibold,
    color: color,
    backgroundColor: bgColor,
  });

export const successBadgeStyles = badgeStyles(
  designTokens.colors.success,
  designTokens.colors.successLight
);

export const warningBadgeStyles = badgeStyles(
  designTokens.colors.warning,
  designTokens.colors.warningLight
);

export const errorBadgeStyles = badgeStyles(
  designTokens.colors.error,
  designTokens.colors.errorLight
);

export const infoBadgeStyles = badgeStyles(
  designTokens.colors.info,
  designTokens.colors.infoLight
);

// ============================================
// Empty State Styles
// ============================================

export const emptyStateStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: designTokens.spacing.xxl,
  textAlign: 'center',
  color: designTokens.colors.neutralPrimary,
});

export const emptyStateIconStyles = mergeStyles({
  fontSize: '48px',
  color: designTokens.colors.neutralLight,
  marginBottom: designTokens.spacing.lg,
});

// ============================================
// Upload Zone Styles
// ============================================

export const uploadZoneStyles = mergeStyles({
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

// ============================================
// Tab Content Styles
// ============================================

export const tabContentStyles = mergeStyles({
  flex: 1,
  overflowY: 'auto',
  padding: 0,
});

export const tabContentPaddedStyles = mergeStyles({
  flex: 1,
  overflowY: 'auto',
  padding: designTokens.spacing.lg,
});

// ============================================
// Scrollbar Styles (for WebKit browsers)
// ============================================

export const customScrollbarStyles = mergeStyles({
  '::-webkit-scrollbar': {
    width: '8px',
  },
  '::-webkit-scrollbar-track': {
    backgroundColor: designTokens.colors.neutralLighter,
  },
  '::-webkit-scrollbar-thumb': {
    backgroundColor: designTokens.colors.neutralLight,
    borderRadius: designTokens.radius.sm,
  },
  '::-webkit-scrollbar-thumb:hover': {
    backgroundColor: designTokens.colors.neutralSecondary,
  },
});

// ============================================
// Search Bar Styles
// ============================================

export const searchBarContainerStyles = mergeStyles({
  padding: `${designTokens.spacing.sm} ${designTokens.spacing.lg}`,
  backgroundColor: designTokens.colors.neutralLighter,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
});

// ============================================
// Tooltip/Hover Message Styles
// ============================================

export const hoverMessageStyles = mergeStyles({
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: `${designTokens.spacing.xs} ${designTokens.spacing.sm}`,
  backgroundColor: designTokens.colors.neutralDark,
  color: designTokens.colors.white,
  fontSize: designTokens.typography.sizes.xs,
  borderRadius: designTokens.radius.sm,
  whiteSpace: 'nowrap',
  zIndex: designTokens.zIndex.tooltip,
  marginBottom: designTokens.spacing.xs,
});
