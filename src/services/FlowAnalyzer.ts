// FlowAnalyzer - Ported from AutoReview-PWA
// Analyzes Power Automate flow definitions for complexity, quality scoring, and generates reports

import {
  IAnalysisConfig,
  IRatingThresholds,
  defaultAnalysisConfig,
  getNamingConventionMap,
  getComplexityMap,
  getScoringRuleValue,
} from '../config/AnalysisConfig';
import { getConnectorService } from './ConnectorService';

export interface FlowAction {
  Name: string;
  Type: string;
  step: string;
  id: string;
  hasId: string;
  tier: string;
  connector: string;
  imgURL: string;
  brandColor: string;
  runAfter: string;
  /** runAfter with its statuses preserved, e.g. { Look_up_the_site: ['Failed', 'TimedOut'] }.
   *  `runAfter` flattens to names only, which loses the failure paths the diagram needs. */
  runAfterDetail: Record<string, string[]>;
  exception: string;
  index: number;
  Complexity: number;
  detail: string;
  filter: string;
  pagination: string;
  secure: string;
  retry: string;
  timeout: string;
  positionInfo: string;
  position: string;
  notes: string;
  parent: string;
  /** Which branch of the parent this action sits in: '' for a plain scope/If-true branch,
   *  'else' for the If false branch, or the case name for a Switch. */
  branch: string;
  positionIndex: string;
  positionType: string;
  nested: number;
  object?: string;
}

export interface FlowVariable {
  Name: string;
  Type: string;
  value: string;
  used: boolean;
  named: boolean;
  local: boolean;
}

export interface FlowConnection {
  conName: string;
  appId: string;
  opId: string;
  count: number;
}

export interface FlowTrigger {
  name: string;
  type: string;
  connector: string;
  /** Connector branding from connectionReferences, same as an action's. */
  imgURL?: string;
  brandColor?: string;
  recurrence?: string;
  inputs?: any;
  // Enhanced trigger details
  kind?: string;
  description?: string;
  conditions?: string;
  splitOn?: string;
  operationId?: string;
  parameters?: string;
  schema?: string;
  method?: string;
  relativePath?: string;
}

/** One line of the overall rating: what was measured and the points it earned. */
export interface RatingFactor {
  key: string;
  label: string;
  /** Short reason, e.g. "23 (green up to 50)". */
  detail: string;
  points: number;
  max: number;
}

export interface FlowAnalysisResult {
  name: string;
  id: string;
  owner: string;
  date: string;
  complexity: number;
  actionCount: number;
  variableCount: number;
  exceptionCount: number;
  overallRating: number;
  trigger: FlowTrigger;
  actions: FlowAction[];
  variables: FlowVariable[];
  connections: FlowConnection[];
  errors: string[];
  warnings: string[];
  hasMainScope: boolean;
  hasExceptionScope: boolean;
  variableNamingScore: number;
  composesCount: number;
  /** How overallRating was reached; overallRating = round(100 * points / max). */
  ratingBreakdown?: RatingFactor[];
}

// Saved flow analysis for persistence
export interface SavedFlowAnalysis {
  flowDefinition: string;  // Original JSON definition
  flowName: string;
  flowId?: string;
  analysisResult: FlowAnalysisResult;
  savedAt: string;  // ISO timestamp
}

// Note: Complexity ratings, thresholds, scoring config, and naming conventions
// are now loaded from IAnalysisConfig passed to the FlowAnalyzer constructor

export class FlowAnalyzer {
  private definition: any;
  private actions: FlowAction[] = [];
  private variables: FlowVariable[] = [];
  private connections: FlowConnection[] = [];
  private errors: string[] = [];
  private warnings: string[] = [];
  private connectionRefs: Record<string, any> = {};

  // Configuration
  private config: IAnalysisConfig;
  private complexityMap: Record<string, number>;
  private namingConventionMap: Record<string, string>;

  constructor(config?: IAnalysisConfig) {
    this.config = config || defaultAnalysisConfig;
    this.complexityMap = getComplexityMap(this.config.complexityRules);
    this.namingConventionMap = getNamingConventionMap(this.config.namingConfig);
  }

