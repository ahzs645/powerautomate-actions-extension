import * as fs from 'fs';
import * as path from 'path';
import { FlowAnalyzer } from '../../services/FlowAnalyzer';
import { buildDiagram, generateFlowDiagramSvg, renderDiagramSvg } from '../../features/flow-editor/FlowDiagram';

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

describe('containers', () => {
  const SCOPED = {
    definition: {
      triggers: { Manual: { type: 'Request' } },
      actions: {
        Try_scope: {
          type: 'Scope',
          runAfter: {},
          actions: {
            Step_one: { type: 'Compose', runAfter: {} },
            Step_two: { type: 'Compose', runAfter: { Step_one: ['Succeeded'] } },
          },
        },
        Catch_scope: {
          type: 'Scope',
          runAfter: { Try_scope: ['Failed'] },
          actions: { Log_it: { type: 'Compose', runAfter: {} } },
        },
      },
    },
  };

  function scoped() {
    const result = new FlowAnalyzer().analyze(SCOPED, 'Scoped');
    return { result, diagram: buildDiagram(result.actions, result.trigger) };
  }

  it('gives a single-body scope one frame, not a frame inside a frame', () => {
    const { diagram } = scoped();

    const owned = diagram.frames.filter(f => f.ownerKey === 'Try_scope');
    expect(owned).toHaveLength(1);
    expect(owned[0].kind).toBe('container');
    // An If still gets its per-branch frames.
    const ifResult = analyze();
    const ifDiagram = buildDiagram(ifResult.actions, ifResult.trigger);
    expect(
      ifDiagram.frames.filter(f => f.ownerKey === 'Alert_only_if_the_site_is_not_active')
    ).toHaveLength(3); // container + True + False
  });

  it('starts an outgoing connector below the scope body, not under its header', () => {
    const { diagram } = scoped();

    const container = diagram.frames.find(
      f => f.kind === 'container' && f.ownerKey === 'Try_scope'
    )!;
    const catchCard = diagram.nodes.find(n => n.key === 'Catch_scope')!;

    // The Try_scope -> Catch_scope edge must begin at or below the container's
    // bottom edge; starting at the header would drag it through the scope body.
    const start = diagram.edges
      .map(e => /^M ([\d.]+) ([\d.]+)/.exec(e.path))
      .filter(Boolean)
      .map(m => ({ x: parseFloat(m![1]), y: parseFloat(m![2]) }))
      .find(p => Math.abs(p.y - (container.y + container.h)) < 1);

    expect(start).toBeDefined();
    expect(catchCard.y).toBeGreaterThan(container.y + container.h);
  });

  it('does not treat a scope as an obstacle for its own children', () => {
    const { diagram } = scoped();

    // Step_one -> Step_two sits wholly inside Try_scope, so it stays a straight drop.
    const corners = diagram.edges.map(e => (e.path.match(/Q /g) || []).length);
    expect(Math.max(...corners)).toBeLessThanOrEqual(2);
  });
});

