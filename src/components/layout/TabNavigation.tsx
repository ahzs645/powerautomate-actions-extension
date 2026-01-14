// TabNavigation - Enhanced Pivot component with icons and visual grouping
// Groups tabs into Action Management and Analysis Features

import React, { useCallback } from 'react';
import { Pivot, PivotItem, Icon, mergeStyles, IPivotStyles } from '@fluentui/react';
import { Mode } from '../../models';
import { designTokens } from '../../styles/theme';

export interface TabConfig {
  key: string;
  mode: Mode;
  label: string;
  icon: string;
  hidden?: boolean;
  badge?: number;
}

export interface TabNavigationProps {
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
  tabs: TabConfig[];
  showSettings?: boolean;
}

// Tab configurations grouped by category
export const defaultTabs: TabConfig[] = [
  // Action Management
  { key: 'recorded', mode: Mode.Requests, label: 'Recorded', icon: 'Record2' },
  { key: 'copied', mode: Mode.CopiedActions, label: 'Copied', icon: 'Copy' },
  { key: 'favorites', mode: Mode.Favorites, label: 'Favorites', icon: 'FavoriteStar' },
  { key: 'predefined', mode: Mode.PredefinedActions, label: 'Predefined', icon: 'CloudDownload' },
];

// Pivot styles
const pivotStyles: Partial<IPivotStyles> = {
  root: {
    display: 'flex',
    borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
    backgroundColor: designTokens.colors.white,
    paddingLeft: designTokens.spacing.sm,
  },
  link: {
    height: designTokens.layout.tabBarHeight,
    padding: `0 ${designTokens.spacing.md}`,
    fontSize: designTokens.typography.sizes.sm,
    fontWeight: designTokens.typography.weights.medium,
    color: designTokens.colors.neutralPrimary,
    backgroundColor: 'transparent',
    marginRight: '0',
    selectors: {
      ':hover': {
        backgroundColor: designTokens.colors.neutralLighter,
        color: designTokens.colors.neutralDark,
      },
      ':focus': {
        backgroundColor: 'transparent',
      },
    },
  },
  linkIsSelected: {
    color: designTokens.colors.primary,
    fontWeight: designTokens.typography.weights.semibold,
    selectors: {
      ':before': {
        backgroundColor: designTokens.colors.primary,
        height: '3px',
        borderRadius: '2px 2px 0 0',
      },
      ':hover': {
        color: designTokens.colors.primary,
        backgroundColor: 'transparent',
      },
    },
  },
  linkContent: {
    display: 'flex',
    alignItems: 'center',
    gap: designTokens.spacing.xs,
  },
  itemContainer: {
    // Hide the content area since we handle it separately
    display: 'none',
  },
};

const tabIconStyles = mergeStyles({
  fontSize: '12px',
});

const tabLabelStyles = mergeStyles({
  '@media (max-width: 500px)': {
    display: 'none',
  },
});

const badgeStyles = mergeStyles({
  backgroundColor: designTokens.colors.primary,
  color: designTokens.colors.white,
  fontSize: '10px',
  fontWeight: designTokens.typography.weights.bold,
  minWidth: '16px',
  height: '16px',
  borderRadius: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 4px',
  marginLeft: designTokens.spacing.xxs,
});

const containerStyles = mergeStyles({
  flexShrink: 0,
});

export const TabNavigation: React.FC<TabNavigationProps> = ({
  currentMode,
  onModeChange,
  tabs,
  showSettings = false,
}) => {
  const handleLinkClick = useCallback((item?: PivotItem) => {
    if (item?.props.itemKey) {
      const tab = tabs.find(t => t.key === item.props.itemKey);
      if (tab) {
        onModeChange(tab.mode);
      }
    }
  }, [tabs, onModeChange]);

  // Find the currently selected tab key
  const selectedKey = tabs.find(t => t.mode === currentMode)?.key || tabs[0]?.key;

  // Filter visible tabs
  const visibleTabs = tabs.filter(t => !t.hidden);

  if (showSettings) {
    return null; // Don't show tabs when settings is open
  }

  return (
    <div className={containerStyles}>
      <Pivot
        selectedKey={selectedKey}
        onLinkClick={handleLinkClick}
        styles={pivotStyles}
        headersOnly
      >
        {visibleTabs.map(tab => (
          <PivotItem
            key={tab.key}
            itemKey={tab.key}
            headerText={tab.label}
            onRenderItemLink={(link, defaultRenderer) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon iconName={tab.icon} className={tabIconStyles} />
                <span className={tabLabelStyles}>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={badgeStyles}>{tab.badge > 99 ? '99+' : tab.badge}</span>
                )}
              </span>
            )}
          />
        ))}
      </Pivot>
    </div>
  );
};

// Extended tab navigation with Analysis tabs
export interface ExtendedTabNavigationProps extends Omit<TabNavigationProps, 'tabs'> {
  showPredefinedActions?: boolean;
  showAnalysisTabs?: boolean;
  actionCounts?: {
    recorded?: number;
    copied?: number;
    favorites?: number;
    predefined?: number;
  };
}

export const ExtendedTabNavigation: React.FC<ExtendedTabNavigationProps> = ({
  currentMode,
  onModeChange,
  showSettings = false,
  showPredefinedActions = false,
  showAnalysisTabs = false,
  actionCounts,
}) => {
  const tabs: TabConfig[] = [
    {
      key: 'recorded',
      mode: Mode.Requests,
      label: 'Recorded',
      icon: 'Record2',
      badge: actionCounts?.recorded,
    },
    {
      key: 'copied',
      mode: Mode.CopiedActions,
      label: 'Copied',
      icon: 'Copy',
      badge: actionCounts?.copied,
    },
    {
      key: 'favorites',
      mode: Mode.Favorites,
      label: 'Favorites',
      icon: 'FavoriteStar',
      badge: actionCounts?.favorites,
    },
    {
      key: 'predefined',
      mode: Mode.PredefinedActions,
      label: 'Predefined',
      icon: 'CloudDownload',
      hidden: !showPredefinedActions,
      badge: actionCounts?.predefined,
    },
  ];

  return (
    <TabNavigation
      currentMode={currentMode}
      onModeChange={onModeChange}
      tabs={tabs}
      showSettings={showSettings}
    />
  );
};

export default TabNavigation;