  // Getter for configuration (useful for UI components)
  getConfig(): IAnalysisConfig {
    return this.config;
  }

  // Update configuration
  setConfig(config: IAnalysisConfig): void {
    this.config = config;
    this.complexityMap = getComplexityMap(this.config.complexityRules);
    this.namingConventionMap = getNamingConventionMap(this.config.namingConfig);
  }

  analyze(flowDefinition: any, flowName?: string, flowId?: string): FlowAnalysisResult {
    this.reset();

    try {
      // Handle different input formats
      if (typeof flowDefinition === 'string') {
        this.definition = JSON.parse(flowDefinition);
      } else {
        this.definition = flowDefinition;
      }

      // Extract definition if wrapped
      let def = this.definition;
      if (def.definition) {
        def = def.definition;
      }

      // Connector branding is needed while walking the actions, so resolve it first
      this.connectionRefs = this.definition.connectionReferences || {};

      // Analyze trigger
      const trigger = this.analyzeTrigger(def.triggers || def.$trigger);

      // Analyze actions recursively
      this.analyzeActions(def.actions || {}, '', 0);

      // Analyze variables
      this.extractVariables(def.actions || {});

      // Analyze connection references
      this.extractConnections(this.definition.connectionReferences || {});

      // Calculate scores
      const complexity = this.calculateComplexity();
      const { hasMainScope, hasExceptionScope } = this.checkScopes();
      const variableNamingScore = this.calculateVariableNamingScore();
      const composesCount = this.actions.filter(a => a.Type === 'Compose').length;
      const ratingBreakdown = this.calculateRatingBreakdown(
        complexity,
        this.actions.length,
        this.variables.length,
        hasMainScope,
        hasExceptionScope,
        variableNamingScore,
        composesCount
      );
      const overallRating = FlowAnalyzer.ratingFromBreakdown(ratingBreakdown);

      return {
        name: flowName || def.contentVersion || 'Unknown Flow',
        id: flowId || '',
        owner: 'Unknown',
        date: new Date().toISOString(),
        complexity,
        actionCount: this.actions.length,
        variableCount: this.variables.length,
        exceptionCount: this.countExceptionHandlers(),
        overallRating,
        trigger,
        actions: this.actions,
        variables: this.variables,
        connections: this.connections,
        errors: this.errors,
        warnings: this.warnings,
        hasMainScope,
        hasExceptionScope,
        variableNamingScore,
        composesCount,
        ratingBreakdown,
      };
    } catch (error) {
      this.errors.push(`Analysis error: ${error instanceof Error ? error.message : String(error)}`);
      return this.getEmptyResult(flowName, flowId);
    }
  }

  private reset(): void {
    this.definition = null;
    this.actions = [];
    this.variables = [];
    this.connections = [];
    this.errors = [];
    this.warnings = [];
    this.connectionRefs = {};
  }

  private getEmptyResult(name?: string, id?: string): FlowAnalysisResult {
    return {
      name: name || 'Unknown',
      id: id || '',
      owner: 'Unknown',
      date: new Date().toISOString(),
      complexity: 0,
      actionCount: 0,
      variableCount: 0,
      exceptionCount: 0,
      overallRating: 0,
      trigger: { name: 'Unknown', type: 'Unknown', connector: 'Unknown' },
      actions: [],
      variables: [],
      connections: [],
      errors: this.errors,
      warnings: this.warnings,
      hasMainScope: false,
      hasExceptionScope: false,
      variableNamingScore: 0,
      composesCount: 0,
    };
  }

