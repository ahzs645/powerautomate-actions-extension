// Flow diagram layout + SVG rendering.
//
// Draws a flow the way the Power Automate designer does: a top-down stack of
// compact cards with a brand-coloured accent bar, connector icon and wrapped
// name; scopes and conditions rendered as a dark header over a framed container
// with True/False branch pills; runAfter statuses shown as coloured dots above
// the card, with non-default paths drawn as dashed connectors.
//
// The previous renderer laid every action out on a single BFS grid, which
// dropped nested actions entirely (they have no runAfter, so no edge was ever
// emitted) and let edges point upwards when a node shared a row with its parent.

import { FlowAction, FlowTrigger } from '../../services/FlowAnalyzer';
import { getOperationIcon } from '../../constants/OperationIcons';

// ---------------------------------------------------------------------------
// Visual constants - proportions follow the designer's card canvas
// ---------------------------------------------------------------------------

const CARD_W = 204;
const CARD_BASE_H = 36;
const CARD_LINE_H = 16;
const CARD_MAX_LINES = 3;
const ACCENT_W = 4;
const ICON = 20;
const ICON_X = 14;
const TEXT_X = 42;
const TEXT_RIGHT_PAD = 12;
const TITLE_SIZE = 12;

const V_GAP = 54; // vertical connector run, sized for the insert affordance
const H_GAP = 44;

const HEADER_OVERLAP = 0.65; // how far the container tucks under its header
const CONT_PAD_X = 18;
const CONT_PAD_TOP = 46; // room for the branch pills
const CONT_PAD_TOP_PLAIN = 34; // single-body scopes: just clear the header overlap
const CONT_PAD_BOTTOM = 18;
const BRANCH_GAP = 24;
const BRANCH_PAD_X = 16;
// Deep enough that the branch pill, the insert marker and the first card in the
// branch all stack without overlapping.
const BRANCH_PAD_TOP = 44;
const BRANCH_PAD_BOTTOM = 18;
const MAX_BRANCH_ROW_W = 900; // wrap wide Switches instead of running off the canvas
const BRANCH_ROW_GAP = 20;
const COLLAPSED_BODY_H = 44;
const EMPTY_BRANCH_W = 200;
const EMPTY_BRANCH_H = 34;

const PLUS_R = 8;
const DOT_R = 3;
const DOT_GAP = 7;
const DOT_GROUP_GAP = 6;
const DOT_OFFSET = 12; // above the card top

const CANVAS_PAD = 36;

export type DiagramTheme = 'light' | 'dark';

/**
 * Concrete hex values rather than CSS variables: the diagram is also exported as a
 * standalone .svg file, where `var(--token)` would have nothing to resolve against.
 */
const LIGHT_COLORS = {
  canvas: '#ffffff',
  grid: '#e1dfdd',
  card: '#ffffff',
  cardBorder: '#c8c6c4',
  title: '#323130',
  edge: '#8a8886',
  containerHeader: '#3b3a39',
  containerHeaderText: '#ffffff',
  containerFill: '#faf9f8',
  containerBorder: '#c8c6c4',
  branchFill: '#ffffff',
  branchBorder: '#c8c6c4',
  emptyText: '#a19f9d',
  plus: '#0078d4',
  pillTrue: '#107c10',
  pillFalse: '#a4262c',
  pillNeutral: '#605e5c',
};

const DARK_COLORS: typeof LIGHT_COLORS = {
  canvas: '#1b1b1f',
  grid: '#3a3a42',
  card: '#2b2b2f',
  cardBorder: '#4a4a52',
  title: '#e8e8ed',
  edge: '#8a8a94',
  containerHeader: '#3a3a42',
  containerHeaderText: '#ffffff',
  containerFill: '#242428',
  containerBorder: '#4a4a52',
  branchFill: '#2b2b2f',
  branchBorder: '#4a4a52',
  emptyText: '#7a7a82',
  plus: '#479ef5',
  pillTrue: '#2f8f2f',
  pillFalse: '#c25055',
  pillNeutral: '#6a6a72',
};

// Swapped per render rather than threaded through 25 call sites. Rendering is
// synchronous, so the active palette cannot change mid-render.
let COLORS = LIGHT_COLORS;

const STATUS_COLORS: Record<string, string> = {
  Succeeded: '#107c10',
  Failed: '#a4262c',
  TimedOut: '#f7630c',
  Skipped: '#a19f9d',
};

/**
 * Accent colours for the few operation types with no entry in the icon table.
 * Values come from the designer's own `brandColors` constant map, not from eyeballing.
 */
const TYPE_COLORS: Record<string, string> = {
  Expression: '#8C6CFF', // DATA
  Filter: '#8C6CFF', // DATA
};

const DEFAULT_ACCENT = '#486991';

const TRIGGER_NAME = '__trigger__';

const CONTAINER_TYPES = new Set(['If', 'Switch', 'Scope', 'Foreach', 'Until', 'Do_until']);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Approximate advance width for Segoe UI. Good enough to wrap without a DOM. */
function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('iljtI.,:;\'!|[]()'.indexOf(ch) >= 0) em += 0.31;
    else if ('mMWw@'.indexOf(ch) >= 0) em += 0.89;
    else if (ch >= 'A' && ch <= 'Z') em += 0.64;
    else if (ch === ' ') em += 0.28;
    else em += 0.54;
  }
  return em * fontSize;
}

function ellipsize(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && textWidth(out + '…', fontSize) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.replace(/\s+$/, '') + '…';
}