describe('operation icons', () => {
  it('gives built-in operations the designer icon and brand colour', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const byKey = new Map(diagram.nodes.map(n => [n.key, n]));

    const variable = byKey.get('Initialize_AliasUsed')!;
    expect(variable.iconUri.startsWith('data:image/svg+xml')).toBe(true);
    expect(variable.accent).toBe('#770BD6');

    const condition = byKey.get('Alert_only_if_the_site_is_not_active')!;
    expect(condition.iconUri.startsWith('data:image/svg+xml')).toBe(true);
    expect(condition.accent).toBe('#484F58');
  });

  it('lets a connector action keep its own connectionReferences branding', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const lookup = diagram.nodes.find(n => n.key === 'Look_up_the_site')!;

    // Excel's iconUri wins over any built-in table entry.
    expect(lookup.iconUri).toBe('https://example.invalid/excel/icon.png');
    expect(lookup.accent).toBe('#107C41');
  });

  it('resolves branding for the trigger too', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const trigger = diagram.nodes.find(n => n.isTrigger)!;

    expect(result.trigger.imgURL).toBe('https://example.invalid/office365/icon.png');
    expect(trigger.iconUri).toBe('https://example.invalid/office365/icon.png');
    expect(trigger.accent).toBe('#0078D4');
  });

  it('gives the control-flow containers their real designer icons', () => {
    const flow = {
      definition: {
        triggers: { Manual: { type: 'Request' } },
        actions: {
          Try_scope: { type: 'Scope', runAfter: {}, actions: { A: { type: 'Compose', runAfter: {} } } },
          Loop_it: { type: 'Foreach', runAfter: {}, actions: { B: { type: 'Compose', runAfter: {} } } },
          Route: { type: 'Switch', runAfter: {}, cases: { C1: { actions: { C: { type: 'Compose', runAfter: {} } } } } },
        },
      },
    };
    const result = new FlowAnalyzer().analyze(flow, 'Containers');
    const diagram = buildDiagram(result.actions, result.trigger);
    const byKey = new Map(diagram.nodes.map(n => [n.key, n]));

    // These were once wrongly reported as absent from the capture; they are not.
    // Colours come from the designer's brandColors map (SCOPE / LOOP / CONDITION).
    for (const [key, colour] of [
      ['Try_scope', '#8C3900'],
      ['Loop_it', '#486991'],
      ['Route', '#484F58'],
    ] as const) {
      const node = byKey.get(key)!;
      expect(node.iconUri.startsWith('data:image/svg+xml')).toBe(true);
      expect(node.accent).toBe(colour);
    }
  });

  it('falls back to initials only for types with no icon at all', () => {
    const flow = {
      definition: {
        triggers: { Manual: { type: 'Request' } },
        actions: {
          Call_child_flow: { type: 'Workflow', runAfter: {} },
        },
      },
    };
    const result = new FlowAnalyzer().analyze(flow, 'Fallback');
    const diagram = buildDiagram(result.actions, result.trigger);
    const node = diagram.nodes.find(n => n.key === 'Call_child_flow')!;

    expect(node.iconUri).toBe('');
    expect(node.shortLabel).toBe('WO');
  });
});

describe('containers', () => {
  const SCOPED = {
    definition: {
      triggers: { Manual: { type: 'Request' } },
      actions: {
        Try_scope: {
          type: 'Scope',
          runAfter: {},
          actions: {
            Step_one: { type: 'Compose', runAfter: {} },
            Step_two: { type: 'Compose', runAfter: { Step_one: ['Succeeded'] } },
          },
        },
        Catch_scope: {
          type: 'Scope',
          runAfter: { Try_scope: ['Failed'] },
          actions: { Log_it: { type: 'Compose', runAfter: {} } },
        },
      },
    },
  };

  function scoped() {
    const result = new FlowAnalyzer().analyze(SCOPED, 'Scoped');
    return { result, diagram: buildDiagram(result.actions, result.trigger) };
  }

  it('gives a single-body scope one frame, not a frame inside a frame', () => {
    const { diagram } = scoped();

    const owned = diagram.frames.filter(f => f.ownerKey === 'Try_scope');
    expect(owned).toHaveLength(1);
    expect(owned[0].kind).toBe('container');
    // An If still gets its per-branch frames.
    const ifResult = analyze();
    const ifDiagram = buildDiagram(ifResult.actions, ifResult.trigger);
    expect(
      ifDiagram.frames.filter(f => f.ownerKey === 'Alert_only_if_the_site_is_not_active')
    ).toHaveLength(3); // container + True + False
  });

  it('starts an outgoing connector below the scope body, not under its header', () => {
    const { diagram } = scoped();

    const container = diagram.frames.find(
      f => f.kind === 'container' && f.ownerKey === 'Try_scope'
    )!;
    const catchCard = diagram.nodes.find(n => n.key === 'Catch_scope')!;

    // The Try_scope -> Catch_scope edge must begin at or below the container's
    // bottom edge; starting at the header would drag it through the scope body.
    const start = diagram.edges
      .map(e => /^M ([\d.]+) ([\d.]+)/.exec(e.path))
      .filter(Boolean)
      .map(m => ({ x: parseFloat(m![1]), y: parseFloat(m![2]) }))
      .find(p => Math.abs(p.y - (container.y + container.h)) < 1);

    expect(start).toBeDefined();
    expect(catchCard.y).toBeGreaterThan(container.y + container.h);
  });

  it('does not treat a scope as an obstacle for its own children', () => {
    const { diagram } = scoped();

    // Step_one -> Step_two sits wholly inside Try_scope, so it stays a straight drop.
    const corners = diagram.edges.map(e => (e.path.match(/Q /g) || []).length);
    expect(Math.max(...corners)).toBeLessThanOrEqual(2);
  });
});

