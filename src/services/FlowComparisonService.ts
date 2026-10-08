// FlowComparisonService - Compare two flow definitions and identify differences
// Uses deep-diff library for structural comparison

import { diff, Diff } from 'deep-diff';

export interface FlowDifference {
  kind: 'N' | 'D' | 'E' | 'A'; // New, Deleted, Edited, Array
  path: string[];
  pathString: string;
  lhs?: any; // Left-hand-side (original) value
  rhs?: any; // Right-hand-side (new) value
  index?: number; // For array changes
  item?: Diff<any, any>; // Nested change for arrays
}

export interface FlowComparisonResult {
  hasDifferences: boolean;
  totalDifferences: number;
  differences: FlowDifference[];
  newItems: FlowDifference[];
  deletedItems: FlowDifference[];
  editedItems: FlowDifference[];
  arrayChanges: FlowDifference[];
  summary: {
    actionsAdded: number;
    actionsRemoved: number;
    actionsModified: number;
    variablesChanged: number;
    connectionsChanged: number;
    otherChanges: number;
  };
}

/** A flow definition kept for later comparison, scoped to one flow in one environment. */
export interface FlowBaseline {
  envId: string;
  flowId: string;
  flowName?: string;
  /** Optional user label, e.g. "Before refactor". */
  label?: string;
  /** ISO timestamp. */
  savedAt: string;
  /** Normalised flow (see normalizeFlow). */
  definition: any;
}

/** Async key/value storage, so chrome.storage and localStorage look the same. */
export interface BaselineStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** chrome.storage.local when running as the extension (larger quota, shared across tabs). */
export function chromeBaselineStore(area: chrome.storage.StorageArea): BaselineStore {
  const call = <T>(fn: (done: (result?: T) => void) => void) =>
    new Promise<T | undefined>((resolve, reject) => {
      fn((result?: T) => {
        const error = chrome.runtime?.lastError;
        if (error) reject(new Error(error.message || 'Storage error'));
        else resolve(result);
      });
    });
  return {
    async get(key) {
      const result = await call<Record<string, unknown>>((done) => area.get(key, done));
      return result ? result[key] : undefined;
    },
    async set(key, value) {
      await call((done) => area.set({ [key]: value }, () => done()));
    },
    async remove(key) {
      await call((done) => area.remove(key, () => done()));
    },
  };
}

export function localBaselineStore(storage: Storage = window.localStorage): BaselineStore {
  return {
    async get(key) {
      const raw = storage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    },
    async set(key, value) {
      // setItem throws QuotaExceededError for very large flows; let it reach the UI.
      storage.setItem(key, JSON.stringify(value));
    },
    async remove(key) {
      storage.removeItem(key);
    },
  };
}