/** Greedy wrap into at most `maxLines`, ellipsizing the last line if text remains. */
function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? current + ' ' + word : word;

    if (textWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (lines.length === maxLines) {
      // Out of room - fold everything that is left into the final line.
      const rest = words.slice(i).join(' ');
      lines[maxLines - 1] = lines[maxLines - 1] + ' ' + rest;
      break;
    }
    current = word;
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) lines.push(text);

  // A single word longer than the card never gets split above, so clamp here.
  return lines.map(line => ellipsize(line, maxWidth, fontSize));
}

/** Power Automate stores action names with underscores; the designer shows spaces. */
function displayName(name: string): string {
  return name.replace(/_/g, ' ').trim();
}

function escapeXml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagramNode {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  tooltip: string;
  accent: string;
  iconUri: string;
  shortLabel: string;
  /** Container actions (If/Scope/...) render as a dark header bar. */
  isHeader: boolean;
  /** True when this container's body is hidden. */
  collapsed: boolean;
  isTrigger: boolean;
  /** Status dots above the card, one group per runAfter parent. */
  dotGroups: string[][];
}

export interface DiagramEdge {
  path: string;
  dashed: boolean;
  tooltip: string;
}

export interface DiagramFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'container' | 'branch';
  /** Replaces the body of a collapsed container, e.g. "3 Actions". */
  summary?: string;
  /** Wrapped row index; only the first row gets a fan-out connector. */
  row?: number;
  label: string;
  pillColor: string;
  emptyText: string;
  /** Action name of the container card this frame belongs to. */
  ownerKey: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  frames: DiagramFrame[];
  /** Designer-style insert affordances, one directly above each connected card. */
  plusPoints: Array<{ x: number; y: number }>;
  /** Single-body scopes with nothing inside; rendered as a "0 Actions" hint. */
  emptyBodies: Array<{ x: number; y: number; w: number; h: number }>;
  width: number;
  height: number;
}

interface Box {
  action: FlowAction;
  x: number;
  y: number;
  w: number;
  h: number;
  cardH: number;
  lines: string[];
  branches: Branch[];
  container: { x: number; y: number; w: number; h: number } | null;
  /** Set when the container is collapsed; shown in place of its body. */
  summary: string;
}

interface Branch {
  label: string;
  pillColor: string;
  /** If/Switch draw a frame per branch; a plain Scope body uses the container itself. */
  framed: boolean;
  /** Which wrapped row this branch sits in. */
  row: number;
  graph: Graph;
  x: number;
  y: number;
  w: number;
  h: number;
  isEmpty: boolean;
}

interface Graph {
  boxes: Box[];
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function cardLines(name: string): string[] {
  return wrapText(displayName(name), CARD_W - TEXT_X - TEXT_RIGHT_PAD, TITLE_SIZE, CARD_MAX_LINES);
}

function cardHeight(lines: string[]): number {
  return CARD_BASE_H + (lines.length - 1) * CARD_LINE_H;
}

export interface LayoutOptions {
  /** Names of container actions whose bodies should be hidden. */
  collapsed?: Set<string>;
}

export function buildDiagram(
  actions: FlowAction[],
  trigger: FlowTrigger | null,
  layout: LayoutOptions = {}
): Diagram {
  const collapsed = layout.collapsed || new Set<string>();

  const byParent = new Map<string, FlowAction[]>();
  for (const action of actions) {
    const key = action.parent || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(action);
  }

  function makeBranch(
    label: string, pillColor: string, members: FlowAction[], framed = true
  ): Branch {
    const graph = layoutGraph(members);
    return {
      label,
      pillColor,
      framed,
      row: 0,
      graph,
      x: 0,
      y: 0,
      w: graph.w,
      h: graph.h,
      isEmpty: members.length === 0,
    };
  }

  function branchesOf(action: FlowAction): Branch[] {
    const direct = byParent.get(action.Name) || [];

    if (action.Type === 'If') {
      return [
        makeBranch('True', COLORS.pillTrue, direct.filter(a => a.branch !== 'else')),
        makeBranch('False', COLORS.pillFalse, direct.filter(a => a.branch === 'else')),
      ];
    }

    if (action.Type === 'Switch') {
      // Switch cases are parented as "Switch_name/case_name".
      const prefix = action.Name + '/';
      const cases: Branch[] = [];
      Array.from(byParent.keys()).forEach(parent => {
        if (parent.indexOf(prefix) === 0) {
          const caseName = parent.slice(prefix.length);
          cases.push(
            makeBranch(
              caseName === 'default' ? 'Default' : displayName(caseName),
              COLORS.pillNeutral,
              byParent.get(parent)!
            )
          );
        }
      });
      if (direct.length > 0) cases.unshift(makeBranch('', COLORS.pillNeutral, direct));
      return cases.length > 0 ? cases : [makeBranch('Default', COLORS.pillNeutral, [])];
    }

    // Scope / Foreach / Until have a single body, so the container frame *is* the
    // body. Drawing a second frame inside it just nests two boxes for no reason.
    return [makeBranch('', COLORS.pillNeutral, direct, false)];
  }

  function hasCases(action: FlowAction): boolean {
    const prefix = action.Name + '/';
    return Array.from(byParent.keys()).some(parent => parent.indexOf(prefix) === 0);
  }

  /** Every action nested anywhere beneath this one. */
  function descendantsOf(name: string): FlowAction[] {
    const out: FlowAction[] = [];
    const queue = [name];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const prefix = current + '/';
      byParent.forEach((members, parent) => {
        if (parent !== current && parent.indexOf(prefix) !== 0) return;
        for (const member of members) {
          out.push(member);
          queue.push(member.Name);
        }
      });
    }
    return out;
  }

