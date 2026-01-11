// FlowAnalyzer - Ported from AutoReview-PWA
// Analyzes Power Automate flow definitions for complexity, quality scoring, and generates reports

export interface FlowAction {
  Name: string;
  Type: string;
  step: string;
  id: string;
  hasId: string;
  tier: string;
  connector: string;
  imgURL: string;
  runAfter: string;
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
  recurrence?: string;
  inputs?: any;
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
}

// Complexity ratings for different action types
const complexityTemplate: Record<string, number> = {
  'GetItemsshared_sharepointonline': 1,
  'CopyFileAsyncshared_sharepointonline': 1,
  'GetFileContentshared_sharepointonline': 1,
  'HttpRequestshared_sharepointonline': 5,
  'DeleteFileshared_sharepointonline': 1,
  'ConvertFileshared_onedriveforbusiness': 2,
  'GetItemsshared_excelonlinebusiness': 1,
  'RunScriptProdshared_excelonlinebusiness': 5,
  'StartAndWaitForAnApprovalshared_approvals': 2,
  'ApiConnection': 2,
  'ApiConnectionWebhook': 2,
  'ApiManagement': 2,
  'AppendToArrayVariable': 2,
  'AppendToStringVariable': 2,
  'Batch': 5,
  'Compose': 2,
  'DecrementVariable': 2,
  'Expression': 2,
  'FlatFileDecoding': 5,
  'FlatFileEncoding': 5,
  'Foreach': 4,
  'Function': 5,
  'Http': 5,
  'HttpWebhook': 5,
  'If': 3,
  'IncrementVariable': 2,
  'InitializeVariable': 1,
  'IntegrationAccountArtifactLookup': 5,
  'Join': 3,
  'Liquid': 5,
  'ParseJson': 3,
  'Query': 3,
  'Recurrence': 5,
  'Request': 1,
  'Response': 1,
  'Scope': -1,
  'Select': 3,
  'SendToBatch': 5,
  'SetVariable': 2,
  'SlidingWindow': 5,
  'Switch': 4,
  'Table': 2,
  'Terminate': -1,
  'Until': 4,
  'Wait': 1,
  'Workflow': 5,
  'XmlValidation': 3,
  'Xslt': 3,
  'OpenApiConnection': 1,
  'OpenApiConnectionWebhook': 2,
  'Do_until': 4,
};

// Rating thresholds
const ratingThresholds = {
  complexityAmber: 50,
  complexityRed: 100,
  actionsAmber: 30,
  actionsRed: 50,
  variablesAmber: 3,
  variablesRed: 5,
  exceptionsAmber: 1,
  exceptionsRed: 0,
};

// Scoring configuration
const scoringConfig = {
  exceptionScope: 10,
  mainScope: 10,
  varNaming: 10,
  varUsed: 5,
  varConstant: 5,
  variables: 10,
  variablesMin: 0,
  variablesDeduction: 1,
  composes: 10,
  composesMin: 0,
  composesDeduction: 5,
  connections: 10,
  connectionsMin: 3,
  connectionsDeduction: 2,
  complexityRed: 0,
  complexityAmber: 15,
  complexityGreen: 20,
  actionsRed: 0,
  actionsAmber: 5,
  actionsGreen: 10,
};

// Variable naming conventions
const namingConventions: Record<string, string> = {
  boolean: 'b',
  string: 's',
  integer: 'i',
  float: 'f',
  object: 'o',
  array: 'a',
};

export class FlowAnalyzer {
  private definition: any;
  private actions: FlowAction[] = [];
  private variables: FlowVariable[] = [];
  private connections: FlowConnection[] = [];
  private errors: string[] = [];
  private warnings: string[] = [];


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
      const overallRating = this.calculateOverallRating(
        complexity,
        this.actions.length,
        this.variables.length,
        hasMainScope,
        hasExceptionScope,
        variableNamingScore,
        composesCount
      );

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