describe('operation icons', () => {
  it('gives built-in operations the designer icon and brand colour', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const byKey = new Map(diagram.nodes.map(n => [n.key, n]));

    const variable = byKey.get('Initialize_AliasUsed')!;
    expect(variable.iconUri.startsWith('data:image/svg+xml')).toBe(true);
    expect(variable.accent).toBe('#770BD6');

    const condition = byKey.get('Alert_only_if_the_site_is_not_active')!;
    expect(condition.iconUri.startsWith('data:image/svg+xml')).toBe(true);
    expect(condition.accent).toBe('#484F58');
  });

  it('lets a connector action keep its own connectionReferences branding', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const lookup = diagram.nodes.find(n => n.key === 'Look_up_the_site')!;

    // Excel's iconUri wins over any built-in table entry.
    expect(lookup.iconUri).toBe('https://example.invalid/excel/icon.png');
    expect(lookup.accent).toBe('#107C41');
  });

  it('resolves branding for the trigger too', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const trigger = diagram.nodes.find(n => n.isTrigger)!;

    expect(result.trigger.imgURL).toBe('https://example.invalid/office365/icon.png');
    expect(trigger.iconUri).toBe('https://example.invalid/office365/icon.png');
    expect(trigger.accent).toBe('#0078D4');
  });

  it('gives a nested Compose the data-operation icon', () => {
    const flow = {
      definition: {
        triggers: { Manual: { type: 'Request' } },
        actions: {
          Try_scope: {
            type: 'Scope',
            runAfter: {},
            actions: { Step: { type: 'Compose', runAfter: {} } },
          },
        },
      },
    };
    const result = new FlowAnalyzer().analyze(flow, 'S');
    const diagram = buildDiagram(result.actions, result.trigger);

    const compose = diagram.nodes.find(n => n.key === 'Step')!;
    expect(compose.iconUri.startsWith('data:image/svg+xml')).toBe(true);
    expect(compose.accent).toBe('#8C6CFF');
  });
});

describe('collapse', () => {
  const SWITCHY = (caseCount: number) => {
    const cases: Record<string, unknown> = {};
    for (let i = 1; i <= caseCount; i++) {
      cases[`Case_${i}`] = { actions: { [`Send_${i}`]: { type: 'Compose', runAfter: {} } } };
    }
    return {
      definition: {
        triggers: { Manual: { type: 'Request' } },
        actions: {
          Wide_switch: { type: 'Switch', runAfter: {}, cases },
          Final_step: { type: 'Terminate', runAfter: { Wide_switch: ['Succeeded'] } },
        },
      },
    };
  };

  it('hides a collapsed container body and reports what is inside', () => {
    const result = analyze();
    const key = 'Alert_only_if_the_site_is_not_active';
    const open = buildDiagram(result.actions, result.trigger);
    const shut = buildDiagram(result.actions, result.trigger, { collapsed: new Set([key]) });

    // The nested action disappears from the canvas entirely.
    expect(open.nodes.map(n => n.key)).toContain('Notify_Healthy_Start');
    expect(shut.nodes.map(n => n.key)).not.toContain('Notify_Healthy_Start');

    // Branch frames go too, leaving one container frame carrying the count.
    expect(shut.frames.filter(f => f.ownerKey === key)).toHaveLength(1);
    expect(shut.frames.find(f => f.ownerKey === key)!.summary).toBe('1 Action');

    expect(shut.nodes.find(n => n.key === key)!.collapsed).toBe(true);
    expect(open.nodes.find(n => n.key === key)!.collapsed).toBe(false);
    expect(shut.height).toBeLessThan(open.height);
  });

  it('counts cases rather than actions for a Switch', () => {
    const result = new FlowAnalyzer().analyze(SWITCHY(3), 'S');
    const diagram = buildDiagram(result.actions, result.trigger, {
      collapsed: new Set(['Wide_switch']),
    });

    expect(diagram.frames.find(f => f.ownerKey === 'Wide_switch')!.summary).toBe('3 Cases');
  });

  it('keeps connectors intact around a collapsed container', () => {
    const result = new FlowAnalyzer().analyze(SWITCHY(3), 'S');
    const diagram = buildDiagram(result.actions, result.trigger, {
      collapsed: new Set(['Wide_switch']),
    });

    const sw = diagram.nodes.find(n => n.key === 'Wide_switch')!;
    const final = diagram.nodes.find(n => n.key === 'Final_step')!;
    expect(final.y).toBeGreaterThan(sw.y + sw.h);
  });
});

