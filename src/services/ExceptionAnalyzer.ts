// ExceptionAnalyzer - Analyzes Power Automate flows for exception handling patterns
// Ported from AutoReview extension's exception generator

import { FlowAction, FlowAnalysisResult } from './FlowAnalyzer';

export interface ExceptionIssue {
  area: string;
  value: string;
  level: 'fail' | 'warning' | 'info';
  reason: string;
}

export interface ExceptionAnalysisResult {
  hasMainScope: boolean;
  hasExceptionScope: boolean;
  hasTerminateInException: boolean;
  mainScopeName: string | null;
  exceptionScopeName: string | null;
  exceptionHandlerCount: number;
  actionsWithoutErrorHandling: FlowAction[];
  actionsWithErrorHandling: FlowAction[];
  scopeStructure: ScopeInfo[];
  issues: ExceptionIssue[];
  score: number; // 0-100 exception handling score
}

export interface ScopeInfo {
  name: string;
  type: 'main' | 'exception' | 'catch' | 'finally' | 'regular';
  hasRunAfterFailed: boolean;
  containsTerminate: boolean;
  nestedLevel: number;
  actionCount: number;
  childScopes: string[];
}

export class ExceptionAnalyzer {
  /**
   * Analyze exception handling patterns in a flow
   */
  analyze(analysisResult: FlowAnalysisResult): ExceptionAnalysisResult {
    const actions = analysisResult.actions;
    const issues: ExceptionIssue[] = [];

    // Find scopes
    const scopes = this.analyzeScopes(actions);

    // Find main scope
    const mainScope = scopes.find(s => s.type === 'main');
    const hasMainScope = !!mainScope;

    // Find exception/catch scope
    const exceptionScope = scopes.find(s => s.type === 'exception' || s.type === 'catch');
    const hasExceptionScope = !!exceptionScope;

    // Check if exception scope has Terminate action
    const hasTerminateInException = this.checkTerminateInExceptionScope(actions, exceptionScope);

    // Count actions with error handling
    const actionsWithErrorHandling = actions.filter(a => a.exception === 'Yes');
    const actionsWithoutErrorHandling = actions.filter(a =>
      a.exception !== 'Yes' &&
      a.Type !== 'Scope' &&
      a.Type !== 'Terminate' &&
      a.nested === 0 // Only top-level actions
    );

    // Generate issues
    this.generateIssues(
      issues,
      hasMainScope,
      hasExceptionScope,
      hasTerminateInException,
      actionsWithoutErrorHandling,
      scopes,
      analysisResult
    );

    // Calculate exception handling score
    const score = this.calculateScore(
      hasMainScope,
      hasExceptionScope,
      hasTerminateInException,
      actionsWithErrorHandling.length,
      actions.length
    );

    return {
      hasMainScope,
      hasExceptionScope,
      hasTerminateInException,
      mainScopeName: mainScope?.name || null,
      exceptionScopeName: exceptionScope?.name || null,
      exceptionHandlerCount: actionsWithErrorHandling.length,
      actionsWithoutErrorHandling,
      actionsWithErrorHandling,
      scopeStructure: scopes,
      issues,
      score,
    };
  }

  /**
   * Analyze scope structure in the flow
   */
  private analyzeScopes(actions: FlowAction[]): ScopeInfo[] {
    const scopes: ScopeInfo[] = [];

    for (const action of actions) {
      if (action.Type === 'Scope') {
        const name = action.Name.toLowerCase();
        let type: ScopeInfo['type'] = 'regular';

        if (name.includes('main') || name.includes('try')) {
          type = 'main';
        } else if (name.includes('exception') || name.includes('error')) {
          type = 'exception';
        } else if (name.includes('catch')) {
          type = 'catch';
        } else if (name.includes('finally')) {
          type = 'finally';
        }

        // Check if this scope runs after failed
        const hasRunAfterFailed = this.checkRunAfterFailed(action);

        // Check if this scope contains Terminate
        const containsTerminate = this.checkContainsTerminate(actions, action.Name);

        // Count actions in this scope
        const actionCount = actions.filter(a => a.parent === action.Name).length;

        // Find child scopes
        const childScopes = actions
          .filter(a => a.Type === 'Scope' && a.parent === action.Name)
          .map(a => a.Name);

        scopes.push({
          name: action.Name,
          type,
          hasRunAfterFailed,
          containsTerminate,
          nestedLevel: action.nested,
          actionCount,
          childScopes,
        });
      }
    }

    return scopes;
  }