  function summaryFor(action: FlowAction): string {
    if (action.Type === 'Switch') {
      const prefix = action.Name + '/';
      const cases = Array.from(byParent.keys()).filter(p => p.indexOf(prefix) === 0).length;
      return `${cases} ${cases === 1 ? 'Case' : 'Cases'}`;
    }
    const count = descendantsOf(action.Name).length;
    return `${count} ${count === 1 ? 'Action' : 'Actions'}`;
  }

  function buildBox(action: FlowAction): Box {
    const lines = cardLines(action.Name);
    const cardH = cardHeight(lines);
    const isContainer =
      CONTAINER_TYPES.has(action.Type) && (byParent.has(action.Name) || hasCases(action));

    if (!isContainer) {
      return {
        action, x: 0, y: 0, w: CARD_W, h: cardH,
        cardH, lines, branches: [], container: null, summary: '',
      };
    }

    // Collapsed: keep the header and swap the body for a count, as the designer does.
    if (collapsed.has(action.Name)) {
      const containerY = cardH * HEADER_OVERLAP;
      return {
        action,
        x: 0, y: 0, w: CARD_W, h: containerY + COLLAPSED_BODY_H,
        cardH, lines, branches: [],
        container: { x: 0, y: containerY, w: CARD_W, h: COLLAPSED_BODY_H },
        summary: summaryFor(action),
      };
    }

    const branches = branchesOf(action);

    // Size each branch around its contents. Unframed bodies carry no padding of
    // their own - the container's padding does that job.
    for (const branch of branches) {
      const padX = branch.framed ? BRANCH_PAD_X * 2 : 0;
      const padY = branch.framed ? BRANCH_PAD_TOP + BRANCH_PAD_BOTTOM : 0;
      branch.w = Math.max(branch.graph.w, EMPTY_BRANCH_W) + padX;
      branch.h = Math.max(branch.graph.h, EMPTY_BRANCH_H) + padY;
    }

    // Pack branches into rows so a Switch with many cases wraps rather than
    // stretching the canvas indefinitely.
    const rows: Branch[][] = [];
    let row: Branch[] = [];
    let rowW = 0;
    for (const branch of branches) {
      const added = branch.w + (row.length > 0 ? BRANCH_GAP : 0);
      if (row.length > 0 && rowW + added > MAX_BRANCH_ROW_W) {
        rows.push(row);
        row = [];
        rowW = 0;
      }
      row.push(branch);
      rowW += branch.w + (row.length > 1 ? BRANCH_GAP : 0);
    }
    if (row.length > 0) rows.push(row);

    const rowWidths = rows.map(
      r => r.reduce((sum, b) => sum + b.w, 0) + BRANCH_GAP * (r.length - 1)
    );
    const rowHeights = rows.map(r => Math.max.apply(null, r.map(b => b.h)));

    const branchesW = Math.max.apply(null, rowWidths);
    const branchesH =
      rowHeights.reduce((a, b) => a + b, 0) + BRANCH_ROW_GAP * (rows.length - 1);

    // Without pills to clear, the body only has to start below the overlapping header.
    const padTop = branches.some(b => b.framed) ? CONT_PAD_TOP : CONT_PAD_TOP_PLAIN;
    const containerW = branchesW + CONT_PAD_X * 2;
    const containerH = branchesH + padTop + CONT_PAD_BOTTOM;
    const containerY = cardH * HEADER_OVERLAP;

    const w = Math.max(CARD_W, containerW);
    const h = containerY + containerH;
    const containerX = (w - containerW) / 2;

    let cursorY = containerY + padTop;
    rows.forEach((r, i) => {
      // Centre each row within the container.
      let cursorX = containerX + CONT_PAD_X + (branchesW - rowWidths[i]) / 2;
      for (const branch of r) {
        branch.row = i;
        branch.x = cursorX;
        branch.y = cursorY;
        branch.h = rowHeights[i]; // equalise so the frames form a clean row
        cursorX += branch.w + BRANCH_GAP;
      }
      cursorY += rowHeights[i] + BRANCH_ROW_GAP;
    });

    return {
      action, x: 0, y: 0, w, h, cardH, lines, branches, summary: '',
      container: { x: containerX, y: containerY, w: containerW, h: containerH },
    };
  }

  /** Lay out one set of sibling actions into layers ranked by longest path. */
  function layoutGraph(members: FlowAction[]): Graph {
    if (members.length === 0) return { boxes: [], w: 0, h: 0 };

    const memberNames = new Set(members.map(m => m.Name));
    const boxes = members.map(buildBox);
    const boxByName = new Map(boxes.map(b => [b.action.Name, b] as [string, Box]));

    // Longest-path ranking guarantees every edge points downwards.
    const ranks = new Map<string, number>();
    const visiting = new Set<string>();

    function rankOf(name: string): number {
      const cached = ranks.get(name);
      if (cached !== undefined) return cached;
      if (visiting.has(name)) return 0; // defensive: cyclic runAfter
      visiting.add(name);

      const box = boxByName.get(name);
      const parents = box
        ? Object.keys(box.action.runAfterDetail || {}).filter(p => memberNames.has(p))
        : [];
      const rank = parents.length === 0 ? 0 : Math.max.apply(null, parents.map(rankOf)) + 1;

      visiting.delete(name);
      ranks.set(name, rank);
      return rank;
    }

    for (const box of boxes) rankOf(box.action.Name);

    const layers: Box[][] = [];
    for (const box of boxes) {
      const rank = ranks.get(box.action.Name)!;
      if (!layers[rank]) layers[rank] = [];
      layers[rank].push(box);
    }

    const filled = layers.filter(Boolean);
    const layerWidths: number[] = [];
    let y = 0;
    let width = 0;

    filled.forEach((layer, i) => {
      const layerW = layer.reduce((sum, b) => sum + b.w, 0) + H_GAP * (layer.length - 1);
      layerWidths[i] = layerW;
      width = Math.max(width, layerW);

      let x = 0;
      for (const box of layer) {
        box.x = x;
        box.y = y;
        x += box.w + H_GAP;
      }
      y += Math.max.apply(null, layer.map(b => b.h)) + V_GAP;
    });

    // Centre each layer now that the graph's full width is known.
    filled.forEach((layer, i) => {
      const shift = (width - layerWidths[i]) / 2;
      for (const box of layer) box.x += shift;
    });

    return { boxes, w: width, h: Math.max(0, y - V_GAP) };
  }

