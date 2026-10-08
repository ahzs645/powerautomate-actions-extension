import fs from 'fs';
import path from 'path';
import { POPUP_ICON_NAMES, registerPopupIcons } from '../../theme/popupIcons';
import { getIcon } from '@fluentui/style-utilities';

const SOURCE_FILES = [
  'App.tsx',
  ...fs.readdirSync(path.join(__dirname, '../../components'))
    .filter(name => name.endsWith('.tsx'))
    .map(name => `components/${name}`),
];

/** String literals passed as icon names: iconName="X", iconName: 'X', iconName={cond ? 'X' : 'Y'}. */
function iconNamesUsedIn(source: string): string[] {
  const names = new Set<string>();
  const lineRe = /iconName[^\n]*/g;
  let line: RegExpExecArray | null;
  while ((line = lineRe.exec(source)) !== null) {
    const literalRe = /['"]([A-Z][A-Za-z0-9]+)['"]/g;
    let literal: RegExpExecArray | null;
    while ((literal = literalRe.exec(line[0])) !== null) {
      names.add(literal[1]);
    }
  }
  return Array.from(names);
}

describe('popup icon registration', () => {
  beforeAll(() => registerPopupIcons());

  test('registers every icon name the popup source uses', () => {
    const used = new Set<string>();
    for (const file of SOURCE_FILES) {
      const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
      iconNamesUsedIn(source).forEach(name => used.add(name));
    }
    // Empty-state icons are passed as plain props.
    ['Record2', 'Copy', 'FavoriteStar', 'Library', 'SearchIssue'].forEach(name => used.add(name));

    const missing = Array.from(used).filter(name => !getIcon(name));
    expect(missing).toEqual([]);
  });

  test('registers the icons Fluent components render internally', () => {
    for (const name of ['CheckMark', 'ChevronDown', 'Cancel', 'Clear', 'More', 'Completed', 'ErrorBadge', 'Blocked2', 'RedEye', 'Hide']) {
      expect(getIcon(name)).toBeTruthy();
    }
  });

  test('keeps the registry small', () => {
    expect(POPUP_ICON_NAMES.length).toBeLessThan(80);
  });
});