  /**
   * Check if an action has runAfter with Failed status
   */
  private checkRunAfterFailed(action: FlowAction): boolean {
    try {
      if (action.object) {
        const obj = JSON.parse(action.object);
        const runAfter = obj.runAfter || {};
        for (const status of Object.values(runAfter)) {
          if (Array.isArray(status) && (status.includes('Failed') || status.includes('TimedOut'))) {
            return true;
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
    return false;
  }

  /**
   * Check if a scope contains a Terminate action
   */
  private checkContainsTerminate(actions: FlowAction[], scopeName: string): boolean {
    return actions.some(a =>
      a.Type === 'Terminate' &&
      (a.parent === scopeName || a.parent.startsWith(scopeName + '/'))
    );
  }

  /**
   * Check if there's a Terminate in the exception scope
   */
  private checkTerminateInExceptionScope(
    actions: FlowAction[],
    exceptionScope: ScopeInfo | undefined
  ): boolean {
    if (!exceptionScope) return false;

    return actions.some(a =>
      a.Type === 'Terminate' &&
      (a.parent === exceptionScope.name || a.parent.startsWith(exceptionScope.name + '/'))
    );
  }

  /**
   * Generate exception handling issues
   */
  private generateIssues(
    issues: ExceptionIssue[],
    hasMainScope: boolean,
    hasExceptionScope: boolean,
    hasTerminateInException: boolean,
    actionsWithoutErrorHandling: FlowAction[],
    scopes: ScopeInfo[],
    analysisResult: FlowAnalysisResult
  ): void {
    // Check for Main scope
    if (!hasMainScope) {
      issues.push({
        area: 'Scope Structure',
        value: 'Missing Main/Try Scope',
        level: 'fail',
        reason: 'Flow should have a main scope (named "Main" or "Try") to contain all business logic'
      });
    }

    // Check for Exception scope
    if (!hasExceptionScope) {
      issues.push({
        area: 'Exception Handling',
        value: 'Missing Exception Scope',
        level: 'fail',
        reason: 'Flow should have an exception handling scope (named "Exception", "Catch", or "Error") with runAfter: Failed'
      });
    }

    // Check for Terminate in exception scope
    if (hasExceptionScope && !hasTerminateInException) {
      issues.push({
        area: 'Exception Handling',
        value: 'Missing Terminate Action',
        level: 'warning',
        reason: 'Exception scope should contain a Terminate action to properly end the flow on error'
      });
    }

    // Check exception scope runs after Main scope
    const exceptionScope = scopes.find(s => s.type === 'exception' || s.type === 'catch');
    if (exceptionScope && !exceptionScope.hasRunAfterFailed) {
      issues.push({
        area: 'Exception Handling',
        value: 'Exception Scope Configuration',
        level: 'warning',
        reason: 'Exception scope should have runAfter set to Failed on the Main scope'
      });
    }

    // Check for Get Items without filter
    const getItemsActions = analysisResult.actions.filter(
      a => a.Type === 'OpenApiConnection' &&
        (a.step.includes('GetItems') || a.Name.toLowerCase().includes('get items'))
    );

    for (const action of getItemsActions) {
      if (!action.filter) {
        issues.push({
          area: 'Performance',
          value: action.Name,
          level: 'warning',
          reason: 'GetItems action should have a filter to limit results'
        });
      }
      if (action.pagination === 'No') {
        issues.push({
          area: 'Performance',
          value: action.Name,
          level: 'info',
          reason: 'Consider enabling pagination for large lists'
        });
      }
    }

    // Check for unused variables
    const unusedVars = analysisResult.variables.filter(v => !v.used);
    for (const variable of unusedVars) {
      issues.push({
        area: 'Variables',
        value: variable.Name,
        level: 'warning',
        reason: 'Variable is initialized but never used'
      });
    }

    // Check for naming convention violations
    const badlyNamedVars = analysisResult.variables.filter(v => !v.named);
    for (const variable of badlyNamedVars) {
      issues.push({
        area: 'Naming Convention',
        value: variable.Name,
        level: 'info',
        reason: `Variable should follow naming convention (prefix with type indicator)`
      });
    }

    // Check compose count
    if (analysisResult.composesCount > 2) {
      issues.push({
        area: 'Best Practice',
        value: `${analysisResult.composesCount} Compose actions`,
        level: 'warning',
        reason: 'Consider reducing the number of Compose actions. Use variables or inline expressions instead.'
      });
    }
  }

  /**
   * Calculate exception handling score (0-100)
   */
  private calculateScore(
    hasMainScope: boolean,
    hasExceptionScope: boolean,
    hasTerminateInException: boolean,
    errorHandlerCount: number,
    totalActions: number
  ): number {
    let score = 0;

    // Main scope: 30 points
    if (hasMainScope) {
      score += 30;
    }

    // Exception scope: 30 points
    if (hasExceptionScope) {
      score += 30;
    }

    // Terminate in exception: 20 points
    if (hasTerminateInException) {
      score += 20;
    }

    // Error handlers: up to 20 points based on coverage
    if (totalActions > 0) {
      const coverage = Math.min(1, errorHandlerCount / (totalActions * 0.3)); // Expect 30% of actions to have handlers
      score += Math.round(coverage * 20);
    }

    return Math.min(100, score);
  }

  /**
   * Get severity color for an issue level
   */
  static getIssueLevelColor(level: ExceptionIssue['level']): string {
    switch (level) {
      case 'fail':
        return '#d13438'; // Red
      case 'warning':
        return '#ff8c00'; // Orange
      case 'info':
        return '#0078d4'; // Blue
      default:
        return '#323130';
    }
  }

  /**
   * Get score color
   */
  static getScoreColor(score: number): string {
    if (score >= 80) return '#107c10'; // Green
    if (score >= 50) return '#ff8c00'; // Orange
    return '#d13438'; // Red
  }
}

export default ExceptionAnalyzer;