export function createBaselineStore(): BaselineStore {
  const area = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  return area ? chromeBaselineStore(area) : localBaselineStore();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class FlowComparisonService {
  constructor(private readonly store: BaselineStore = createBaselineStore()) {}

  static baselineKey(envId: string, flowId: string): string {
    return `flowBaseline:${envId}:${flowId}`;
  }

  /** "3 Oct 14:02" in local time. */
  static formatSavedAt(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return 'at an unknown time';
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    return date.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${day} ${date.getFullYear()} ${time}`;
  }

  async getBaseline(envId: string, flowId: string): Promise<FlowBaseline | null> {
    const value = await this.store.get(FlowComparisonService.baselineKey(envId, flowId));
    if (!value || typeof value !== 'object' || !(value as FlowBaseline).savedAt) return null;
    return value as FlowBaseline;
  }

  async saveBaseline(
    envId: string,
    flowId: string,
    flowDefinition: any,
    meta: { flowName?: string; label?: string; now?: Date } = {}
  ): Promise<FlowBaseline> {
    const baseline: FlowBaseline = {
      envId,
      flowId,
      flowName: meta.flowName,
      label: meta.label?.trim() || undefined,
      savedAt: (meta.now || new Date()).toISOString(),
      definition: this.normalizeFlow(flowDefinition),
    };
    await this.store.set(FlowComparisonService.baselineKey(envId, flowId), baseline);
    return baseline;
  }

  async clearBaseline(envId: string, flowId: string): Promise<void> {
    await this.store.remove(FlowComparisonService.baselineKey(envId, flowId));
  }

  /**
   * Compare two flow definitions
   */
  compare(originalFlow: any, newFlow: any): FlowComparisonResult {
    const normalizedOriginal = this.normalizeFlow(originalFlow);
    const normalizedNew = this.normalizeFlow(newFlow);

    const differences = diff(normalizedOriginal, normalizedNew) || [];

    const mappedDifferences: FlowDifference[] = differences.map((d) => ({
      kind: d.kind,
      path: d.path || [],
      pathString: (d.path || []).join('.'),
      lhs: 'lhs' in d ? d.lhs : undefined,
      rhs: 'rhs' in d ? d.rhs : undefined,
      index: 'index' in d ? d.index : undefined,
      item: 'item' in d ? d.item : undefined,
    }));

    const newItems = mappedDifferences.filter((d) => d.kind === 'N');
    const deletedItems = mappedDifferences.filter((d) => d.kind === 'D');
    const editedItems = mappedDifferences.filter((d) => d.kind === 'E');
    const arrayChanges = mappedDifferences.filter((d) => d.kind === 'A');

    // Calculate summary
    const summary = this.calculateSummary(mappedDifferences);

    return {
      hasDifferences: mappedDifferences.length > 0,
      totalDifferences: mappedDifferences.length,
      differences: mappedDifferences,
      newItems,
      deletedItems,
      editedItems,
      arrayChanges,
      summary,
    };
  }

  /** Compare a flow against a stored baseline (baseline on the left). */
  compareWithBaseline(baseline: FlowBaseline, newFlow: any): FlowComparisonResult {
    return this.compare(baseline.definition, newFlow);
  }

  /**
   * Normalize flow for comparison (remove non-essential fields)
   */
  private normalizeFlow(flow: any): any {
    if (!flow) return {};

    // Deep clone to avoid modifying original
    const normalized = JSON.parse(JSON.stringify(flow));

    // Remove metadata that changes frequently
    this.removeNonEssentialFields(normalized);

    return normalized;
  }

  /**
   * Remove non-essential fields that change frequently
   */
  private removeNonEssentialFields(obj: any, path: string[] = []): void {
    if (!obj || typeof obj !== 'object') return;

    // Fields to remove
    const fieldsToRemove = [
      'metadata',
      '$schema',
      'contentVersion',
      'parameters',
      'connectionReferences', // Often has environment-specific data
    ];

    for (const key of Object.keys(obj)) {
      if (fieldsToRemove.includes(key) && path.length === 0) {
        delete obj[key];
      } else if (Array.isArray(obj[key])) {
        obj[key].forEach((item: any) => this.removeNonEssentialFields(item, [...path, key]));
      } else if (typeof obj[key] === 'object') {
        this.removeNonEssentialFields(obj[key], [...path, key]);
      }
    }
  }

  /**
   * Calculate summary statistics for differences
   */
  private calculateSummary(differences: FlowDifference[]): FlowComparisonResult['summary'] {
    const summary = {
      actionsAdded: 0,
      actionsRemoved: 0,
      actionsModified: 0,
      variablesChanged: 0,
      connectionsChanged: 0,
      otherChanges: 0,
    };

    for (const diff of differences) {
      const pathString = diff.pathString.toLowerCase();

      if (pathString.includes('actions') || pathString.includes('definition.actions')) {
        if (diff.kind === 'N') {
          summary.actionsAdded++;
        } else if (diff.kind === 'D') {
          summary.actionsRemoved++;
        } else {
          summary.actionsModified++;
        }
      } else if (
        pathString.includes('variable') ||
        pathString.includes('initializevariable')
      ) {
        summary.variablesChanged++;
      } else if (
        pathString.includes('connection') ||
        pathString.includes('apiconnection')
      ) {
        summary.connectionsChanged++;
      } else {
        summary.otherChanges++;
      }
    }

    return summary;
  }

  /**
   * Get a human-readable description of a difference
   */
  static getDifferenceDescription(diff: FlowDifference): string {
    const path = diff.pathString || 'root';

    switch (diff.kind) {
      case 'N':
        return `Added: ${path}`;
      case 'D':
        return `Removed: ${path}`;
      case 'E':
        return `Changed: ${path}`;
      case 'A':
        return `Array modified: ${path}[${diff.index}]`;
      default:
        return `Modified: ${path}`;
    }
  }

  /**
   * Get color for difference kind
   */
  static getDifferenceColor(kind: FlowDifference['kind']): string {
    switch (kind) {
      case 'N':
        return 'var(--color-success)';
      case 'D':
        return 'var(--color-danger)';
      case 'E':
        return 'var(--color-fg)';
      case 'A':
        return 'var(--color-info)';
      default:
        return 'var(--color-fg)';
    }
  }

  /**
   * Get label for difference kind
   */
  static getDifferenceLabel(kind: FlowDifference['kind']): string {
    switch (kind) {
      case 'N':
        return 'Added';
      case 'D':
        return 'Removed';
      case 'E':
        return 'Changed';
      case 'A':
        return 'Array Modified';
      default:
        return 'Modified';
    }
  }
}

export default FlowComparisonService;