describe('wide switches', () => {
  function wide(caseCount: number) {
    const cases: Record<string, unknown> = {};
    for (let i = 1; i <= caseCount; i++) {
      cases[`Case_${i}`] = { actions: { [`Send_${i}`]: { type: 'Compose', runAfter: {} } } };
    }
    const result = new FlowAnalyzer().analyze(
      { definition: { triggers: { Manual: { type: 'Request' } }, actions: {
        Wide_switch: { type: 'Switch', runAfter: {}, cases } } } },
      'W'
    );
    return buildDiagram(result.actions, result.trigger);
  }

  it('wraps branches into rows instead of growing without bound', () => {
    const three = wide(3);
    const six = wide(6);

    const rowsOf = (d: ReturnType<typeof wide>) =>
      new Set(d.frames.filter(f => f.kind === 'branch').map(f => f.row));

    expect(rowsOf(three).size).toBe(1);
    expect(rowsOf(six).size).toBe(2);
    // Doubling the cases must not double the width.
    expect(six.width).toBeLessThan(three.width * 1.5);
  });

  it('fans out only to the first row, so no line crosses the row above', () => {
    const six = wide(6);
    const firstRow = six.frames.filter(f => f.kind === 'branch' && f.row === 0);
    const curves = six.edges.filter(e => e.path.indexOf('C ') >= 0);

    expect(firstRow).toHaveLength(3);
    expect(curves).toHaveLength(firstRow.length);
  });
});

describe('render options', () => {
  it('adds click targets and selection styling only when interactive', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    const interactive = renderDiagramSvg(diagram, { interactive: true });
    expect(interactive).toContain('data-node="Read_the_Status"');
    expect(interactive).toContain('data-frame="Alert_only_if_the_site_is_not_active"');
    expect(interactive).toContain('pa-focus');
    expect(interactive).toContain('cursor: pointer');

    const staticSvg = renderDiagramSvg(diagram, { interactive: false });
    expect(staticSvg).not.toContain('data-node');
    expect(staticSvg).not.toContain('data-frame');
    expect(staticSvg).not.toContain('pa-focus');
    expect(staticSvg).not.toContain('cursor: pointer');
  });

  it('draws no "+" insert markers: the diagram is read-only', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const onScreen = renderDiagramSvg(diagram, { interactive: true });

    expect((diagram as any).plusPoints).toBeUndefined();
    // Status dots are the only circles left (radius 3); the old markers were r="8".
    expect(onScreen).not.toContain('r="8"');
    expect(countOccurrences(onScreen, 'marker-end="url(#arrow)"')).toBe(diagram.edges.length);
  });

  it('paints on-screen renders with design tokens and exports with plain hex', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);

    const onScreen = renderDiagramSvg(diagram, { interactive: true, theme: 'dark' });
    expect(onScreen).toContain('fill="var(--color-bg-card, #1b1b1f)"');
    expect(onScreen).toContain('var(--color-fg, #e8e8ed)');

    const exported = renderDiagramSvg(diagram, { interactive: false, theme: 'dark' });
    expect(exported).not.toContain('var(--');
    expect(exported).toContain('fill="#1b1b1f"');
  });

  it('resolves branch pill colours at render time, not layout time', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const kinds = diagram.frames.filter(f => f.kind === 'branch' && f.label).map(f => f.pillColor);
    expect(kinds.every(k => ['true', 'false', 'neutral'].includes(k))).toBe(true);

    const light = renderDiagramSvg(diagram, { theme: 'light' });
    const dark = renderDiagramSvg(diagram, { theme: 'dark' });
    if (kinds.includes('true')) {
      expect(light).toContain('fill="#107c10"');
      expect(dark).toContain('fill="#237b23"');
    }
  });

  it('defaults to a static export-safe render', () => {
    const result = analyze();
    const diagram = buildDiagram(result.actions, result.trigger);
    const svg = renderDiagramSvg(diagram);

    expect(svg).not.toContain('data-node');
    expect(svg).not.toContain('pa-focus');
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

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
