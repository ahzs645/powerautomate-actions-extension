#!/usr/bin/env node
//
// Inventory the built-in operation icons in a saved Power Automate designer capture.
//
//   node scripts/extract-operation-icons.js <capture-dir> [-o icons.json]
//                                           [--sheet sheet.svg] [--dump-dir icons/]
//
// Why this exists
// ---------------
// Connector actions (Office 365, Excel, SharePoint) carry an `iconUri` in the
// flow's own `connectionReferences`, so the flow JSON is enough to draw them.
// Built-in operations - Initialize variable, Condition, Compose, Terminate - have
// no connection reference at all. Their icons live only inside the designer
// bundle, inlined as SVG data URIs on each operation's manifest:
//
//     properties: {
//       iconUri: "data:image/svg+xml;base64,...",
//       brandColor: "#484F58",
//       description: "Identifies which block of actions to execute based on ..."
//
// This script finds those manifests so src/constants/OperationIcons.ts can be
// refreshed or extended. See docs/operation-icons.md for the full procedure.
//
// A capture is a "Save page as" / site mirror of make.powerautomate.com. Source
// maps in such captures are usually 92-byte "Please wait a bit" stubs rather than
// real maps, so the minified bundles are scanned directly - no map needed.
//
// Known gap: a capture only contains the manifests the captured page actually
// loaded. Operation manifests are fetched on demand, so a capture taken on a flow
// with no Scope/Foreach/Until/Switch will not contain those four icons. Open a
// flow that uses them before capturing if you need to fill that gap.

const fs = require('fs');
const path = require('path');

// The manifest shape is stable across designer builds: an iconUri data URI,
// followed within the same properties object by brandColor and description.
const ICON_PATTERN = /iconUri:\s*"(data:image\/svg\+xml[^"]+)"/g;
const MANIFEST_TAIL = 2500; // chars after the iconUri that still describe it

function parseArgs(argv) {
  const args = { capture: null, out: 'operation-icons.json', sheet: null, dumpDir: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--out') args.out = argv[++i];
    else if (arg === '--sheet') args.sheet = argv[++i];
    else if (arg === '--dump-dir') args.dumpDir = argv[++i];
    else if (!args.capture) args.capture = arg;
  }
  return args;
}

function* walkJs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory in a mirrored capture
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJs(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) yield full;
  }
}

function extract(captureDir) {
  const seen = new Set();
  const icons = [];

  for (const file of walkJs(captureDir)) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // a >2GB chunk or a permission problem: skip rather than abort
    }

    ICON_PATTERN.lastIndex = 0;
    let match;
    while ((match = ICON_PATTERN.exec(source)) !== null) {
      const uri = match[1];
      // The same connector's manifest is often duplicated across chunks.
      if (seen.has(uri)) continue;
      seen.add(uri);

      // Measured from the end of the match, not its start: a data URI can run to
      // ~3KB on its own, so offsetting from match.index would land inside it.
      const tailStart = match.index + match[0].length;
      const tail = source.slice(tailStart, tailStart + MANIFEST_TAIL);
      icons.push({
        file: path.relative(captureDir, file),
        brandColor: firstMatch(tail, /brandColor:\s*"([^"]+)"/),
        description: firstMatch(tail, /description:\s*\n?\s*"([^"]{0,160})"/),
        provider: firstMatch(tail, /connectionProviders\/([a-zA-Z]+)/),
        summaries: allMatches(tail, /summary:\s*"([^"]{0,60})"/).slice(0, 4),
        bytes: uri.length,
        iconUri: uri,
      });
    }
  }
  return icons;
}

function firstMatch(text, pattern) {
  const m = text.match(pattern);
  return m ? m[1] : '';
}

function allMatches(text, pattern) {
  const out = [];
  const global = new RegExp(pattern.source, 'g');
  let m;
  while ((m = global.exec(text)) !== null) out.push(m[1]);
  return out;
}