  private analyzeTrigger(triggers: any): FlowTrigger {
    if (!triggers) {
      return { name: 'Unknown', type: 'Unknown', connector: 'Unknown' };
    }

    const triggerNames = Object.keys(triggers);
    if (triggerNames.length === 0) {
      return { name: 'Unknown', type: 'Unknown', connector: 'Unknown' };
    }

    const triggerName = triggerNames[0];
    const trigger = triggers[triggerName];
    const triggerBranding = this.getConnectorBranding(trigger);

    // Extract connector info
    let connector = 'Unknown';
    if (trigger.inputs?.host?.apiId) {
      const apiId = trigger.inputs.host.apiId;
      const match = apiId.match(/Microsoft\.PowerApps\/apis\/(.+)/);
      connector = match ? match[1] : apiId;
    } else if (trigger.inputs?.host?.connectionName) {
      connector = trigger.inputs.host.connectionName;
    }

    // Extract conditions
    let conditions: string | undefined;
    if (trigger.conditions && Array.isArray(trigger.conditions)) {
      conditions = trigger.conditions
        .map((c: any) => c.expression || JSON.stringify(c))
        .join(', ');
    }

    // Extract schema for Request triggers
    let schema: string | undefined;
    if (trigger.inputs?.schema) {
      schema = JSON.stringify(trigger.inputs.schema, null, 2);
    }

    // Extract operation details for API triggers
    const operationId = trigger.inputs?.host?.operationId;
    const parameters = trigger.inputs?.parameters
      ? JSON.stringify(trigger.inputs.parameters, null, 2)
      : undefined;

    return {
      name: triggerName,
      type: trigger.type || 'Unknown',
      connector,
      recurrence: trigger.recurrence ? JSON.stringify(trigger.recurrence, null, 2) : undefined,
      inputs: trigger.inputs,
      kind: trigger.kind,
      description: trigger.description,
      conditions,
      splitOn: trigger.splitOn,
      operationId,
      parameters,
      schema,
      method: trigger.inputs?.method,
      relativePath: trigger.inputs?.relativePath,
      imgURL: triggerBranding.iconUri,
      brandColor: triggerBranding.brandColor,
    };
  }

  private analyzeActions(actions: any, parent: string, nestLevel: number, branch: string = ''): void {
    if (!actions || typeof actions !== 'object') return;

    let index = 0;
    for (const [actionName, actionDef] of Object.entries(actions)) {
      const action = actionDef as any;
      const actionType = action.type || 'Unknown';

      // Get complexity for this action type
      const complexityKey = this.getComplexityKey(actionType, action);
      const complexity = this.complexityMap[complexityKey] || this.complexityMap[actionType] || 1;

      // Extract run after
      const runAfter = action.runAfter
        ? Object.keys(action.runAfter).join(', ')
        : '';
      const runAfterDetail = this.normalizeRunAfter(action.runAfter);
      const branding = this.getConnectorBranding(action);

      // Check for exception handling
      const hasExceptionHandling = this.hasExceptionHandling(action);

      // Build action record
      const flowAction: FlowAction = {
        Name: actionName,
        Type: actionType,
        step: `${nestLevel}.${index}`,
        id: action.metadata?.operationMetadataId || '',
        hasId: action.metadata?.operationMetadataId ? 'Yes' : 'No',
        tier: this.getActionTier(action),
        connector: this.getConnector(action),
        imgURL: branding.iconUri,
        brandColor: branding.brandColor,
        runAfter,
        runAfterDetail,
        exception: hasExceptionHandling ? 'Yes' : 'No',
        index,
        Complexity: complexity,
        detail: this.getActionDetail(action),
        filter: this.getFilter(action),
        pagination: action.runtimeConfiguration?.paginationPolicy ? 'Yes' : 'No',
        secure: this.hasSecureInputs(action) ? 'Yes' : 'No',
        retry: action.runtimeConfiguration?.retryPolicy ? JSON.stringify(action.runtimeConfiguration.retryPolicy) : 'Default',
        timeout: action.limit?.timeout || 'Default',
        positionInfo: parent ? 'Nested' : 'Root',
        position: runAfter || 'First',
        notes: this.getActionNotes(action),
        parent,
        branch,
        positionIndex: String(index),
        positionType: actionType,
        nested: nestLevel,
        object: JSON.stringify(action),
      };

      this.actions.push(flowAction);
      index++;

      // Recursively analyze nested actions
      if (action.actions) {
        this.analyzeActions(action.actions, actionName, nestLevel + 1);
      }
      if (action.else?.actions) {
        this.analyzeActions(action.else.actions, actionName, nestLevel + 1, 'else');
      }
      if (action.cases) {
        for (const [caseName, caseDef] of Object.entries(action.cases)) {
          const caseActions = (caseDef as any).actions;
          if (caseActions) {
            this.analyzeActions(caseActions, `${actionName}/${caseName}`, nestLevel + 1, caseName);
          }
        }
      }
      if (action.default?.actions) {
        this.analyzeActions(action.default.actions, `${actionName}/default`, nestLevel + 1, 'default');
      }
    }
  }

