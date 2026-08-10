import {
  ANY_STATE,
  countByOwner,
  DEFAULT_FILTERS,
  filterFlows,
  getAvailableStates,
  hasKnownOwners,
} from '../../features/flows-list/flowFilters';
import { FlowSummary } from '../../features/flows-list/flowsApi';

function flow(overrides: Partial<FlowSummary> & { id: string }): FlowSummary {
  return {
    displayName: overrides.id,
    scope: 'personal',
    state: 'Started',
    ...overrides,
  };
}

const flows: FlowSummary[] = [
  flow({ id: 'mine-on', displayName: 'Approval router', scope: 'personal', state: 'Started' }),
  flow({ id: 'mine-off', displayName: 'Nightly cleanup', scope: 'personal', state: 'Stopped' }),
  flow({ id: 'team-on', displayName: 'Team digest', scope: 'team', state: 'Started' }),
  flow({ id: 'team-susp', displayName: 'Legacy sync', scope: 'team', state: 'Suspended' }),
];

describe('filterFlows', () => {
  it('returns everything with the default filters', () => {
    expect(filterFlows(flows, DEFAULT_FILTERS)).toHaveLength(4);
  });

  it('filters by owner tab', () => {
    const mine = filterFlows(flows, { ...DEFAULT_FILTERS, owner: 'personal' });
    expect(mine.map((f) => f.id)).toEqual(['mine-on', 'mine-off']);

    const shared = filterFlows(flows, { ...DEFAULT_FILTERS, owner: 'team' });
    expect(shared.map((f) => f.id)).toEqual(['team-on', 'team-susp']);
  });

  it('filters by state', () => {
    const started = filterFlows(flows, { ...DEFAULT_FILTERS, state: 'Started' });
    expect(started.map((f) => f.id)).toEqual(['mine-on', 'team-on']);
  });

  it('filters by name, case-insensitively', () => {
    const found = filterFlows(flows, { ...DEFAULT_FILTERS, search: '  NIGHTLY ' });
    expect(found.map((f) => f.id)).toEqual(['mine-off']);
  });

  it('combines owner, state and search', () => {
    const result = filterFlows(flows, { owner: 'team', state: 'Started', search: 'digest' });
    expect(result.map((f) => f.id)).toEqual(['team-on']);
  });

  it('keeps flows of unknown ownership visible under every owner tab', () => {
    const withUnknown = [...flows, flow({ id: 'mystery', scope: 'unknown' })];

    expect(filterFlows(withUnknown, { ...DEFAULT_FILTERS, owner: 'personal' })).toContainEqual(
      expect.objectContaining({ id: 'mystery' })
    );
    expect(filterFlows(withUnknown, { ...DEFAULT_FILTERS, owner: 'team' })).toContainEqual(
      expect.objectContaining({ id: 'mystery' })
    );
  });
});

describe('countByOwner', () => {
  it('counts each tab under the default filters', () => {
    expect(countByOwner(flows, DEFAULT_FILTERS)).toEqual({ all: 4, personal: 2, team: 2 });
  });

  it('reflects the active state filter so a tab never promises rows it will not show', () => {
    const counts = countByOwner(flows, { ...DEFAULT_FILTERS, state: 'Started' });

    expect(counts).toEqual({ all: 2, personal: 1, team: 1 });
    expect(filterFlows(flows, { ...DEFAULT_FILTERS, state: 'Started', owner: 'team' })).toHaveLength(
      counts.team
    );
  });

  it('reflects the active search term', () => {
    expect(countByOwner(flows, { ...DEFAULT_FILTERS, search: 'sync' })).toEqual({
      all: 1,
      personal: 0,
      team: 1,
    });
  });
});

describe('getAvailableStates', () => {
  it('lists the distinct states present, sorted', () => {
    expect(getAvailableStates(flows)).toEqual(['Started', 'Stopped', 'Suspended']);
  });

  it('ignores flows with no state', () => {
    expect(getAvailableStates([flow({ id: 'a', state: undefined })])).toEqual([]);
  });
});

describe('hasKnownOwners', () => {
  it('is true when any flow has a real scope', () => {
    expect(hasKnownOwners(flows)).toBe(true);
  });

  it('is false when every flow came from the unfiltered fallback', () => {
    expect(hasKnownOwners([flow({ id: 'a', scope: 'unknown' })])).toBe(false);
  });
});

describe('ANY_STATE', () => {
  it('is the default so nothing is filtered out before the user picks a status', () => {
    expect(DEFAULT_FILTERS.state).toBe(ANY_STATE);
    expect(filterFlows(flows, DEFAULT_FILTERS)).toHaveLength(flows.length);
  });
});