  // --- Assemble the root graph, with the trigger as its own top layer ---------

  const rootGraph = layoutGraph(byParent.get('') || []);

  const triggerLines = trigger ? cardLines(trigger.name || 'Trigger') : [];
  const triggerH = trigger ? cardHeight(triggerLines) : 0;

  const width = Math.max(rootGraph.w, CARD_W);
  const triggerX = CANVAS_PAD + (width - CARD_W) / 2;
  const rootX = CANVAS_PAD + (width - rootGraph.w) / 2;
  const rootY = CANVAS_PAD + (trigger ? triggerH + V_GAP : 0);

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const frames: DiagramFrame[] = [];

  if (trigger) {
    nodes.push({
      key: TRIGGER_NAME,
      x: triggerX,
      y: CANVAS_PAD,
      w: CARD_W,
      h: triggerH,
      lines: triggerLines,
      tooltip: `${displayName(trigger.name || 'Trigger')}\n${trigger.connector || trigger.type || ''}`,
      accent: trigger.brandColor || COLORS.plus,
      iconUri: trigger.imgURL || getOperationIcon(trigger.type)?.iconUri || '',
      shortLabel: initials(trigger.connector || trigger.name || 'T'),
      isHeader: false,
      collapsed: false,
      isTrigger: true,
      dotGroups: [],
    });
  }

  const cards = new Map<string, Rect>();
  /** Full footprint including any container body - used for exits and obstacles. */
  const extents = new Map<string, Rect>();
  const bodyLinks: Array<{ owner: string; child: string }> = [];
  const emptyBodies: Rect[] = [];

  /** Boxes in a graph with no parent inside that same graph. */
  function rootBoxesOf(graph: Graph): Box[] {
    const names = new Set(graph.boxes.map(b => b.action.Name));
    return graph.boxes.filter(
      b => !Object.keys(b.action.runAfterDetail || {}).some(p => names.has(p))
    );
  }

  function emit(graph: Graph, offsetX: number, offsetY: number): void {
    for (const box of graph.boxes) {
      const x = offsetX + box.x;
      const y = offsetY + box.y;
      const cardX = x + (box.w - CARD_W) / 2;

      cards.set(box.action.Name, { x: cardX, y, w: CARD_W, h: box.cardH });
      extents.set(box.action.Name, { x, y, w: box.w, h: box.h });

      if (box.container) {
        frames.push({
          x: x + box.container.x,
          y: y + box.container.y,
          w: box.container.w,
          h: box.container.h,
          kind: 'container',
          label: '',
          pillColor: '',
          emptyText: '',
          summary: box.summary,
          ownerKey: box.action.Name,
        });
      }

      for (const branch of box.branches) {
        const bx = x + branch.x;
        const by = y + branch.y;

        if (branch.framed) {
          frames.push({
            x: bx,
            y: by,
            w: branch.w,
            h: branch.h,
            kind: 'branch',
            label: branch.label,
            pillColor: branch.pillColor,
            emptyText: branch.isEmpty ? '0 Actions' : '',
            row: branch.row,
            ownerKey: box.action.Name,
          });
        } else if (branch.isEmpty) {
          emptyBodies.push({ x: bx, y: by, w: branch.w, h: branch.h });
        }

        const innerX = bx + (branch.w - branch.graph.w) / 2;
        const innerY = by + (branch.framed ? BRANCH_PAD_TOP : 0);
        emit(branch.graph, innerX, innerY);

        // An unframed body has no frame to fan into, so the header links straight
        // to the first action inside it.
        if (!branch.framed) {
          for (const root of rootBoxesOf(branch.graph)) {
            bodyLinks.push({ owner: box.action.Name, child: root.action.Name });
          }
        }
      }

      // Push the card last so it paints over its own container header edge.
      nodes.push(
        toNode(
          box.action, cardX, y, box.lines, box.cardH,
          box.container !== null,
          collapsed.has(box.action.Name)
        )
      );
    }
  }

  emit(rootGraph, rootX, rootY);

  // --- Edges -----------------------------------------------------------------

  const triggerRect = { x: triggerX, y: CANVAS_PAD, w: CARD_W, h: triggerH };

  // Obstacles are full footprints, so a connector routes around a whole scope
  // rather than slicing through its body.
  const obstacles: Array<{ name: string; rect: Rect }> = [];
  extents.forEach((rect, name) => obstacles.push({ name, rect }));
  if (trigger) obstacles.push({ name: TRIGGER_NAME, rect: triggerRect });

  /** Connectors leave from the bottom of the whole box, but arrive at the card. */
  const exitOf = (name: string): Rect => extents.get(name) || cards.get(name)!;

