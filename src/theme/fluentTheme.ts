// Imported from @fluentui/theme rather than @fluentui/react/lib/Theme: that
// subpath is ESM-only, which Jest will not transform inside node_modules.
import { createTheme, ITheme } from '@fluentui/theme';
import { loadTheme } from '@fluentui/style-utilities';
import { ThemeMode } from '../models/ISettingsModel';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Fluent paints its own colours through mergeStyles, so CSS variables alone can
 * never reach inside components like Text, ChoiceGroup or DetailsList. These
 * palettes mirror the values in theme/tokens.css so both systems agree.
 */
export const lightTheme: ITheme = createTheme({
  palette: {
    themePrimary: '#0f6cbd',
    themeLighterAlt: '#f4f9fd',
    themeLighter: '#d5e7f7',
    themeLight: '#b3d3f0',
    themeTertiary: '#6ea8e1',
    themeSecondary: '#2681c9',
    themeDarkAlt: '#0e61aa',
    themeDark: '#0b528f',
    themeDarker: '#083c6a',
    neutralLighterAlt: '#faf9f8',
    neutralLighter: '#f3f2f1',
    neutralLight: '#edebe9',
    neutralQuaternaryAlt: '#e1dfdd',
    neutralQuaternary: '#d0d0d0',
    neutralTertiaryAlt: '#c8c6c4',
    neutralTertiary: '#9e9e9e',
    neutralSecondary: '#616161',
    neutralPrimaryAlt: '#2b2b2f',
    neutralPrimary: '#1b1b1f',
    neutralDark: '#151518',
    black: '#000000',
    white: '#ffffff',
  },
});

export const darkTheme: ITheme = createTheme({
  palette: {
    themePrimary: '#479ef5',
    themeLighterAlt: '#03060a',
    themeLighter: '#0b1927',
    themeLight: '#152f49',
    themeTertiary: '#2b5e93',
    themeSecondary: '#3e8ad8',
    themeDarkAlt: '#59a8f6',
    themeDark: '#71b6f7',
    themeDarker: '#96c9f9',
    // Neutral scale runs light-on-dark, so "lighter" values are darker surfaces
    neutralLighterAlt: '#222226',
    neutralLighter: '#26262b',
    neutralLight: '#2f2f35',
    neutralQuaternaryAlt: '#38383f',
    neutralQuaternary: '#404048',
    neutralTertiaryAlt: '#5a5a63',
    neutralTertiary: '#7a7a82',
    neutralSecondary: '#b0b0b8',
    neutralPrimaryAlt: '#dcdce2',
    neutralPrimary: '#e8e8ed',
    neutralDark: '#f4f4f7',
    black: '#ffffff',
    white: '#1b1b1f',
  },
  semanticColors: {
    bodyBackground: '#1b1b1f',
    bodyText: '#e8e8ed',
    bodySubtext: '#b0b0b8',
    inputBackground: '#333338',
    inputBorder: '#404048',
    inputText: '#e8e8ed',
    inputPlaceholderText: '#9a9aa2',
    menuBackground: '#2b2b2f',
    listBackground: '#1b1b1f',
    listItemBackgroundHovered: '#2f2f35',
    listItemBackgroundChecked: '#38383f',
    listHeaderBackgroundHovered: '#2f2f35',
    errorText: '#f1707b',
    successText: '#6ccb6c',
    warningText: '#ffc83d',
  },
  isInverted: true,
});

/** Turn the stored preference into the theme actually shown right now. */
export function resolveTheme(mode: ThemeMode | undefined): ResolvedTheme {
  if (mode === 'dark' || mode === 'light') {
    return mode;
  }
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function getFluentTheme(resolved: ResolvedTheme): ITheme {
  return resolved === 'dark' ? darkTheme : lightTheme;
}

/**
 * ThemeProvider only reaches the React tree. Dialogs, panels and dropdown
 * callouts render through a Layer portal, so the theme also has to be loaded
 * globally or those surfaces stay light.
 */
export function loadFluentTheme(resolved: ResolvedTheme) {
  loadTheme(getFluentTheme(resolved));
}

/**
 * Mirror the preference onto the document so the CSS-variable side of the design
 * system switches in step with the Fluent side.
 */
export function applyThemeAttribute(mode: ThemeMode | undefined) {
  if (typeof document === 'undefined') {
    return;
  }
  if (!mode || mode === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
}