function decode(uri) {
  const commaAt = uri.indexOf(',');
  const payload = uri.slice(commaAt + 1);
  return uri.slice(0, commaAt).includes(';base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
}

// A contact sheet is the quickest way to tell which glyph is which: the manifest
// descriptions are ambiguous ("Create CSV table" and "Filter array" share one icon).
function contactSheet(icons) {
  const cell = 190;
  const perRow = 4;
  const rowH = 130;
  const rows = Math.ceil(icons.length / perRow);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${cell * perRow}" height="${rows * rowH}" font-family="Segoe UI, sans-serif">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
  ];

  icons.forEach((icon, i) => {
    const x = (i % perRow) * cell;
    const y = Math.floor(i / perRow) * rowH;
    const label = (icon.summaries[0] || icon.description || '').slice(0, 26);

    parts.push(
      `<rect x="${x + 10}" y="${y + 10}" width="${cell - 20}" height="${rowH - 20}" ` +
        `fill="#faf9f8" stroke="#e1dfdd" rx="4"/>`,
      `<image x="${x + cell / 2 - 24}" y="${y + 22}" width="48" height="48" ` +
        `xlink:href="${escapeXml(icon.iconUri)}"/>`,
      `<text x="${x + cell / 2}" y="${y + 88}" text-anchor="middle" font-size="11" ` +
        `fill="#323130">#${i} ${escapeXml(icon.brandColor)}</text>`,
      `<text x="${x + cell / 2}" y="${y + 104}" text-anchor="middle" font-size="9" ` +
        `fill="#605e5c">${escapeXml(label)}</text>`
    );
  });

  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.capture) {
    console.error('usage: node scripts/extract-operation-icons.js <capture-dir> [-o icons.json]');
    console.error('                                               [--sheet sheet.svg] [--dump-dir icons/]');
    process.exit(1);
  }
  if (!fs.existsSync(args.capture)) {
    console.error(`capture directory not found: ${args.capture}`);
    process.exit(1);
  }

  const icons = extract(args.capture);

  if (icons.length === 0) {
    console.error('No operation manifests found.');
    console.error('The capture may not include the designer bundle, or the manifest shape changed.');
    process.exit(2);
  }

  console.log(`${icons.length} unique operation icons\n`);
  console.log('  #  brand      provider        summary / description');
  console.log('  -  ---------  --------------  ---------------------');
  icons.forEach((icon, i) => {
    const label = icon.summaries.join(' / ') || icon.description;
    console.log(
      `  ${String(i).padStart(2)} ${icon.brandColor.padEnd(9)} ` +
        `${icon.provider.padEnd(14)}  ${label.slice(0, 60)}`
    );
  });

  fs.writeFileSync(args.out, JSON.stringify(icons, null, 2));
  console.log(`\nwrote ${args.out}`);

  if (args.dumpDir) {
    fs.mkdirSync(args.dumpDir, { recursive: true });
    icons.forEach((icon, i) => {
      fs.writeFileSync(path.join(args.dumpDir, `icon-${i}.svg`), decode(icon.iconUri));
    });
    console.log(`wrote ${icons.length} SVGs to ${args.dumpDir}`);
  }

  if (args.sheet) {
    fs.writeFileSync(args.sheet, contactSheet(icons));
    console.log(`wrote ${args.sheet} - open it to identify each glyph`);
  }

  // Report the gap explicitly: a silent inventory reads as "everything is here".
  // These four are the ones OperationIcons.ts still falls back to initials for.
  const WANTED = {
    Scope: /\bscope\b/i,
    Foreach: /apply to each|for each|foreach/i,
    Until: /do until|\buntil\b/i,
    Switch: /\bswitch\b|switch case/i,
  };
  const haystack = icons
    .map(i => `${i.description} ${i.summaries.join(' ')} ${i.provider}`)
    .join(' | ');
  const absent = Object.keys(WANTED).filter(name => !WANTED[name].test(haystack));

  if (absent.length > 0) {
    console.log(`\nnot in this capture: ${absent.join(', ')}`);
    console.log(
      'Operation manifests load on demand, so a capture only contains what the\n' +
        'captured page actually used. To pick these up, open a flow that uses them\n' +
        'in the designer before saving the page, then re-run this script.'
    );
  } else {
    console.log('\nAll four previously-missing operations (Scope, Foreach, Until, Switch) are present.');
  }
  console.log('\nSee docs/operation-icons.md for how to fold these into OperationIcons.ts.');
}

main();