  // A container encloses its own children, so it must never block their internal
  // connectors - only unrelated boxes count as obstacles.
  const parentOf = new Map<string, string>();
  for (const action of actions) {
    if (action.parent) parentOf.set(action.Name, action.parent.split('/')[0]);
  }

  function ancestorsOf(name: string): string[] {
    const chain: string[] = [];
    let current = parentOf.get(name);
    while (current && chain.indexOf(current) < 0) {
      chain.push(current);
      current = parentOf.get(current);
    }
    return chain;
  }

  const skipFor = (from: string, to: string): Set<string> =>
    new Set([from, to, ...ancestorsOf(from), ...ancestorsOf(to)]);

  for (const action of actions) {
    const to = cards.get(action.Name);
    if (!to) continue;

    const runAfter = action.runAfterDetail || {};
    const parents = Object.keys(runAfter).filter(p => cards.has(p));

    if (parents.length === 0) {
      // First action of its scope. Only root-level actions hang off the trigger;
      // nested ones are reached from their own container.
      if (!action.parent && trigger) {
        edges.push(
          makeEdge(
            triggerRect, to, ['Succeeded'], obstacles,
            skipFor(TRIGGER_NAME, action.Name)
          )
        );
      }
      continue;
    }

    for (const parentName of parents) {
      edges.push(
        makeEdge(
          exitOf(parentName), to, runAfter[parentName], obstacles,
          skipFor(parentName, action.Name)
        )
      );
    }
  }

  // Connect each container header down to its branch frames. Wrapped rows below
  // the first are identified by their pill; fanning to them would drag lines
  // across the row above.
  for (const frame of frames) {
    if (frame.kind !== 'branch' || (frame.row || 0) > 0) continue;
    const owner = cards.get(frame.ownerKey);
    if (owner) edges.push(fanEdge(owner, frame));
  }

  // ...and, for single-body scopes, straight to the first action inside.
  for (const link of bodyLinks) {
    const owner = cards.get(link.owner);
    const child = cards.get(link.child);
    if (owner && child) {
      edges.push(fanEdge(owner, { x: child.x, y: child.y, w: child.w, h: child.h } as DiagramFrame));
    }
  }

  // The designer puts an insert affordance directly above every action card.
  // One per card, so a multi-parent join does not stack them on the same spot.
  // Cards that show status dots need the marker lifted clear of them.
  const dotted = new Set(nodes.filter(n => n.dotGroups.length > 0).map(n => n.key));
  const plusPoints = nodes
    .filter(node => !node.isTrigger)
    .map(node => ({
      x: node.x + node.w / 2,
      y: node.y - PLUS_R - (dotted.has(node.key) ? DOT_OFFSET + 6 : 8),
    }));

  const maxNodeY = nodes.length > 0 ? Math.max.apply(null, nodes.map(n => n.y + n.h)) : CANVAS_PAD;
  const maxFrameY = frames.length > 0 ? Math.max.apply(null, frames.map(f => f.y + f.h)) : 0;
  const maxNodeX = nodes.length > 0 ? Math.max.apply(null, nodes.map(n => n.x + n.w)) : 0;
  const maxFrameX = frames.length > 0 ? Math.max.apply(null, frames.map(f => f.x + f.w)) : 0;
  return {
    nodes,
    edges,
    frames,
    plusPoints,
    emptyBodies,
    width: Math.max(maxNodeX, maxFrameX) + CANVAS_PAD,
    height: Math.max(maxNodeY, maxFrameY) + CANVAS_PAD,
  };

  // --- helpers ---------------------------------------------------------------

  function toNode(
    action: FlowAction,
    x: number, y: number,
    lines: string[], h: number,
    isHeader: boolean,
    isCollapsed: boolean
  ): DiagramNode {
    const statuses = action.runAfterDetail || {};
    const groups = Object.keys(statuses)
      .map(parent => statuses[parent])
      .filter(list => !(list.length === 1 && list[0] === 'Succeeded'));

    // A connector action carries its own branding in connectionReferences; a
    // built-in operation gets the designer's icon and colour instead.
    const builtIn = getOperationIcon(action.Type);

    return {
      key: action.Name,
      x, y, w: CARD_W, h,
      lines,
      tooltip: tooltipFor(action),
      accent:
        action.brandColor || builtIn?.brandColor || TYPE_COLORS[action.Type] || DEFAULT_ACCENT,
      iconUri: action.imgURL || builtIn?.iconUri || '',
      shortLabel: initials(
        action.connector && action.connector !== action.Type
          ? action.connector.replace(/^shared_/, '')
          : action.Type
      ),
      isHeader,
      collapsed: isCollapsed,
      isTrigger: false,
      dotGroups: groups,
    };
  }
}

function tooltipFor(action: FlowAction): string {
  const parts = [displayName(action.Name), action.Type];
  if (action.connector && action.connector !== action.Type) {
    parts.push(action.connector.replace(/^shared_/, ''));
  }

  const runAfter = action.runAfterDetail || {};
  const names = Object.keys(runAfter);
  if (names.length > 0) {
    parts.push(
      'Runs after: ' +
        names.map(n => `${displayName(n)} (${runAfter[n].join(', ')})`).join('; ')
    );
  }
  return parts.join('\n');
}

function initials(text: string): string {
  const cleaned = text.replace(/^shared_/, '').replace(/[^A-Za-z0-9]/g, ' ').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+|(?=[A-Z])/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : cleaned.slice(0, 2)).toUpperCase();
}

/** The designer draws anything other than a plain "after success" as a dashed link. */
function isDefaultPath(statuses: string[]): boolean {
  return (statuses || []).length === 1 && statuses[0] === 'Succeeded';
}

