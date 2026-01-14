// Design tokens for the Power Automate Actions extension
// Based on Microsoft Fluent Design System with modern refinements

export const designTokens = {
  // Colors - Microsoft Fluent color palette
  colors: {
    // Primary
    primary: '#0078d4',
    primaryDark: '#106ebe',
    primaryLight: '#deecf9',
    primaryHover: '#005a9e',

    // Semantic
    success: '#107c10',
    successLight: '#dff6dd',
    warning: '#ff8c00',
    warningLight: '#fff4ce',
    error: '#d13438',
    errorLight: '#fde7e9',
    info: '#0078d4',
    infoLight: '#deecf9',

    // Neutrals
    neutralDark: '#323130',
    neutralPrimary: '#605e5c',
    neutralSecondary: '#8a8886',
    neutralLight: '#edebe9',
    neutralLighter: '#f3f2f1',
    neutralLighterAlt: '#faf9f8',
    white: '#ffffff',
    black: '#000000',

    // Header
    headerBg: '#1a1f25',
    headerBgGradientStart: '#1e2329',
    headerBgGradientEnd: '#1a1f25',
    headerText: '#ffffff',
    headerTextMuted: 'rgba(255, 255, 255, 0.7)',
    headerBorder: 'rgba(255, 255, 255, 0.1)',
    headerIconHover: 'rgba(255, 255, 255, 0.1)',

    // Status colors for flow analysis
    complexityLow: '#107c10',
    complexityMedium: '#ff8c00',
    complexityHigh: '#d13438',

    // Action type colors
    trigger: '#569AE5',
    conditional: '#2596be',
    loop: '#00C1A0',
    scope: '#808080',
    variable: '#9925be',
    http: '#8764b8',
  },

  // Spacing - 4px base grid system
  spacing: {
    xxs: '2px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
    xxxl: '48px',
  },

  // Border radius
  radius: {
    xs: '2px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    round: '50%',
    pill: '9999px',
  },

  // Shadows
  shadows: {
    none: 'none',
    xs: '0 1px 2px rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px rgba(0, 0, 0, 0.08)',
    md: '0 2px 4px rgba(0, 0, 0, 0.1)',
    lg: '0 4px 8px rgba(0, 0, 0, 0.12)',
    xl: '0 8px 16px rgba(0, 0, 0, 0.14)',
    card: '0 2px 4px rgba(0, 0, 0, 0.08)',
    cardHover: '0 4px 8px rgba(0, 0, 0, 0.12)',
    elevated: '0 8px 16px rgba(0, 0, 0, 0.14)',
    dropdown: '0 2px 8px rgba(0, 0, 0, 0.15)',
  },

  // Typography
  typography: {
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', 'Helvetica Neue', sans-serif",
    fontFamilyMono: "'Consolas', 'Monaco', 'Courier New', monospace",
    sizes: {
      xxs: '10px',
      xs: '11px',
      sm: '12px',
      md: '14px',
      lg: '16px',
      xl: '20px',
      xxl: '24px',
      xxxl: '32px',
    },
    weights: {
      regular: 400 as const,
      medium: 500 as const,
      semibold: 600 as const,
      bold: 700 as const,
    },
    lineHeights: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  // Transitions
  transitions: {
    fast: '0.1s ease',
    normal: '0.15s ease',
    slow: '0.2s ease',
    smooth: '0.3s ease-in-out',
  },

  // Z-index layers
  zIndex: {
    base: 0,
    dropdown: 100,
    sticky: 200,
    fixed: 300,
    modal: 400,
    popover: 500,
    tooltip: 600,
  },

  // Breakpoints (for responsive design within popup)
  breakpoints: {
    sm: '400px',
    md: '500px',
    lg: '600px',
  },

  // Layout dimensions
  layout: {
    popupWidth: '600px',
    popupHeight: '570px',
    headerHeight: '80px', // 44px title + 36px actions
    headerTitleHeight: '44px',
    headerActionsHeight: '36px',
    tabBarHeight: '40px',
    iconButtonSize: '28px',
    actionCardHeight: '64px',
    sidebarWidth: '240px',
  },
};

// Helper function to get rating color
export function getRatingColor(rating: number): string {
  if (rating >= 70) return designTokens.colors.success;
  if (rating >= 40) return designTokens.colors.warning;
  return designTokens.colors.error;
}

// Helper function to get complexity color
export function getComplexityColor(complexity: number): string {
  if (complexity <= 50) return designTokens.colors.complexityLow;
  if (complexity <= 100) return designTokens.colors.complexityMedium;
  return designTokens.colors.complexityHigh;
}

// Helper function to get status color
export function getStatusColor(status: 'success' | 'warning' | 'error' | 'info'): string {
  return designTokens.colors[status];
}

// Helper function to get status light color
export function getStatusLightColor(status: 'success' | 'warning' | 'error' | 'info'): string {
  return designTokens.colors[`${status}Light` as keyof typeof designTokens.colors];
}

export default designTokens;
