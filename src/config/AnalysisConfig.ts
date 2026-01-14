// Analysis Configuration - Configurable thresholds, naming conventions, and scoring rules
// Ported from AutoReview extension's configuration system

// ============================================================================
// RATING THRESHOLDS
// ============================================================================

export interface IRatingThresholds {
  complexityAmber: number;
  complexityRed: number;
  actionsAmber: number;
  actionsRed: number;
  variablesAmber: number;
  variablesRed: number;
  exceptionsAmber: number;
  exceptionsRed: number;
}

export const defaultRatingThresholds: IRatingThresholds = {
  complexityAmber: 50,
  complexityRed: 100,
  actionsAmber: 30,
  actionsRed: 50,
  variablesAmber: 3,
  variablesRed: 5,
  exceptionsAmber: 1,
  exceptionsRed: 0,
};

// ============================================================================
// NAMING CONVENTIONS
// ============================================================================

export interface INamingConvention {
  type: string;
  prefix: string;
}

export interface INamingConfig {
  prefixLength: number;
  conventions: INamingConvention[];
}

export const defaultNamingConfig: INamingConfig = {
  prefixLength: 1,
  conventions: [
    { type: 'boolean', prefix: 'b' },
    { type: 'string', prefix: 's' },
    { type: 'integer', prefix: 'i' },
    { type: 'float', prefix: 'f' },
    { type: 'object', prefix: 'o' },
    { type: 'array', prefix: 'a' },
  ],
};

// ============================================================================
// SCORING CONFIGURATION
// ============================================================================

export interface IScoringRule {
  name: string;
  score: number;
  description: string;
  category: 'scope' | 'variable' | 'complexity' | 'actions' | 'connections' | 'compose';
}

export interface IScoringConfig {
  rules: IScoringRule[];
}

export const defaultScoringRules: IScoringRule[] = [
  // Scope bonuses
  { name: 'exceptionScope', score: 10, description: 'Bonus for having an exception handling scope', category: 'scope' },
  { name: 'mainScope', score: 10, description: 'Bonus for having a main/try scope', category: 'scope' },

  // Variable scoring
  { name: 'varNaming', score: 10, description: 'Max score for following naming conventions', category: 'variable' },
  { name: 'varUsed', score: 5, description: 'Bonus when all variables are used', category: 'variable' },
  { name: 'varConstant', score: 5, description: 'Bonus for using constant variables', category: 'variable' },
  { name: 'variables', score: 10, description: 'Base score before variable deductions', category: 'variable' },
  { name: 'variablesMin', score: 0, description: 'Minimum variables allowed before deductions', category: 'variable' },
  { name: 'variablesDeduction', score: 1, description: 'Points deducted per excess variable', category: 'variable' },

  // Compose scoring
  { name: 'composes', score: 10, description: 'Base score before compose deductions', category: 'compose' },
  { name: 'composesMin', score: 0, description: 'Minimum composes allowed before deductions', category: 'compose' },
  { name: 'composesDeduction', score: 5, description: 'Points deducted per compose action', category: 'compose' },

  // Connections scoring
  { name: 'connections', score: 10, description: 'Base score before connection deductions', category: 'connections' },
  { name: 'connectionsMin', score: 3, description: 'Minimum connections allowed before deductions', category: 'connections' },
  { name: 'connectionsDeduction', score: 2, description: 'Points deducted per excess connection', category: 'connections' },

  // Complexity-based scoring
  { name: 'complexityRed', score: 0, description: 'Score when complexity is in red zone', category: 'complexity' },
  { name: 'complexityAmber', score: 15, description: 'Score when complexity is in amber zone', category: 'complexity' },
  { name: 'complexityGreen', score: 20, description: 'Score when complexity is in green zone', category: 'complexity' },

  // Action count scoring
  { name: 'actionsRed', score: 0, description: 'Score when action count is in red zone', category: 'actions' },
  { name: 'actionsAmber', score: 5, description: 'Score when action count is in amber zone', category: 'actions' },
  { name: 'actionsGreen', score: 10, description: 'Score when action count is in green zone', category: 'actions' },
];

export const defaultScoringConfig: IScoringConfig = {
  rules: defaultScoringRules,
};

// Helper to get a scoring rule value by name
export function getScoringRuleValue(config: IScoringConfig, ruleName: string): number {
  const rule = config.rules.find(r => r.name === ruleName);
  return rule?.score ?? 0;
}

// ============================================================================
// COMPLEXITY CONFIGURATION
// ============================================================================

export interface IComplexityRule {
  name: string;
  complexity: number;
  description?: string;
}

