// ActionCard - Modern card-based action display component
// Replaces the grid-based action rows with a cleaner card design

import React, { useCallback, useState } from 'react';
import { Checkbox, Icon, Panel, PanelType, mergeStyles } from '@fluentui/react';
import { IActionModel } from '../../models/IActionModel';
import { designTokens } from '../../styles/theme';

export interface ActionCardProps {
  action: IActionModel;
  showSelectButton?: boolean;
  showFavoriteButton?: boolean;
  showDeleteButton?: boolean;
  showInfoButton?: boolean;
  onSelect?: (action: IActionModel) => void;
  onDelete?: (action: IActionModel) => void;
  onToggleFavorite?: (action: IActionModel) => void;
}

// Styles
const cardContainerStyles = mergeStyles({
  display: 'flex',
  alignItems: 'center',
  padding: `${designTokens.spacing.md} ${designTokens.spacing.lg}`,
  margin: `${designTokens.spacing.xs} ${designTokens.spacing.md}`,
  backgroundColor: designTokens.colors.white,
  borderRadius: designTokens.radius.md,
  boxShadow: designTokens.shadows.sm,
  gap: designTokens.spacing.md,
  transition: `all ${designTokens.transitions.normal}`,
  cursor: 'pointer',
  ':hover': {
    boxShadow: designTokens.shadows.md,
    transform: 'translateY(-1px)',
  },
});

const cardSelectedStyles = mergeStyles({
  borderLeft: `3px solid ${designTokens.colors.primary}`,
  backgroundColor: designTokens.colors.primaryLight,
});

const iconContainerStyles = mergeStyles({
  width: '32px',
  height: '32px',
  borderRadius: designTokens.radius.sm,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
});

