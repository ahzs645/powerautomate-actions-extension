import { FlowSummary } from './flowsApi';

export type OwnerTab = 'all' | 'personal' | 'team';

/** Sentinel used by the state dropdown for "don't filter on state at all". */
export const ANY_STATE = '__all__';

export interface FlowFilters {
  search: string;
  owner: OwnerTab;
  state: string;
}

export const DEFAULT_FILTERS: FlowFilters = {
  search: '',
  owner: 'all',
  state: ANY_STATE,
};

/**
 * Flows whose listing did not tell us the owner ('unknown' scope) come from the
 * unfiltered fallback endpoint. They stay visible under every owner tab rather
 * than silently disappearing when someone picks one.
 */
function matchesOwner(flow: FlowSummary, owner: OwnerTab): boolean {
  return owner === 'all' || flow.scope === owner || flow.scope === 'unknown';
}

function matchesState(flow: FlowSummary, state: string): boolean {
  return state === ANY_STATE || (flow.state || '') === state;
}

function matchesSearch(flow: FlowSummary, search: string): boolean {
  const term = search.trim().toLowerCase();
  return !term || flow.displayName.toLowerCase().includes(term);
}

export function filterFlows(flows: FlowSummary[], filters: FlowFilters): FlowSummary[] {
  return flows.filter(
    (flow) =>
      matchesOwner(flow, filters.owner) &&
      matchesState(flow, filters.state) &&
      matchesSearch(flow, filters.search)
  );
}

/** Tab counts respect the state and search filters, so a tab never promises rows it won't show. */
export function countByOwner(
  flows: FlowSummary[],
  filters: FlowFilters
): Record<OwnerTab, number> {
  const narrowed = flows.filter(
    (flow) => matchesState(flow, filters.state) && matchesSearch(flow, filters.search)
  );

  return {
    all: narrowed.length,
    personal: narrowed.filter((flow) => matchesOwner(flow, 'personal')).length,
    team: narrowed.filter((flow) => matchesOwner(flow, 'team')).length,
  };
}

/** The distinct states actually present, so the dropdown never offers an empty filter. */
export function getAvailableStates(flows: FlowSummary[]): string[] {
  const states = new Set<string>();
  flows.forEach((flow) => {
    if (flow.state) {
      states.add(flow.state);
    }
  });
  return Array.from(states).sort();
}

/** Owner tabs are pointless when the fallback endpoint gave us no ownership at all. */
export function hasKnownOwners(flows: FlowSummary[]): boolean {
  return flows.some((flow) => flow.scope === 'personal' || flow.scope === 'team');
}