  private getComplexityKey(type: string, action: any): string {
    const connector = this.getConnector(action);
    const operationId = action.inputs?.host?.operationId || '';

    // Try specific connector+operation combination first
    const specificKey = `${operationId}${connector}`;
    if (this.complexityMap[specificKey]) {
      return specificKey;
    }

    return type;
  }

  private getActionTier(action: any): string {
    // Use ConnectorService for accurate tier detection
    const connector = this.getConnector(action);
    const connectorService = getConnectorService();
    const tier = connectorService.getConnectorTier(connector);

    if (tier !== 'Unknown') {
      return tier;
    }

    // Fallback to type-based detection
    const type = action.type || '';
    if (type.includes('Http') || type === 'Http' || type === 'HttpWebhook') {
      return 'Premium';
    }
    return 'Standard';
  }

  private getConnector(action: any): string {
    if (action.inputs?.host?.apiId) {
      const apiId = action.inputs.host.apiId;
      const match = apiId.match(/Microsoft\.PowerApps\/apis\/(.+)/);
      return match ? match[1] : apiId;
    }
    if (action.inputs?.host?.connectionName) {
      return action.inputs.host.connectionName;
    }
    return action.type || 'Unknown';
  }

  /** Keep the runAfter statuses so the diagram can tell a success path from a failure path. */
  private normalizeRunAfter(runAfter: any): Record<string, string[]> {
    if (!runAfter || typeof runAfter !== 'object') return {};

    const normalized: Record<string, string[]> = {};
    for (const [name, statuses] of Object.entries(runAfter)) {
      normalized[name] = Array.isArray(statuses)
        ? statuses.map(String)
        : ['Succeeded'];
    }
    return normalized;
  }

  /** Look up the connector's icon and brand colour from the flow's connectionReferences.
   *  Actions reference them by connectionName (e.g. "shared_excelonlinebusiness-1"), which is
   *  the reference key, while apiId carries the unsuffixed connector id - try both. */
  private getConnectorBranding(action: any): { iconUri: string; brandColor: string } {
    const refs = this.connectionRefs || {};
    const candidates = [
      action?.inputs?.host?.connectionName,
      this.getConnector(action),
    ].filter(Boolean) as string[];

    for (const key of candidates) {
      const ref = refs[key];
      if (ref) {
        return { iconUri: ref.iconUri || '', brandColor: ref.brandColor || '' };
      }
    }

    // Fall back to matching on the connector id embedded in the reference's apiName/id.
    const connector = this.getConnector(action);
    for (const ref of Object.values(refs) as any[]) {
      if (ref?.apiName && connector.endsWith(ref.apiName)) {
        return { iconUri: ref.iconUri || '', brandColor: ref.brandColor || '' };
      }
    }

    return { iconUri: '', brandColor: '' };
  }

  private hasExceptionHandling(action: any): boolean {
    const runAfter = action.runAfter || {};
    for (const status of Object.values(runAfter)) {
      if (Array.isArray(status) && (status.includes('Failed') || status.includes('TimedOut'))) {
        return true;
      }
    }
    return false;
  }