const titleStyles = mergeStyles({
  flex: 1,
  fontSize: designTokens.typography.sizes.md,
  fontWeight: designTokens.typography.weights.medium,
  color: designTokens.colors.neutralDark,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const methodBadgeStyles = (method: string) => {
  const colors: Record<string, { bg: string; text: string }> = {
    GET: { bg: designTokens.colors.successLight, text: designTokens.colors.success },
    POST: { bg: designTokens.colors.primaryLight, text: designTokens.colors.primary },
    PUT: { bg: designTokens.colors.warningLight, text: designTokens.colors.warning },
    PATCH: { bg: designTokens.colors.infoLight, text: designTokens.colors.info },
    DELETE: { bg: designTokens.colors.errorLight, text: designTokens.colors.error },
  };
  const color = colors[method.toUpperCase()] || { bg: designTokens.colors.neutralLight, text: designTokens.colors.neutralPrimary };

  return mergeStyles({
    padding: `${designTokens.spacing.xxs} ${designTokens.spacing.sm}`,
    borderRadius: designTokens.radius.sm,
    fontSize: designTokens.typography.sizes.xs,
    fontWeight: designTokens.typography.weights.semibold,
    backgroundColor: color.bg,
    color: color.text,
    textTransform: 'uppercase',
    flexShrink: 0,
  });
};

const actionButtonStyles = mergeStyles({
  width: '28px',
  height: '28px',
  borderRadius: designTokens.radius.sm,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: designTokens.colors.neutralSecondary,
  backgroundColor: 'transparent',
  border: 'none',
  transition: `all ${designTokens.transitions.fast}`,
  ':hover': {
    backgroundColor: designTokens.colors.neutralLighter,
    color: designTokens.colors.neutralDark,
  },
});

const favoriteActiveStyles = mergeStyles({
  color: '#ffc107',
  ':hover': {
    color: '#e6ac00',
  },
});

const deleteButtonStyles = mergeStyles({
  ':hover': {
    backgroundColor: designTokens.colors.errorLight,
    color: designTokens.colors.error,
  },
});

const detailSectionStyles = mergeStyles({
  marginBottom: designTokens.spacing.lg,
});

const detailLabelStyles = mergeStyles({
  fontSize: designTokens.typography.sizes.sm,
  fontWeight: designTokens.typography.weights.semibold,
  color: designTokens.colors.neutralDark,
  marginBottom: designTokens.spacing.xs,
});

const detailValueStyles = mergeStyles({
  backgroundColor: designTokens.colors.neutralLighter,
  padding: designTokens.spacing.md,
  borderRadius: designTokens.radius.sm,
  fontFamily: designTokens.typography.fontFamilyMono,
  fontSize: designTokens.typography.sizes.sm,
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
  maxHeight: '200px',
  overflowY: 'auto',
});

export const ActionCard: React.FC<ActionCardProps> = ({
  action,
  showSelectButton = true,
  showFavoriteButton = false,
  showDeleteButton = true,
  showInfoButton = true,
  onSelect,
  onDelete,
  onToggleFavorite,
}) => {
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const handleSelect = useCallback(() => {
    onSelect?.(action);
  }, [action, onSelect]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(action);
  }, [action, onDelete]);

  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(action);
  }, [action, onToggleFavorite]);

  const handleShowDetails = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPanelOpen(true);
  }, []);

  const renderDetailsPanel = useCallback(() => {
    let parsedBody: any = null;
    let parsedHeaders: any = null;
    let parsedActionData: any = null;

    try {
      parsedActionData = JSON.parse(action.actionJson);
      parsedBody = parsedActionData.body || action.body;
      parsedHeaders = parsedActionData.headers;
    } catch (e) {
      parsedBody = action.body;
    }

    return (
      <Panel
        isOpen={isPanelOpen}
        onDismiss={() => setIsPanelOpen(false)}
        type={PanelType.custom}
        customWidth="450px"
        headerText={`Action Details`}
        closeButtonAriaLabel="Close"
        styles={{
          content: { padding: designTokens.spacing.lg },
          headerText: {
            fontSize: designTokens.typography.sizes.lg,
            fontWeight: designTokens.typography.weights.semibold,
          },
        }}
      >
        <div>
          <div className={detailSectionStyles}>
            <div className={detailLabelStyles}>Title</div>
            <div className={detailValueStyles}>{action.title}</div>
          </div>

          <div className={detailSectionStyles}>
            <div className={detailLabelStyles}>URL</div>
            <div className={detailValueStyles}>{action.url}</div>
          </div>

          <div className={detailSectionStyles}>
            <div className={detailLabelStyles}>Method</div>
            <div className={detailValueStyles}>{action.method}</div>
          </div>

          {parsedHeaders && (
            <div className={detailSectionStyles}>
              <div className={detailLabelStyles}>Headers</div>
              <div className={detailValueStyles}>
                {JSON.stringify(parsedHeaders, null, 2)}
              </div>
            </div>
          )}

          {parsedBody && (
            <div className={detailSectionStyles}>
              <div className={detailLabelStyles}>Body</div>
              <div className={detailValueStyles} style={{ maxHeight: '300px' }}>
                {typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody, null, 2)}
              </div>
            </div>
          )}

          <div className={detailSectionStyles}>
            <div className={detailLabelStyles}>Raw Action JSON</div>
            <div className={detailValueStyles}>
              {parsedActionData ? JSON.stringify(parsedActionData, null, 2) : action.actionJson}
            </div>
          </div>
        </div>
      </Panel>
    );
  }, [action, isPanelOpen]);

  return (
    <>
      <div
        className={`${cardContainerStyles} ${action.isSelected ? cardSelectedStyles : ''}`}
        onClick={handleSelect}
        title={action.url}
      >
        {showSelectButton && (
          <Checkbox
            checked={action.isSelected}
            onChange={handleSelect}
            styles={{
              root: { marginRight: 0 },
            }}
          />
        )}

        <div className={iconContainerStyles}>
          <img
            src={action.icon}
            alt={action.title}
            style={{ width: '24px', height: '24px' }}
          />
        </div>

        <span className={titleStyles}>{action.title}</span>

        <span className={methodBadgeStyles(action.method)}>{action.method}</span>

        {showInfoButton && (
          <button
            className={actionButtonStyles}
            onClick={handleShowDetails}
            title="Show Details"
          >
            <Icon iconName="Info" />
          </button>
        )}

        {showFavoriteButton && onToggleFavorite && (
          <button
            className={`${actionButtonStyles} ${action.isFavorite ? favoriteActiveStyles : ''}`}
            onClick={handleToggleFavorite}
            title={action.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          >
            <Icon iconName={action.isFavorite ? 'FavoriteStarFill' : 'FavoriteStar'} />
          </button>
        )}

        {showDeleteButton && onDelete && (
          <button
            className={`${actionButtonStyles} ${deleteButtonStyles}`}
            onClick={handleDelete}
            title="Delete"
          >
            <Icon iconName="Delete" />
          </button>
        )}
      </div>
      {renderDetailsPanel()}
    </>
  );
};

export default ActionCard;
