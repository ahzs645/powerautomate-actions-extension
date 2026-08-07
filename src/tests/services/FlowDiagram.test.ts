import * as fs from 'fs';
import * as path from 'path';
import { FlowAnalyzer } from '../../services/FlowAnalyzer';
import { buildDiagram, generateFlowDiagramSvg } from '../../features/flow-editor/FlowDiagram';

// A condition with a nested action, a failure path, and a multi-parent join -
// the three shapes the previous grid renderer got wrong.
const FLOW = {
  connectionReferences: {
    shared_office365: {
      displayName: 'Office 365 Outlook',
      iconUri: 'https://example.invalid/office365/icon.png',
      brandColor: '#0078D4',
      apiName: 'office365',
    },
    'shared_excelonlinebusiness-1': {
      displayName: 'Excel Online (Business)',
      iconUri: 'https://example.invalid/excel/icon.png',
      brandColor: '#107C41',
      apiName: 'excelonlinebusiness',
    },
  },
  definition: {
    triggers: {
      When_a_new_email_arrives: {
        type: 'OpenApiConnection',
        inputs: { host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_office365' } },
      },
    },
    actions: {
      Initialize_AliasUsed: { runAfter: {}, type: 'InitializeVariable', inputs: { variables: [{ name: 'AliasUsed', type: 'string' }] } },
      Look_up_the_site: {
        runAfter: { Initialize_AliasUsed: ['Succeeded'] },
        type: 'OpenApiConnection',
        inputs: {
          host: {
            apiId: '/providers/Microsoft.PowerApps/apis/shared_excelonlinebusiness',
            connectionName: 'shared_excelonlinebusiness-1',
          },
        },
      },
      Read_the_Status: { runAfter: { Look_up_the_site: ['Succeeded'] }, type: 'SetVariable', inputs: { name: 'StatusValue' } },
      Record_that_the_lookup_failed: {
        runAfter: { Look_up_the_site: ['Failed', 'TimedOut'] },
        type: 'SetVariable',
        inputs: { name: 'LookupProblem' },
      },
      Alert_only_if_the_site_is_not_active: {
        type: 'If',
        runAfter: {
          Read_the_Status: ['Succeeded', 'Skipped'],
          Record_that_the_lookup_failed: ['Succeeded', 'Skipped'],
        },
        actions: {
          Notify_Healthy_Start: {
            type: 'OpenApiConnection',
            inputs: { host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_office365' } },
          },
        },
        else: { actions: {} },
      },
    },
  },
};

function analyze() {
  const analyzer = new FlowAnalyzer();
  return analyzer.analyze(FLOW, 'Test Flow');
}

describe('FlowAnalyzer diagram data', () => {
  it('preserves runAfter statuses instead of flattening to names', () => {
    const result = analyze();
    const record = result.actions.find(a => a.Name === 'Record_that_the_lookup_failed')!;

    expect(record.runAfterDetail).toEqual({ Look_up_the_site: ['Failed', 'TimedOut'] });
    // The legacy flattened string is still populated for existing consumers.
    expect(record.runAfter).toBe('Look_up_the_site');
  });

  it('tags the else branch so conditions can be split', () => {
    const result = analyze();
    const nested = result.actions.find(a => a.Name === 'Notify_Healthy_Start')!;

    expect(nested.parent).toBe('Alert_only_if_the_site_is_not_active');
    expect(nested.branch).toBe('');
  });

  it('resolves connector branding from connectionReferences', () => {
    const result = analyze();
    const lookup = result.actions.find(a => a.Name === 'Look_up_the_site')!;

    // Matched via connectionName, which carries the "-1" reference suffix.
    expect(lookup.brandColor).toBe('#107C41');
    expect(lookup.imgURL).toBe('https://example.invalid/excel/icon.png');
  });
});

describe('buildDiagram', () => {
  it('places every action, including ones nested in a condition', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    const keys = diagram.nodes.map(n => n.key);
    expect(keys).toContain('__trigger__');
    for (const action of result.actions) {
      expect(keys).toContain(action.Name);
    }
  });

  it('draws every edge downwards', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const byKey = new Map(diagram.nodes.map(n => [n.key, n]));

    for (const action of result.actions) {
      for (const parent of Object.keys(action.runAfterDetail)) {
        const from = byKey.get(parent);
        const to = byKey.get(action.Name);
        if (!from || !to) continue;
        expect(from.y + from.h).toBeLessThanOrEqual(to.y);
      }
    }
  });

  it('nests the condition body inside a branch frame', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    const labels = diagram.frames.map(f => f.label);
    expect(labels).toEqual(expect.arrayContaining(['True', 'False']));

    const notify = diagram.nodes.find(n => n.key === 'Notify_Healthy_Start')!;
    const yesFrame = diagram.frames.find(f => f.label === 'True')!;
    const falseFrame = diagram.frames.find(f => f.label === 'False')!;
    expect(falseFrame.emptyText).toBe('0 Actions');

    expect(notify.x).toBeGreaterThanOrEqual(yesFrame.x);
    expect(notify.x + notify.w).toBeLessThanOrEqual(yesFrame.x + yesFrame.w);
    expect(notify.y).toBeGreaterThanOrEqual(yesFrame.y);
    expect(notify.y + notify.h).toBeLessThanOrEqual(yesFrame.y + yesFrame.h);
  });

  it('dashes non-default runAfter paths and keeps plain success solid', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    const dashed = diagram.edges.filter(e => e.dashed);
    // Look_up -> Record (Failed/TimedOut) plus the two Succeeded/Skipped joins.
    expect(dashed).toHaveLength(3);
    expect(dashed.some(e => e.tooltip.includes('Failed, TimedOut'))).toBe(true);

    expect(diagram.edges.some(e => !e.dashed)).toBe(true);
  });

  it('shows status dots only for non-default runAfter', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const byKey = new Map(diagram.nodes.map(n => [n.key, n]));

    expect(byKey.get('Record_that_the_lookup_failed')!.dotGroups).toEqual([
      ['Failed', 'TimedOut'],
    ]);
    expect(byKey.get('Alert_only_if_the_site_is_not_active')!.dotGroups).toEqual([
      ['Succeeded', 'Skipped'],
      ['Succeeded', 'Skipped'],
    ]);
    // A plain "after success" link gets no dots, matching the designer.
    expect(byKey.get('Read_the_Status')!.dotGroups).toEqual([]);
  });

  it('renders the condition card as a container header', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const byKey = new Map(diagram.nodes.map(n => [n.key, n]));

    expect(byKey.get('Alert_only_if_the_site_is_not_active')!.isHeader).toBe(true);
    expect(byKey.get('Read_the_Status')!.isHeader).toBe(false);
  });

  it('keeps insert markers clear of cards and branch pills', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const PLUS_R = 8;

    for (const point of diagram.plusPoints) {
      for (const node of diagram.nodes) {
        const overlaps =
          point.x + PLUS_R > node.x &&
          point.x - PLUS_R < node.x + node.w &&
          point.y + PLUS_R > node.y &&
          point.y - PLUS_R < node.y + node.h;
        expect(overlaps).toBe(false);
      }

      // Branch pills straddle the top edge of their frame.
      for (const frame of diagram.frames) {
        if (frame.kind !== 'branch' || !frame.label) continue;
        const pillTop = frame.y - 13;
        const pillBottom = frame.y + 13;
        const vertical = point.y + PLUS_R > pillTop && point.y - PLUS_R < pillBottom;
        // The pill is centred on the frame, so only a centred marker could clash.
        const horizontal = Math.abs(point.x - (frame.x + frame.w / 2)) < 40;
        expect(vertical && horizontal).toBe(false);
      }
    }
  });

  it('gives every action card an insert marker, but not the trigger', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    expect(diagram.plusPoints).toHaveLength(result.actions.length);
    const triggerNode = diagram.nodes.find(n => n.key === '__trigger__')!;
    for (const point of diagram.plusPoints) {
      expect(point.y).toBeGreaterThan(triggerNode.y);
    }
  });

  it('clamps long names to the card instead of overflowing', () => {
    const longName = 'Supercalifragilisticexpialidocious_'.repeat(4) + 'End';
    const flow = {
      definition: {
        triggers: { T: { type: 'Request' } },
        actions: { [longName]: { runAfter: {}, type: 'Compose' } },
      },
    };
    const result = new FlowAnalyzer().analyze(flow, 'Long');
    const diagram = buildDiagram(result.actions, result.trigger);
    const node = diagram.nodes.find(n => n.key === longName)!;

    expect(node.lines.length).toBeLessThanOrEqual(3);
    // Every line must fit the card's text column, and the name must be marked truncated.
    for (const line of node.lines) {
      expect(line.length).toBeLessThan(40);
    }
    expect(node.lines.join('')).toContain('…');
    expect(node.x + node.w).toBeLessThanOrEqual(diagram.width);
  });

  it('keeps cards inside the canvas', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    for (const node of diagram.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w).toBeLessThanOrEqual(diagram.width);
      expect(node.y + node.h).toBeLessThanOrEqual(diagram.height);
    }
  });
});

describe('renderDiagramSvg', () => {
  it('escapes action names into the markup', () => {
    const result = analyze();
    const svg = generateFlowDiagramSvg(result.actions, result.trigger);

    expect(svg).toContain('<svg');
    expect(svg).toContain('Notify Healthy Start');
    expect(svg).not.toContain('<script');
  });

  it('returns empty string when there is nothing to draw', () => {
    expect(generateFlowDiagramSvg([], null)).toBe('');
  });

  it('writes a preview artifact for manual inspection', () => {
    const result = analyze();
    const svg = generateFlowDiagramSvg(result.actions, result.trigger);

    const out = process.env.DIAGRAM_PREVIEW_PATH;
    if (out) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, svg, 'utf8');
    }
    expect(svg.length).toBeGreaterThan(0);
  });
});
