// SearchBar - Unified search component for filtering actions
// Consistent search experience across all tabs

import React, { useCallback, useRef, useEffect } from 'react';
// Note: autoFocus prop is kept for API compatibility but not currently implemented
import { TextField, Icon, mergeStyles } from '@fluentui/react';
import { designTokens } from '../../styles/theme';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  debounceMs?: number;
  showClearButton?: boolean;
  compact?: boolean;
  onSearch?: (value: string) => void;
}

const containerStyles = mergeStyles({
  padding: `${designTokens.spacing.sm} ${designTokens.spacing.lg}`,
  backgroundColor: designTokens.colors.neutralLighter,
  borderBottom: `1px solid ${designTokens.colors.neutralLight}`,
});

const containerCompactStyles = mergeStyles({
  padding: `${designTokens.spacing.xs} ${designTokens.spacing.md}`,
});

const searchWrapperStyles = mergeStyles({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
});

const clearButtonStyles = mergeStyles({
  position: 'absolute',
  right: '8px',
  top: '50%',
  transform: 'translateY(-50%)',
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
    backgroundColor: designTokens.colors.neutralLight,
    color: designTokens.colors.neutralDark,
  },
});

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search actions...',
  autoFocus = false,
  debounceMs = 0,
  showClearButton = true,
  compact = false,
  onSearch,
}) => {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleChange = useCallback((_: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
    const searchValue = newValue || '';

    if (debounceMs > 0) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onChange(searchValue);
        onSearch?.(searchValue);
      }, debounceMs);
    } else {
      onChange(searchValue);
      onSearch?.(searchValue);
    }
  }, [onChange, onSearch, debounceMs]);

  const handleClear = useCallback(() => {
    onChange('');
    onSearch?.('');
  }, [onChange, onSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClear();
    } else if (e.key === 'Enter') {
      onSearch?.(value);
    }
  }, [handleClear, onSearch, value]);

  return (
    <div className={`${containerStyles} ${compact ? containerCompactStyles : ''}`}>
      <div className={searchWrapperStyles}>
        <TextField
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          iconProps={{ iconName: 'Search' }}
          styles={{
            root: {
              width: '100%',
            },
            fieldGroup: {
              borderRadius: designTokens.radius.sm,
              border: `1px solid ${designTokens.colors.neutralLight}`,
              backgroundColor: designTokens.colors.white,
              transition: `all ${designTokens.transitions.fast}`,
              ':hover': {
                borderColor: designTokens.colors.neutralSecondary,
              },
              ':focus-within': {
                borderColor: designTokens.colors.primary,
                boxShadow: `0 0 0 1px ${designTokens.colors.primary}`,
              },
            },
            field: {
              fontSize: compact ? designTokens.typography.sizes.sm : designTokens.typography.sizes.md,
              paddingRight: showClearButton && value ? '32px' : undefined,
            },
            icon: {
              color: designTokens.colors.neutralSecondary,
            },
          }}
        />
        {showClearButton && value && (
          <button
            className={clearButtonStyles}
            onClick={handleClear}
            title="Clear search"
            type="button"
          >
            <Icon iconName="Cancel" style={{ fontSize: '10px' }} />
          </button>
        )}
      </div>
    </div>
  );
};

// Inline variant for use within other components
export interface SearchBarInlineProps extends Omit<SearchBarProps, 'compact'> {
  width?: string | number;
}

export const SearchBarInline: React.FC<SearchBarInlineProps> = ({
  width = '100%',
  ...props
}) => {
  const inlineContainerStyles = mergeStyles({
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: typeof width === 'number' ? `${width}px` : width,
  });

  return (
    <div className={inlineContainerStyles}>
      <TextField
        placeholder={props.placeholder || 'Search...'}
        value={props.value}
        onChange={(_, newValue) => props.onChange(newValue || '')}
        iconProps={{ iconName: 'Search' }}
        styles={{
          root: {
            width: '100%',
          },
          fieldGroup: {
            borderRadius: designTokens.radius.sm,
            border: `1px solid ${designTokens.colors.neutralLight}`,
            backgroundColor: designTokens.colors.white,
            height: '32px',
          },
          field: {
            fontSize: designTokens.typography.sizes.sm,
          },
          icon: {
            color: designTokens.colors.neutralSecondary,
            fontSize: '12px',
          },
        }}
      />
    </div>
  );
};

export default SearchBar;