  private getActionDetail(action: any): string {
    const details: string[] = [];

    if (action.inputs?.uri) {
      details.push(`URI: ${action.inputs.uri}`);
    }
    if (action.inputs?.path) {
      details.push(`Path: ${action.inputs.path}`);
    }
    if (action.inputs?.method) {
      details.push(`Method: ${action.inputs.method}`);
    }

    return details.join('; ') || '';
  }

  private getFilter(action: any): string {
    if (action.inputs?.parameters?.$filter) {
      return action.inputs.parameters.$filter;
    }
    if (action.inputs?.queries?.$filter) {
      return action.inputs.queries.$filter;
    }
    return '';
  }

  private hasSecureInputs(action: any): boolean {
    return action.runtimeConfiguration?.secureData?.properties?.includes('inputs') || false;
  }

  private getActionNotes(action: any): string {
    const notes: string[] = [];

    if (action.description) {
      notes.push(action.description);
    }
    if (!action.runAfter || Object.keys(action.runAfter).length === 0) {
      notes.push('First action in sequence');
    }

    return notes.join('; ');
  }

  private extractVariables(actions: any): void {
    if (!actions) return;

    for (const [actionName, actionDef] of Object.entries(actions)) {
      const action = actionDef as any;

      if (action.type === 'InitializeVariable') {
        const varName = action.inputs?.variables?.[0]?.name || actionName;
        const varType = action.inputs?.variables?.[0]?.type || 'Unknown';
        const varValue = JSON.stringify(action.inputs?.variables?.[0]?.value || '');

        // Check naming convention
        const expectedPrefix = this.namingConventionMap[varType.toLowerCase()] || '';
        const followsNaming = expectedPrefix ? varName.startsWith(expectedPrefix) : true;

        this.variables.push({
          Name: varName,
          Type: varType,
          value: varValue.substring(0, 500),
          used: this.isVariableUsed(varName),
          named: followsNaming,
          local: false,
        });
      }

      // Recursively check nested actions
      if (action.actions) {
        this.extractVariables(action.actions);
      }
      if (action.else?.actions) {
        this.extractVariables(action.else.actions);
      }
    }
  }

  private isVariableUsed(varName: string): boolean {
    const definitionStr = JSON.stringify(this.definition);
    const pattern = new RegExp(`variables\\(['"]${varName}['"]\\)`, 'g');
    const matches = definitionStr.match(pattern);
    return (matches?.length || 0) > 1; // More than just the initialization
  }

  private extractConnections(connectionRefs: any): void {
    if (!connectionRefs) return;

    const connectionCounts: Record<string, number> = {};

    // Count usage of each connection in actions
    for (const action of this.actions) {
      const connector = action.connector;
      if (connector && connector !== 'Unknown') {
        connectionCounts[connector] = (connectionCounts[connector] || 0) + 1;
      }
    }

    for (const [refName, refDef] of Object.entries(connectionRefs)) {
      const ref = refDef as any;
      this.connections.push({
        conName: refName,
        appId: ref.id || ref.api?.name || '',
        opId: ref.connectionRuntimeUrl || '',
        count: connectionCounts[refName] || 0,
      });
    }
  }

  private calculateComplexity(): number {
    return this.actions.reduce((sum, action) => {
      return sum + (action.Complexity > 0 ? action.Complexity : 0);
    }, 0);
  }

  private checkScopes(): { hasMainScope: boolean; hasExceptionScope: boolean } {
    let hasMainScope = false;
    let hasExceptionScope = false;

    for (const action of this.actions) {
      if (action.Type === 'Scope') {
        const name = action.Name.toLowerCase();
        if (name.includes('main') || name.includes('try')) {
          hasMainScope = true;
        }
        if (name.includes('exception') || name.includes('catch') || name.includes('error')) {
          hasExceptionScope = true;
        }
      }
    }

    return { hasMainScope, hasExceptionScope };
  }

  private calculateVariableNamingScore(): number {
    if (this.variables.length === 0) return 100;

    const namedCount = this.variables.filter(v => v.named).length;
    return Math.round((namedCount / this.variables.length) * 100);
  }

  private countExceptionHandlers(): number {
    return this.actions.filter(a => a.exception === 'Yes').length;
  }