export const defaultComplexityRules: IComplexityRule[] = [
  // SharePoint Online
  { name: 'GetItemsshared_sharepointonline', complexity: 1, description: 'SharePoint Get Items' },
  { name: 'CopyFileAsyncshared_sharepointonline', complexity: 1, description: 'SharePoint Copy File' },
  { name: 'GetFileContentshared_sharepointonline', complexity: 1, description: 'SharePoint Get File Content' },
  { name: 'HttpRequestshared_sharepointonline', complexity: 5, description: 'SharePoint HTTP Request' },
  { name: 'DeleteFileshared_sharepointonline', complexity: 1, description: 'SharePoint Delete File' },

  // OneDrive for Business
  { name: 'ConvertFileshared_onedriveforbusiness', complexity: 2, description: 'OneDrive Convert File' },

  // Excel Online
  { name: 'GetItemsshared_excelonlinebusiness', complexity: 1, description: 'Excel Get Items' },
  { name: 'RunScriptProdshared_excelonlinebusiness', complexity: 5, description: 'Excel Run Script' },

  // Approvals
  { name: 'StartAndWaitForAnApprovalshared_approvals', complexity: 2, description: 'Approvals Start and Wait' },

  // Generic action types
  { name: 'ApiConnection', complexity: 2, description: 'API Connection action' },
  { name: 'ApiConnectionWebhook', complexity: 2, description: 'API Connection Webhook' },
  { name: 'ApiManagement', complexity: 2, description: 'API Management action' },
  { name: 'AppendToArrayVariable', complexity: 2, description: 'Append to array variable' },
  { name: 'AppendToStringVariable', complexity: 2, description: 'Append to string variable' },
  { name: 'Batch', complexity: 5, description: 'Batch operation' },
  { name: 'Compose', complexity: 2, description: 'Compose action' },
  { name: 'DecrementVariable', complexity: 2, description: 'Decrement variable' },
  { name: 'Expression', complexity: 2, description: 'Expression action' },
  { name: 'FlatFileDecoding', complexity: 5, description: 'Flat file decoding' },
  { name: 'FlatFileEncoding', complexity: 5, description: 'Flat file encoding' },
  { name: 'Foreach', complexity: 4, description: 'For each loop' },
  { name: 'Function', complexity: 5, description: 'Azure Function call' },
  { name: 'Http', complexity: 5, description: 'HTTP request' },
  { name: 'HttpWebhook', complexity: 5, description: 'HTTP Webhook' },
  { name: 'If', complexity: 3, description: 'Condition (If)' },
  { name: 'IncrementVariable', complexity: 2, description: 'Increment variable' },
  { name: 'InitializeVariable', complexity: 1, description: 'Initialize variable' },
  { name: 'IntegrationAccountArtifactLookup', complexity: 5, description: 'Integration account lookup' },
  { name: 'Join', complexity: 3, description: 'Join operation' },
  { name: 'Liquid', complexity: 5, description: 'Liquid template' },
  { name: 'ParseJson', complexity: 3, description: 'Parse JSON' },
  { name: 'Query', complexity: 3, description: 'Query operation' },
  { name: 'Recurrence', complexity: 5, description: 'Recurrence trigger' },
  { name: 'Request', complexity: 1, description: 'HTTP Request trigger' },
  { name: 'Response', complexity: 1, description: 'HTTP Response' },
  { name: 'Scope', complexity: -1, description: 'Scope (structural, no complexity added)' },
  { name: 'Select', complexity: 3, description: 'Select operation' },
  { name: 'SendToBatch', complexity: 5, description: 'Send to batch' },
  { name: 'SetVariable', complexity: 2, description: 'Set variable' },
  { name: 'SlidingWindow', complexity: 5, description: 'Sliding window trigger' },
  { name: 'Switch', complexity: 4, description: 'Switch statement' },
  { name: 'Table', complexity: 2, description: 'Create table' },
  { name: 'Terminate', complexity: -1, description: 'Terminate (structural, no complexity added)' },
  { name: 'Until', complexity: 4, description: 'Until loop' },
  { name: 'Wait', complexity: 1, description: 'Wait/Delay' },
  { name: 'Workflow', complexity: 5, description: 'Child workflow call' },
  { name: 'XmlValidation', complexity: 3, description: 'XML validation' },
  { name: 'Xslt', complexity: 3, description: 'XSLT transformation' },
  { name: 'OpenApiConnection', complexity: 1, description: 'OpenAPI connection' },
  { name: 'OpenApiConnectionWebhook', complexity: 2, description: 'OpenAPI webhook' },
  { name: 'Do_until', complexity: 4, description: 'Do until loop' },
];

// ============================================================================
// COMBINED ANALYSIS CONFIGURATION
// ============================================================================

export interface IAnalysisConfig {
  ratingThresholds: IRatingThresholds;
  namingConfig: INamingConfig;
  scoringConfig: IScoringConfig;
  complexityRules: IComplexityRule[];
}

export const defaultAnalysisConfig: IAnalysisConfig = {
  ratingThresholds: defaultRatingThresholds,
  namingConfig: defaultNamingConfig,
  scoringConfig: defaultScoringConfig,
  complexityRules: defaultComplexityRules,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Convert naming config to a lookup map
export function getNamingConventionMap(config: INamingConfig): Record<string, string> {
  const map: Record<string, string> = {};
  for (const convention of config.conventions) {
    map[convention.type.toLowerCase()] = convention.prefix;
  }
  return map;
}

// Convert complexity rules to a lookup map
export function getComplexityMap(rules: IComplexityRule[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const rule of rules) {
    map[rule.name] = rule.complexity;
  }
  return map;
}

// Get rating color based on thresholds
export function getRatingColor(
  value: number,
  amberThreshold: number,
  redThreshold: number,
  lowerIsBetter: boolean = true
): 'green' | 'orange' | 'red' {
  if (lowerIsBetter) {
    if (value <= amberThreshold) return 'green';
    if (value <= redThreshold) return 'orange';
    return 'red';
  } else {
    if (value >= redThreshold) return 'green';
    if (value >= amberThreshold) return 'orange';
    return 'red';
  }
}