// ---------------------------------------------------------------------------
// Connector routing
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number };
type Point = [number, number];

const CHANNEL_MARGIN = 30;
const STUB = 22;

function roundedPolyline(points: Point[], radius = 8): string {
  if (points.length < 2) return '';
  const parts = [`M ${round(points[0][0])} ${round(points[0][1])}`];

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];

    const inLen = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
    const outLen = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
    const r = Math.min(radius, inLen / 2, outLen / 2);

    if (r < 0.5 || inLen === 0 || outLen === 0) {
      parts.push(`L ${round(cx)} ${round(cy)}`);
      continue;
    }

    parts.push(`L ${round(cx - ((cx - px) / inLen) * r)} ${round(cy - ((cy - py) / inLen) * r)}`);
    parts.push(
      `Q ${round(cx)} ${round(cy)} ` +
        `${round(cx + ((nx - cx) / outLen) * r)} ${round(cy + ((ny - cy) / outLen) * r)}`
    );
  }

  const last = points[points.length - 1];
  parts.push(`L ${round(last[0])} ${round(last[1])}`);
  return parts.join(' ');
}

function segmentHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect, pad = 6): boolean {
  return (
    Math.max(ax, bx) > r.x - pad &&
    Math.min(ax, bx) < r.x + r.w + pad &&
    Math.max(ay, by) > r.y - pad &&
    Math.min(ay, by) < r.y + r.h + pad
  );
}