  /**
   * Score each rule from the analysis config in its own category, so one bad
   * category cannot take points from the others, and report every line.
   *
   * The categories and points are the configured scoring rules. The overall
   * rating is the share of available points earned: the previous calculation
   * left the variables/composes/connections base scores out, so the best
   * possible flow topped out at 65% and every rating read as mediocre.
   */
  private calculateRatingBreakdown(
    complexity: number,
    actionCount: number,
    variableCount: number,
    hasMainScope: boolean,
    hasExceptionScope: boolean,
    variableNamingScore: number,
    composesCount: number
  ): RatingFactor[] {
    const scoring = this.config.scoringConfig;
    const t = this.config.ratingThresholds;
    const score = (name: string) => getScoringRuleValue(scoring, name);
    const factors: RatingFactor[] = [];

    const band = (value: number, amber: number, red: number) =>
      value <= amber ? 'Green' : value <= red ? 'Amber' : 'Red';

    const complexityBand = band(complexity, t.complexityAmber, t.complexityRed);
    factors.push({
      key: 'complexity',
      label: 'Complexity',
      detail: `${complexity} (green up to ${t.complexityAmber}, amber up to ${t.complexityRed})`,
      points: score(`complexity${complexityBand}`),
      max: score('complexityGreen'),
    });

    const actionsBand = band(actionCount, t.actionsAmber, t.actionsRed);
    factors.push({
      key: 'actions',
      label: 'Number of actions',
      detail: `${actionCount} (green up to ${t.actionsAmber}, amber up to ${t.actionsRed})`,
      points: score(`actions${actionsBand}`),
      max: score('actionsGreen'),
    });

    factors.push({
      key: 'mainScope',
      label: 'Main / Try scope',
      detail: hasMainScope ? 'Present' : 'Missing - wrap the main logic in a scope named Try or Main',
      points: hasMainScope ? score('mainScope') : 0,
      max: score('mainScope'),
    });

    factors.push({
      key: 'exceptionScope',
      label: 'Catch scope',
      detail: hasExceptionScope ? 'Present' : 'Missing - add a Catch scope that runs after the Try scope fails',
      points: hasExceptionScope ? score('exceptionScope') : 0,
      max: score('exceptionScope'),
    });

    factors.push({
      key: 'varNaming',
      label: 'Variable naming',
      detail: variableCount === 0 ? 'No variables' : `${variableNamingScore}% follow the prefix convention`,
      points: Math.round((variableNamingScore / 100) * score('varNaming')),
      max: score('varNaming'),
    });

    if (variableCount > 0) {
      const allUsed = this.variables.every(v => v.used);
      const unused = this.variables.filter(v => !v.used).length;
      factors.push({
        key: 'varUsed',
        label: 'Variables used',
        detail: allUsed ? 'All variables are used' : `${unused} unused`,
        points: allUsed ? score('varUsed') : 0,
        max: score('varUsed'),
      });
    }

    const deducted = (base: string, min: string, per: string, count: number) =>
      Math.max(0, score(base) - Math.max(0, count - score(min)) * score(per));

    factors.push({
      key: 'variables',
      label: 'Variable count',
      detail: `${variableCount} (−${score('variablesDeduction')} each above ${score('variablesMin')})`,
      points: deducted('variables', 'variablesMin', 'variablesDeduction', variableCount),
      max: score('variables'),
    });

    factors.push({
      key: 'composes',
      label: 'Compose actions',
      detail: `${composesCount} (−${score('composesDeduction')} each above ${score('composesMin')})`,
      points: deducted('composes', 'composesMin', 'composesDeduction', composesCount),
      max: score('composes'),
    });

    const connectionCount = this.connections.length;
    factors.push({
      key: 'connections',
      label: 'Connections',
      detail: `${connectionCount} (−${score('connectionsDeduction')} each above ${score('connectionsMin')})`,
      points: deducted('connections', 'connectionsMin', 'connectionsDeduction', connectionCount),
      max: score('connections'),
    });

    return factors.filter(f => f.max > 0);
  }

