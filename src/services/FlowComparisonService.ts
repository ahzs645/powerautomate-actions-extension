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

const COMPARISON_STORAGE_KEY = 'flowComparisonBase';

export class FlowComparisonService {
  /**
   * Store a flow definition for comparison
   */
  storeFlowForComparison(flowDefinition: any): void {
    try {
      const normalized = this.normalizeFlow(flowDefinition);
      localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.error('Error storing flow for comparison:', error);
    }
  }

  /**
   * Check if a flow is stored for comparison
   */
  hasStoredFlow(): boolean {
    return localStorage.getItem(COMPARISON_STORAGE_KEY) !== null;
  }

  /**
   * Get the stored flow definition
   */
  getStoredFlow(): any | null {
    try {
      const stored = localStorage.getItem(COMPARISON_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  /**
   * Clear the stored flow
   */
  clearStoredFlow(): void {
    localStorage.removeItem(COMPARISON_STORAGE_KEY);
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

  /**
   * Compare current flow with stored flow
   */
  compareWithStored(newFlow: any): FlowComparisonResult | null {
    const storedFlow = this.getStoredFlow();
    if (!storedFlow) {
      return null;
    }
    return this.compare(storedFlow, newFlow);
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
        return '#107c10'; // Green - new
      case 'D':
        return '#d13438'; // Red - deleted
      case 'E':
        return '#ff8c00'; // Orange - edited
      case 'A':
        return '#0078d4'; // Blue - array change
      default:
        return '#323130';
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
