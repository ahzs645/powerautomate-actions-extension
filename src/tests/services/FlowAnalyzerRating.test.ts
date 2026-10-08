import { FlowAnalyzer } from '../../services/FlowAnalyzer';
import { manualTriggerFlow } from '../fixtures/modernFlowDefinitions';

describe('FlowAnalyzer rating breakdown', () => {
  it('explains the overall rating line by line, and the lines add up to it', () => {
    const result = new FlowAnalyzer().analyze({ definition: manualTriggerFlow });
    const breakdown = result.ratingBreakdown!;

    expect(breakdown.map((f) => f.key)).toEqual([
      'complexity',
      'actions',
      'mainScope',
      'exceptionScope',
      'varNaming',
      'varUsed',
      'variables',
      'composes',
      'connections',
    ]);
    for (const factor of breakdown) {
      expect(factor.points).toBeGreaterThanOrEqual(0);
      expect(factor.points).toBeLessThanOrEqual(factor.max);
      expect(factor.detail).toBeTruthy();
    }
    const points = breakdown.reduce((s, f) => s + f.points, 0);
    const max = breakdown.reduce((s, f) => s + f.max, 0);
    expect(result.overallRating).toBe(Math.round((100 * points) / max));
  });

  it('lets a small, well-structured flow reach 100%', () => {
    const result = new FlowAnalyzer().analyze({
      definition: {
        triggers: { manual: { type: 'Request', kind: 'Button' } },
        actions: {
          Try: { type: 'Scope', runAfter: {}, actions: { Http: { type: 'Http', runAfter: {} } } },
          Catch: {
            type: 'Scope',
            runAfter: { Try: ['Failed'] },
            actions: { Terminate: { type: 'Terminate', runAfter: {} } },
          },
        },
      },
    });

    expect(result.ratingBreakdown!.find((f) => f.key === 'varUsed')).toBeUndefined();
    expect(result.overallRating).toBe(100);
  });

  it('keeps one weak category from wiping out the rest', () => {
    const composes: Record<string, unknown> = {};
    for (let i = 0; i < 9; i++) composes[`Compose_${i}`] = { type: 'Compose', runAfter: {}, inputs: i };
    const result = new FlowAnalyzer().analyze({ definition: { triggers: {}, actions: composes } });
    const composeFactor = result.ratingBreakdown!.find((f) => f.key === 'composes')!;

    expect(composeFactor.points).toBe(0);
    expect(result.overallRating).toBeGreaterThan(40);
  });
});