  static ratingFromBreakdown(factors: RatingFactor[]): number {
    const max = factors.reduce((sum, f) => sum + f.max, 0);
    if (max <= 0) return 0;
    const points = factors.reduce((sum, f) => sum + Math.min(f.points, f.max), 0);
    return Math.min(100, Math.max(0, Math.round((100 * points) / max)));
  }

  // Generate nomnoml diagram syntax
  generateDiagram(): string {
    let diagram = `#direction: right
#fillArrows: true
#lineWidth: 2
#fill:#569AE5
#background: white
#acyclicer: greedy
#ranker: tight-tree
#.trigger: visual=roundrect fill=#569AE5
#.if: visual=rhomb fill=#2596be
#.switch: visual=ellipse fill=#2596be
#.scope: visual=frame fill=#808080
#.foreach: visual=transceiver fill=#00C1A0
#.until: visual=sender fill=#00C1A0
#.var: visual=input fill=#9925be
#.terminate: visual=receiver fill=#cc4747
#.action: fill=#EBDAF9

`;

    // Build node map and connections
    const nodes: Map<string, string> = new Map();
    const edges: string[] = [];

    for (const action of this.actions) {
      const style = this.getNodeStyle(action.Type);
      const nodeName = action.Name.replace(/[[\]<>|]/g, '_');
      nodes.set(action.Name, `[<${style}>${nodeName}]`);

      if (action.runAfter) {
        const parents = action.runAfter.split(', ').filter(Boolean);
        for (const parent of parents) {
          const parentNode = nodes.get(parent) || `[${parent.replace(/[[\]<>|]/g, '_')}]`;
          edges.push(`${parentNode} -> [<${style}>${nodeName}]`);
        }
      }
    }

    // Add edges to diagram
    for (const edge of edges) {
      diagram += edge + '\n';
    }

    return diagram;
  }

  private getNodeStyle(actionType: string): string {
    const typeMap: Record<string, string> = {
      'If': 'if',
      'Switch': 'switch',
      'Scope': 'scope',
      'Foreach': 'foreach',
      'Until': 'until',
      'Do_until': 'until',
      'InitializeVariable': 'var',
      'SetVariable': 'var',
      'Terminate': 'terminate',
    };
    return typeMap[actionType] || 'action';
  }

  // Get rating color based on value and thresholds
  static getRatingColor(value: number, amberThreshold: number, redThreshold: number): string {
    if (value <= amberThreshold) return 'green';
    if (value <= redThreshold) return 'orange';
    return 'red';
  }

  static getComplexityColor(complexity: number, thresholds?: IRatingThresholds): string {
    const t = thresholds || defaultAnalysisConfig.ratingThresholds;
    return FlowAnalyzer.getRatingColor(complexity, t.complexityAmber, t.complexityRed);
  }

  static getActionCountColor(count: number, thresholds?: IRatingThresholds): string {
    const t = thresholds || defaultAnalysisConfig.ratingThresholds;
    return FlowAnalyzer.getRatingColor(count, t.actionsAmber, t.actionsRed);
  }

  static getVariableCountColor(count: number, thresholds?: IRatingThresholds): string {
    const t = thresholds || defaultAnalysisConfig.ratingThresholds;
    return FlowAnalyzer.getRatingColor(count, t.variablesAmber, t.variablesRed);
  }

  static getOverallRatingColor(rating: number): string {
    if (rating >= 70) return 'green';
    if (rating >= 40) return 'orange';
    return 'red';
  }

  // Instance methods for color (uses instance config)
  getComplexityColor(complexity: number): string {
    return FlowAnalyzer.getComplexityColor(complexity, this.config.ratingThresholds);
  }

  getActionCountColor(count: number): string {
    return FlowAnalyzer.getActionCountColor(count, this.config.ratingThresholds);
  }

  getVariableCountColor(count: number): string {
    return FlowAnalyzer.getVariableCountColor(count, this.config.ratingThresholds);
  }
}

export default FlowAnalyzer;
