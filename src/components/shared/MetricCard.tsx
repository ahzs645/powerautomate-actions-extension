// MetricCard - Compact metric display component for analysis dashboards
// Used in Analysis, Compare, and Solution tabs

import React from 'react';
import { Icon, mergeStyles } from '@fluentui/react';
import { designTokens, getRatingColor, getComplexityColor } from '../../styles/theme';

export type MetricType = 'default' | 'rating' | 'complexity' | 'success' | 'warning' | 'error' | 'info';

export interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: string;
  type?: MetricType;
  customColor?: string;
  size?: 'small' | 'medium' | 'large';
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
}

// Get color based on metric type
const getMetricColor = (type: MetricType, value: number | string): string => {
  switch (type) {
    case 'rating':
      return getRatingColor(typeof value === 'number' ? value : parseInt(value as string, 10) || 0);
    case 'complexity':
      return getComplexityColor(typeof value === 'number' ? value : parseInt(value as string, 10) || 0);
    case 'success':
      return designTokens.colors.success;
    case 'warning':
      return designTokens.colors.warning;
    case 'error':
      return designTokens.colors.error;
    case 'info':
      return designTokens.colors.info;
    default:
      return designTokens.colors.primary;
  }
};

// Size configurations
const sizeConfig = {
  small: {
    padding: `${designTokens.spacing.sm} ${designTokens.spacing.md}`,
    minWidth: '60px',
    valueSize: designTokens.typography.sizes.lg,
    labelSize: designTokens.typography.sizes.xxs,
    iconSize: '12px',
  },
  medium: {
    padding: `${designTokens.spacing.md} ${designTokens.spacing.lg}`,
    minWidth: '80px',
    valueSize: designTokens.typography.sizes.xl,
    labelSize: designTokens.typography.sizes.xs,
    iconSize: '14px',
  },
  large: {
    padding: `${designTokens.spacing.lg} ${designTokens.spacing.xl}`,
    minWidth: '100px',
    valueSize: designTokens.typography.sizes.xxl,
    labelSize: designTokens.typography.sizes.sm,
    iconSize: '16px',
  },
};

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  icon,
  type = 'default',
  customColor,
  size = 'medium',
  subtitle,
  trend,
  onClick,
}) => {
  const color = customColor || getMetricColor(type, value);
  const config = sizeConfig[size];

  const containerStyles = mergeStyles({
    padding: config.padding,
    borderRadius: designTokens.radius.md,
    backgroundColor: color,
    color: designTokens.colors.white,
    textAlign: 'center',
    minWidth: config.minWidth,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: designTokens.spacing.xxs,
    cursor: onClick ? 'pointer' : 'default',
    transition: `all ${designTokens.transitions.normal}`,
    ':hover': onClick ? {
      transform: 'translateY(-2px)',
      boxShadow: designTokens.shadows.md,
    } : {},
  });

  const valueStyles = mergeStyles({
    fontSize: config.valueSize,
    fontWeight: designTokens.typography.weights.bold,
    lineHeight: 1.2,
    display: 'flex',
    alignItems: 'center',
    gap: designTokens.spacing.xs,
  });

  const labelStyles = mergeStyles({
    fontSize: config.labelSize,
    fontWeight: designTokens.typography.weights.medium,
    opacity: 0.9,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  });

  const subtitleStyles = mergeStyles({
    fontSize: designTokens.typography.sizes.xxs,
    opacity: 0.75,
  });

  const iconStyles = mergeStyles({
    fontSize: config.iconSize,
    marginBottom: designTokens.spacing.xxs,
    opacity: 0.9,
  });

  const trendIconMap = {
    up: 'Up',
    down: 'Down',
    neutral: 'Remove',
  };

  return (
    <div className={containerStyles} onClick={onClick}>
      {icon && (
        <Icon className={iconStyles} iconName={icon} />
      )}
      <div className={valueStyles}>
        {value}
        {trend && (
          <Icon
            iconName={trendIconMap[trend]}
            style={{
              fontSize: '12px',
              color: trend === 'up' ? '#90EE90' : trend === 'down' ? '#FFB6C1' : 'white',
            }}
          />
        )}
      </div>
      <div className={labelStyles}>{label}</div>
      {subtitle && <div className={subtitleStyles}>{subtitle}</div>}
    </div>
  );
};

// Horizontal variant for inline displays
export interface MetricCardHorizontalProps extends MetricCardProps {
  compact?: boolean;
}

export const MetricCardHorizontal: React.FC<MetricCardHorizontalProps> = ({
  label,
  value,
  icon,
  type = 'default',
  customColor,
  compact = false,
  onClick,
}) => {
  const color = customColor || getMetricColor(type, value);

  const containerStyles = mergeStyles({
    display: 'flex',
    alignItems: 'center',
    gap: designTokens.spacing.sm,
    padding: compact ? designTokens.spacing.sm : designTokens.spacing.md,
    borderRadius: designTokens.radius.sm,
    backgroundColor: designTokens.colors.white,
    boxShadow: designTokens.shadows.xs,
    cursor: onClick ? 'pointer' : 'default',
    transition: `all ${designTokens.transitions.fast}`,
    ':hover': onClick ? {
      boxShadow: designTokens.shadows.sm,
    } : {},
  });

  const indicatorStyles = mergeStyles({
    width: '4px',
    height: compact ? '24px' : '32px',
    borderRadius: designTokens.radius.xs,
    backgroundColor: color,
    flexShrink: 0,
  });

  const contentStyles = mergeStyles({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  });

  const valueContainerStyles = mergeStyles({
    display: 'flex',
    alignItems: 'center',
    gap: designTokens.spacing.xs,
  });

  const valueStyles = mergeStyles({
    fontSize: compact ? designTokens.typography.sizes.md : designTokens.typography.sizes.lg,
    fontWeight: designTokens.typography.weights.bold,
    color: color,
  });

  const labelStyles = mergeStyles({
    fontSize: designTokens.typography.sizes.xs,
    color: designTokens.colors.neutralSecondary,
  });

  return (
    <div className={containerStyles} onClick={onClick}>
      <div className={indicatorStyles} />
      <div className={contentStyles}>
        <div className={valueContainerStyles}>
          {icon && <Icon iconName={icon} style={{ color, fontSize: '14px' }} />}
          <span className={valueStyles}>{value}</span>
        </div>
        <span className={labelStyles}>{label}</span>
      </div>
    </div>
  );
};

// Grid container for multiple metrics
export interface MetricGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  gap?: 'small' | 'medium' | 'large';
}

export const MetricGrid: React.FC<MetricGridProps> = ({
  children,
  columns = 4,
  gap = 'medium',
}) => {
  const gapValues = {
    small: designTokens.spacing.sm,
    medium: designTokens.spacing.md,
    large: designTokens.spacing.lg,
  };

  const gridStyles = mergeStyles({
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: gapValues[gap],
  });

  return <div className={gridStyles}>{children}</div>;
};

export default MetricCard;