function pathIsClear(points: Point[], obstacles: Rect[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    for (const rect of obstacles) {
      if (segmentHitsRect(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], rect)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Route from the bottom of `from` to the top of `to`, preferring the direct
 * down-across-down path and detouring around any card that sits between them.
 */
function makeEdge(
  from: Rect,
  to: Rect,
  statuses: string[],
  allBoxes: Array<{ name: string; rect: Rect }>,
  skip: Set<string>
): DiagramEdge {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;

  const blockers = allBoxes
    .filter(b => !skip.has(b.name))
    .map(b => b.rect)
    .filter(r => r.y + r.h > y1 && r.y < y2);

  const dashed = !isDefaultPath(statuses);
  const tooltip = `Runs after ${(statuses || []).join(', ')}`;

  const midY = (y1 + y2) / 2;
  const direct: Point[] =
    Math.abs(x1 - x2) < 1
      ? [[x1, y1], [x2, y2]]
      : [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];

  if (pathIsClear(direct, blockers)) {
    return { path: roundedPolyline(direct), dashed, tooltip };
  }

  const span = blockers.concat([from, to]);
  const right = Math.max.apply(null, span.map(r => r.x + r.w)) + CHANNEL_MARGIN;
  const left = Math.min.apply(null, span.map(r => r.x)) - CHANNEL_MARGIN;
  const channelX =
    left > CHANNEL_MARGIN && Math.abs(left - x1) < Math.abs(right - x1) ? left : right;

  const dropY = Math.min(y1 + STUB, y2 - STUB);
  const riseY = Math.max(y2 - STUB, dropY);

  const detour: Point[] = [
    [x1, y1], [x1, dropY], [channelX, dropY],
    [channelX, riseY], [x2, riseY], [x2, y2],
  ];

  return { path: roundedPolyline(detour), dashed, tooltip };
}

/** Curve from a container header down to one of its branch frames. */
function fanEdge(header: Rect, branch: DiagramFrame): DiagramEdge {
  const x1 = header.x + header.w / 2;
  const y1 = header.y + header.h;
  const x2 = branch.x + branch.w / 2;
  const y2 = branch.y;
  const midY = y1 + (y2 - y1) / 2;

  return {
    path: `M ${round(x1)} ${round(y1)} C ${round(x1)} ${round(midY)}, ${round(x2)} ${round(midY)}, ${round(x2)} ${round(y2)}`,
    dashed: false,
    tooltip: branch.label,
  };
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Adds hit targets, hover/selection styling and data-* hooks for click handling. */
  interactive?: boolean;
  /** The designer's "+" insert affordance. Pure decoration here, so exports omit it. */
  showInsertMarkers?: boolean;
  /** Defaults to light so exported SVGs stay printable unless asked otherwise. */
  theme?: DiagramTheme;
}

export function renderDiagramSvg(diagram: Diagram, options: RenderOptions = {}): string {
  const { interactive = false, showInsertMarkers = false, theme = 'light' } = options;
  COLORS = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const { nodes, edges, frames, width, height } = diagram;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `font-family="Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif">`
  );

  parts.push(`<defs>
    <pattern id="dotGrid" width="16" height="16" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="${COLORS.grid}"/>
    </pattern>
    <marker id="arrow" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto"
      markerUnits="userSpaceOnUse">
      <path d="M0 0.5 L7 3.5 L0 6.5 z" fill="${COLORS.edge}"/>
    </marker>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="0.8" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.12"/>
    </filter>
  </defs>`);

  if (interactive) {
    parts.push(`<style>
      .pa-node, .pa-frame { cursor: pointer; }
      .pa-hit { fill: transparent; }
      .pa-focus { fill: none; stroke: ${COLORS.plus}; stroke-width: 2; opacity: 0; pointer-events: none; }
      .pa-node:hover .pa-focus, .pa-frame:hover .pa-focus { opacity: 0.4; }
      .pa-node[data-selected="true"] .pa-focus,
      .pa-frame[data-selected="true"] .pa-focus { opacity: 1; }
      .pa-toggle { fill: transparent; cursor: pointer; }
      .pa-toggle:hover { fill: rgba(255,255,255,0.22); }
      .pa-node[data-dimmed="true"] { opacity: 0.28; }
      .pa-node[data-match="true"] .pa-focus { opacity: 1; stroke: #ca5010; }
    </style>`);
  }

  parts.push(`<rect width="100%" height="100%" fill="${COLORS.canvas}"/>`);
  parts.push(`<rect width="100%" height="100%" fill="url(#dotGrid)"/>`);

  // Containers first, then branch frames, then edges, then cards.
  for (const frame of frames) {
    if (frame.kind !== 'container') continue;
    const open = interactive
      ? `<g class="pa-frame" data-frame="${escapeXml(frame.ownerKey)}">`
      : '<g>';
    parts.push(
      open +
        `<rect x="${round(frame.x)}" y="${round(frame.y)}" width="${round(frame.w)}" ` +
        `height="${round(frame.h)}" rx="4" ry="4" fill="${COLORS.containerFill}" ` +
        `stroke="${COLORS.containerBorder}" stroke-width="1"/>` +
        (frame.summary
          ? `<text x="${round(frame.x + frame.w / 2)}" y="${round(frame.y + frame.h / 2 + 8)}" ` +
            `text-anchor="middle" fill="${COLORS.emptyText}" font-size="11.5">` +
            `${escapeXml(frame.summary)}</text>`
          : '') +
        (interactive
          ? `<rect class="pa-focus" x="${round(frame.x - 2)}" y="${round(frame.y - 2)}" ` +
            `width="${round(frame.w + 4)}" height="${round(frame.h + 4)}" rx="6" ry="6"/>`
          : '') +
        '</g>'
    );
  }

  for (const frame of frames) {
    if (frame.kind !== 'branch') continue;
    parts.push(
      `<rect x="${round(frame.x)}" y="${round(frame.y)}" width="${round(frame.w)}" ` +
        `height="${round(frame.h)}" rx="4" ry="4" fill="${COLORS.branchFill}" ` +
        `stroke="${COLORS.branchBorder}" stroke-width="1"/>`
    );
    if (frame.emptyText) {
      parts.push(
        `<text x="${round(frame.x + frame.w / 2)}" y="${round(frame.y + frame.h / 2 + 4)}" ` +
          `text-anchor="middle" fill="${COLORS.emptyText}" font-size="11.5">` +
          `${escapeXml(frame.emptyText)}</text>`
      );
    }
  }

  for (const body of diagram.emptyBodies) {
    parts.push(
      `<text x="${round(body.x + body.w / 2)}" y="${round(body.y + body.h / 2 + 4)}" ` +
        `text-anchor="middle" fill="${COLORS.emptyText}" font-size="11.5">0 Actions</text>`
    );
  }

  for (const edge of edges) {
    parts.push(
      `<path d="${edge.path}" fill="none" stroke="${COLORS.edge}" stroke-width="1.25"` +
        `${edge.dashed ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#arrow)">` +
        `<title>${escapeXml(edge.tooltip)}</title></path>`
    );
  }

  // Branch pills straddle the top edge of their frame.
  for (const frame of frames) {
    if (frame.kind !== 'branch' || !frame.label) continue;
    const w = textWidth(frame.label, 11.5) + 26;
    const x = frame.x + (frame.w - w) / 2;
    parts.push(
      `<rect x="${round(x)}" y="${round(frame.y - 13)}" width="${round(w)}" height="26" rx="3" ry="3" ` +
        `fill="${frame.pillColor}"/>` +
        `<text x="${round(x + w / 2 - 5)}" y="${round(frame.y + 4)}" text-anchor="middle" ` +
        `fill="#ffffff" font-size="11.5">${escapeXml(frame.label)}</text>` +
        chevron(x + w - 14, frame.y, '#ffffff')
    );
  }

  if (showInsertMarkers) {
    for (const point of diagram.plusPoints) {
      parts.push(plusMarker(point.x, point.y));
    }
  }

  nodes.forEach((node, i) => parts.push(renderCard(node, i, interactive)));

  parts.push('</svg>');
  return parts.join('\n');
}

function chevron(x: number, y: number, color: string, dir: 'up' | 'down' = 'down'): string {
  const dy = dir === 'down' ? 2 : -2;
  return (
    `<path d="M ${round(x - 4)} ${round(y - dy)} L ${round(x)} ${round(y + dy)} ` +
    `L ${round(x + 4)} ${round(y - dy)}" fill="none" stroke="${color}" stroke-width="1.4" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** The designer's insert affordance. Decorative here - the diagram is read-only. */
function plusMarker(x: number, y: number): string {
  return (
    `<g><circle cx="${round(x)}" cy="${round(y)}" r="${PLUS_R}" fill="${COLORS.card}" ` +
    `stroke="${COLORS.plus}" stroke-width="1.1"/>` +
    `<path d="M ${round(x - 4)} ${round(y)} H ${round(x + 4)} M ${round(x)} ${round(y - 4)} ` +
    `V ${round(y + 4)}" stroke="${COLORS.plus}" stroke-width="1.3" stroke-linecap="round"/></g>`
  );
}

function renderCard(node: DiagramNode, index: number, interactive: boolean): string {
  const parts: string[] = [
    interactive
      ? `<g class="pa-node" data-node="${escapeXml(node.key)}" tabindex="0" role="button" ` +
        `aria-label="${escapeXml(node.lines.join(' '))}">`
      : '<g>',
  ];

  // Status dots sit above the card, one group per runAfter parent.
  if (node.dotGroups.length > 0) {
    const widths = node.dotGroups.map(g => g.length * DOT_GAP);
    const total =
      widths.reduce((a, b) => a + b, 0) + DOT_GROUP_GAP * (node.dotGroups.length - 1);
    let dx = node.x + node.w / 2 - total / 2;
    const dy = node.y - DOT_OFFSET;

    for (const group of node.dotGroups) {
      for (const status of group) {
        parts.push(
          `<circle cx="${round(dx)}" cy="${round(dy)}" r="${DOT_R}" ` +
            `fill="${STATUS_COLORS[status] || COLORS.edge}"><title>${escapeXml(status)}</title></circle>`
        );
        dx += DOT_GAP;
      }
      dx += DOT_GROUP_GAP;
    }
  }

  const fill = node.isHeader ? COLORS.containerHeader : COLORS.card;
  const textColor = node.isHeader ? COLORS.containerHeaderText : COLORS.title;

  parts.push(
    `<rect x="${round(node.x)}" y="${round(node.y)}" width="${node.w}" height="${round(node.h)}" ` +
      `rx="3" ry="3" fill="${fill}" stroke="${node.isHeader ? COLORS.containerHeader : COLORS.cardBorder}" ` +
      `stroke-width="1" filter="url(#cardShadow)"/>`
  );

  // Brand-coloured accent bar down the left edge, clipped to the card's rounding.
  if (!node.isHeader) {
    const clipId = `cardClip${index}`;
    parts.push(
      `<clipPath id="${clipId}"><rect x="${round(node.x)}" y="${round(node.y)}" ` +
        `width="${node.w}" height="${round(node.h)}" rx="3" ry="3"/></clipPath>` +
        `<rect x="${round(node.x)}" y="${round(node.y)}" width="${ACCENT_W}" ` +
        `height="${round(node.h)}" fill="${node.accent}" clip-path="url(#${clipId})"/>`
    );
  }

  const iconY = node.y + (node.h - ICON) / 2;
  if (node.iconUri) {
    parts.push(
      `<image x="${round(node.x + ICON_X)}" y="${round(iconY)}" width="${ICON}" height="${ICON}" ` +
        `href="${escapeXml(node.iconUri)}" xlink:href="${escapeXml(node.iconUri)}" ` +
        `preserveAspectRatio="xMidYMid meet"/>`
    );
  } else {
    parts.push(
      `<rect x="${round(node.x + ICON_X)}" y="${round(iconY)}" width="${ICON}" height="${ICON}" ` +
        `rx="3" ry="3" fill="${node.isHeader ? '#605e5c' : node.accent}"/>` +
        `<text x="${round(node.x + ICON_X + ICON / 2)}" y="${round(iconY + ICON / 2 + 3.5)}" ` +
        `text-anchor="middle" fill="#ffffff" font-size="9" font-weight="600">` +
        `${escapeXml(node.shortLabel)}</text>`
    );
  }

  // Vertically centre the wrapped name block.
  const blockH = node.lines.length * CARD_LINE_H;
  let ty = node.y + (node.h - blockH) / 2 + 11.5;
  for (const line of node.lines) {
    parts.push(
      `<text x="${round(node.x + TEXT_X)}" y="${round(ty)}" fill="${textColor}" ` +
        `font-size="${TITLE_SIZE}">${escapeXml(line)}</text>`
    );
    ty += CARD_LINE_H;
  }

  if (node.isHeader) {
    const cx = node.x + node.w - 16;
    const cy = node.y + node.h / 2;
    parts.push(chevron(cx, cy, '#ffffff', node.collapsed ? 'down' : 'up'));

    if (interactive) {
      // Its own hit target so clicking the chevron toggles instead of selecting.
      parts.push(
        `<rect class="pa-toggle" data-toggle="${escapeXml(node.key)}" ` +
          `x="${round(cx - 13)}" y="${round(cy - 13)}" width="26" height="26" rx="4" ry="4">` +
          `<title>${node.collapsed ? 'Expand' : 'Collapse'}</title></rect>`
      );
    }
  }

  if (interactive) {
    parts.push(
      `<rect class="pa-focus" x="${round(node.x - 3)}" y="${round(node.y - 3)}" ` +
        `width="${node.w + 6}" height="${round(node.h + 6)}" rx="5" ry="5"/>`
    );
  }

  parts.push(`<title>${escapeXml(node.tooltip)}</title>`);
  parts.push('</g>');
  return parts.join('');
}

export function generateFlowDiagramSvg(
  actions: FlowAction[],
  trigger: FlowTrigger | null,
  options: RenderOptions & LayoutOptions = {}
): string {
  if (!actions || actions.length === 0) return '';
  return renderDiagramSvg(buildDiagram(actions, trigger, options), options);
}

/**
 * Replace remote connector icons with data URIs so an exported SVG still shows
 * its icons when opened outside the browser. Icons that cannot be fetched are
 * left alone - the accent bar keeps the card readable either way.
 */
export async function inlineDiagramImages(svg: string): Promise<string> {
  const urls: string[] = [];
  const pattern = /href="(https?:\/\/[^"]+)"/g;

  let match = pattern.exec(svg);
  while (match !== null) {
    if (urls.indexOf(match[1]) < 0) urls.push(match[1]);
    match = pattern.exec(svg);
  }
  if (urls.length === 0) return svg;

  const replacements = await Promise.all(
    urls.map(async url => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return { url, dataUri };
      } catch {
        return null;
      }
    })
  );

  let out = svg;
  for (const replacement of replacements) {
    if (!replacement) continue;
    out = out.split(`"${replacement.url}"`).join(`"${replacement.dataUri}"`);
  }
  return out;
}
