// CopiedActionsTab - Tab component for copied actions (My Clipboard)
// Refactored from App.tsx ActionsList usage

import React, { useMemo, useCallback } from 'react';
import { mergeStyles } from '@fluentui/react';
import { IActionModel } from '../../models';
import { ActionCard } from '../shared/ActionCard';
import { SearchBar } from '../shared/SearchBar';
import { NoClipboardActionsEmptyState, NoSearchResultsEmptyState } from '../shared/EmptyState';
import { designTokens } from '../../styles/theme';

export interface CopiedActionsTabProps {
  actions: IActionModel[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSelectAction: (action: IActionModel) => void;
  onDeleteAction: (action: IActionModel) => void;
  onToggleFavorite: (action: IActionModel) => void;
  onPasteFromClipboard?: () => void;
}

const containerStyles = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
});

const listContainerStyles = mergeStyles({
  flex: 1,
  overflowY: 'auto',
  padding: `${designTokens.spacing.sm} 0`,
});

export const CopiedActionsTab: React.FC<CopiedActionsTabProps> = ({
  actions,
  searchTerm,
  onSearchChange,
  onSelectAction,
  onDeleteAction,
  onToggleFavorite,
  onPasteFromClipboard,
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

  // Show empty state if no actions
  if (actions.length === 0) {
    return (
      <div className={containerStyles}>
        <NoClipboardActionsEmptyState onPasteFromClipboard={onPasteFromClipboard} />
      </div>
    );
  }

  // Show no results if search has no matches
  if (filteredActions.length === 0 && searchTerm) {
    return (
      <div className={containerStyles}>
        <SearchBar
          value={searchTerm}
          onChange={onSearchChange}
          placeholder="Search copied actions..."
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
      <SearchBar
        value={searchTerm}
        onChange={onSearchChange}
        placeholder="Search copied actions..."
      />
      <div className={listContainerStyles}>
        {filteredActions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            showSelectButton={true}
            showFavoriteButton={true}
            showDeleteButton={true}
            showInfoButton={true}
            onSelect={onSelectAction}
            onDelete={onDeleteAction}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  );
};

export default CopiedActionsTab;
