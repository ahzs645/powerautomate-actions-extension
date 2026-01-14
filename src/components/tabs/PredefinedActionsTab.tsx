// PredefinedActionsTab - Tab component for predefined actions from URL
// Refactored from PredefinedActionsList component

import React, { useMemo, useCallback } from 'react';
import { Spinner, SpinnerSize, mergeStyles, Icon, DefaultButton } from '@fluentui/react';
import { IActionModel } from '../../models';
import { ActionCard } from '../shared/ActionCard';
import { SearchBar } from '../shared/SearchBar';
import { NoPredefinedActionsEmptyState, NoSearchResultsEmptyState, LoadingEmptyState } from '../shared/EmptyState';
import { designTokens } from '../../styles/theme';

export interface PredefinedActionsTabProps {
  actions: IActionModel[];
  isLoading: boolean;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSelectAction: (action: IActionModel) => void;
  onToggleFavorite: (action: IActionModel) => void;
  onRefresh: () => void;
  onConfigureUrl?: () => void;
}

const containerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
});

const headerRowStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: `${designTokens.spacing.xs} ${designTokens.spacing.lg}`,
  backgroundColor: designTokens.colors.white,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
});

const refreshButtonStyles = {
  root: {
    minWidth: 'auto',
    padding: `0 ${designTokens.spacing.md}`,
    height: '28px',
    borderRadius: designTokens.radius.sm,
  },
  label: {
    fontSize: designTokens.typography.sizes.xs,
  },
};

const listContainerStyles = mergeStyles({
  flex: 1,
  overflowY: 'auto',
  padding: `${designTokens.spacing.sm} 0`,
});

const loadingContainerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  gap: designTokens.spacing.md,
});

export const PredefinedActionsTab: React.FC<PredefinedActionsTabProps> = ({
  actions,
  isLoading,
  searchTerm,
  onSearchChange,
  onSelectAction,
  onToggleFavorite,
  onRefresh,
  onConfigureUrl,
}) => {
  // Filter actions by search term
  const filteredActions = useMemo(() => {
    if (!searchTerm || searchTerm.trim() === '') {
      return actions;
    }
    return actions.filter(action =>
      action.title.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [actions, searchTerm]);

  const handleClearSearch = useCallback(() => {
    onSearchChange('');
  }, [onSearchChange]);

  // Show loading state
  if (isLoading) {
    return (
      <div className={containerStyles}>
        <div className={loadingContainerStyles}>
          <Spinner size={SpinnerSize.large} />
          <span style={{
            fontSize: designTokens.typography.sizes.sm,
            color: designTokens.colors.neutralPrimary,
          }}>
            Loading predefined actions...
          </span>
        </div>
      </div>
    );
  }

  // Show empty state if no actions
  if (actions.length === 0) {
    return (
      <div className={containerStyles}>
        <NoPredefinedActionsEmptyState onConfigureUrl={onConfigureUrl} />
      </div>
    );
  }

  // Show no results if search has no matches
  if (filteredActions.length === 0 && searchTerm) {
    return (
      <div className={containerStyles}>
        <div className={headerRowStyles}>
          <DefaultButton
            text="Refresh"
            iconProps={{ iconName: 'Refresh' }}
            onClick={onRefresh}
            styles={refreshButtonStyles}
          />
        </div>
        <SearchBar
          value={searchTerm}
          onChange={onSearchChange}
          placeholder="Search predefined actions..."
        />
        <NoSearchResultsEmptyState
          searchTerm={searchTerm}
          onClear={handleClearSearch}
        />
      </div>
    );
  }

  return (
    <div className={containerStyles}>
      <div className={headerRowStyles}>
        <DefaultButton
          text="Refresh"
          iconProps={{ iconName: 'Refresh' }}
          onClick={onRefresh}
          styles={refreshButtonStyles}
        />
      </div>
      <SearchBar
        value={searchTerm}
        onChange={onSearchChange}
        placeholder="Search predefined actions..."
      />
      <div className={listContainerStyles}>
        {filteredActions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            showSelectButton={true}
            showFavoriteButton={true}
            showDeleteButton={false} // Can't delete predefined actions
            showInfoButton={true}
            onSelect={onSelectAction}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  );
};

export default PredefinedActionsTab;