    return {
      name: triggerName,
      type: trigger.type || 'Unknown',
      connector: trigger.inputs?.host?.apiId || trigger.inputs?.host?.connectionName || 'Unknown',
      recurrence: trigger.recurrence ? JSON.stringify(trigger.recurrence) : undefined,
      inputs: trigger.inputs,
    };
  }

  private analyzeActions(actions: any, parent: string, nestLevel: number): void {
    if (!actions || typeof actions !== 'object') return;

    let index = 0;
    for (const [actionName, actionDef] of Object.entries(actions)) {
      const action = actionDef as any;
      const actionType = action.type || 'Unknown';

      // Get complexity for this action type
      const complexityKey = this.getComplexityKey(actionType, action);
      const complexity = complexityTemplate[complexityKey] || complexityTemplate[actionType] || 1;

      // Extract run after
      const runAfter = action.runAfter
        ? Object.keys(action.runAfter).join(', ')
        : '';

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
        imgURL: '',
        runAfter,
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
        this.analyzeActions(action.else.actions, actionName, nestLevel + 1);
      }
      if (action.cases) {
        for (const [caseName, caseDef] of Object.entries(action.cases)) {
          const caseActions = (caseDef as any).actions;
          if (caseActions) {
            this.analyzeActions(caseActions, `${actionName}/${caseName}`, nestLevel + 1);
          }
        }
      }
      if (action.default?.actions) {
        this.analyzeActions(action.default.actions, `${actionName}/default`, nestLevel + 1);
      }
    }
  }

  private getComplexityKey(type: string, action: any): string {
    const connector = this.getConnector(action);
    const operationId = action.inputs?.host?.operationId || '';

    // Try specific connector+operation combination first
    const specificKey = `${operationId}${connector}`;
    if (complexityTemplate[specificKey]) {
      return specificKey;
    }

    return type;
  }

  private getActionTier(action: any): string {
    const type = action.type || '';
    if (type.includes('Premium') || type.includes('Http')) {
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
        const expectedPrefix = namingConventions[varType.toLowerCase()] || '';
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

  private calculateOverallRating(
    complexity: number,
    actionCount: number,
    variableCount: number,
    hasMainScope: boolean,
    hasExceptionScope: boolean,
    variableNamingScore: number,
    composesCount: number
  ): number {
    let score = 0;

    // Complexity score
    if (complexity <= ratingThresholds.complexityAmber) {
      score += scoringConfig.complexityGreen;
    } else if (complexity <= ratingThresholds.complexityRed) {
      score += scoringConfig.complexityAmber;
    } else {
      score += scoringConfig.complexityRed;
    }

    // Action count score
    if (actionCount <= ratingThresholds.actionsAmber) {
      score += scoringConfig.actionsGreen;
    } else if (actionCount <= ratingThresholds.actionsRed) {
      score += scoringConfig.actionsAmber;
    } else {
      score += scoringConfig.actionsRed;
    }

    // Main scope bonus
    if (hasMainScope) {
      score += scoringConfig.mainScope;
    }

    // Exception scope bonus
    if (hasExceptionScope) {
      score += scoringConfig.exceptionScope;
    }

    // Variable naming score
    score += Math.round((variableNamingScore / 100) * scoringConfig.varNaming);

    // Variable count deduction
    if (variableCount > scoringConfig.variablesMin) {
      const deduction = (variableCount - scoringConfig.variablesMin) * scoringConfig.variablesDeduction;
      score = Math.max(0, score - deduction);
    }

    // Compose deduction
    if (composesCount > scoringConfig.composesMin) {
      const deduction = (composesCount - scoringConfig.composesMin) * scoringConfig.composesDeduction;
      score = Math.max(0, score - deduction);
    }

    // Variable usage bonus
    const allUsed = this.variables.every(v => v.used);
    if (allUsed && this.variables.length > 0) {
      score += scoringConfig.varUsed;
    }

    return Math.min(100, Math.max(0, score));
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

  static getComplexityColor(complexity: number): string {
    return FlowAnalyzer.getRatingColor(complexity, ratingThresholds.complexityAmber, ratingThresholds.complexityRed);
  }

  static getActionCountColor(count: number): string {
    return FlowAnalyzer.getRatingColor(count, ratingThresholds.actionsAmber, ratingThresholds.actionsRed);
  }

  static getVariableCountColor(count: number): string {
    return FlowAnalyzer.getRatingColor(count, ratingThresholds.variablesAmber, ratingThresholds.variablesRed);
  }

  static getOverallRatingColor(rating: number): string {
    if (rating >= 70) return 'green';
    if (rating >= 40) return 'orange';
    return 'red';
  }
}

export default FlowAnalyzer;
