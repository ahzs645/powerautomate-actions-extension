// SchemaValidator - Validates Power Automate flow definitions against JSON Schema
// Uses ajv for JSON Schema validation

import Ajv, { ErrorObject } from 'ajv';
import workflowSchema from '../schemas/workflowdefinition.json';

export interface ValidationIssue {
  path: string;
  message: string;
  keyword: string;
  severity: 'error' | 'warning';
  schemaPath: string;
}

export interface SchemaValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

export class SchemaValidator {
  private ajv: Ajv;
  private validate: ReturnType<Ajv['compile']>;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
    });

    // Compile the schema
    this.validate = this.ajv.compile(workflowSchema);
  }

  /**
   * Validate a flow definition against the workflow schema
   */
  validateFlow(flowDefinition: any): SchemaValidationResult {
    const isValid = this.validate(flowDefinition);
    const errors = this.validate.errors || [];

    const issues = this.mapErrorsToIssues(errors);
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;

    return {
      isValid: !!isValid,
      issues,
      errorCount,
      warningCount,
    };
  }

  /**
   * Validate a flow definition JSON string
   */
  validateFlowJson(jsonString: string): SchemaValidationResult {
    try {
      const parsed = JSON.parse(jsonString);
      return this.validateFlow(parsed);
    } catch (error) {
      return {
        isValid: false,
        issues: [
          {
            path: '',
            message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
            keyword: 'parse',
            severity: 'error',
            schemaPath: '',
          },
        ],
        errorCount: 1,
        warningCount: 0,
      };
    }
  }

  /**
   * Map ajv errors to ValidationIssues
   */
  private mapErrorsToIssues(errors: ErrorObject[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const seenPaths = new Set<string>();

    for (const error of errors) {
      const path = error.instancePath || '/';
      const uniqueKey = `${path}:${error.keyword}:${error.message}`;

      // Skip duplicates
      if (seenPaths.has(uniqueKey)) continue;
      seenPaths.add(uniqueKey);

      const severity = this.getSeverity(error);
      const message = this.formatErrorMessage(error);

      issues.push({
        path: this.formatPath(path),
        message,
        keyword: error.keyword,
        severity,
        schemaPath: error.schemaPath,
      });
    }

    return issues;
  }

  /**
   * Determine severity based on error type
   */
  private getSeverity(error: ErrorObject): 'error' | 'warning' {
    // Required fields and type mismatches are errors
    if (['required', 'type', 'enum', 'const'].includes(error.keyword)) {
      return 'error';
    }

    // Additional properties are usually warnings
    if (error.keyword === 'additionalProperties') {
      return 'warning';
    }

    // Pattern, format, minimum, maximum are warnings
    if (['pattern', 'format', 'minimum', 'maximum', 'minLength', 'maxLength'].includes(error.keyword)) {
      return 'warning';
    }

    return 'error';
  }

  /**
   * Format error message for display
   */
  private formatErrorMessage(error: ErrorObject): string {
    switch (error.keyword) {
      case 'required':
        return `Missing required property: ${(error.params as any).missingProperty}`;
      case 'type':
        return `Expected type "${(error.params as any).type}", but got different type`;
      case 'enum':
        return `Value must be one of: ${((error.params as any).allowedValues || []).join(', ')}`;
      case 'additionalProperties':
        return `Unknown property: ${(error.params as any).additionalProperty}`;
      case 'pattern':
        return `Value does not match expected pattern`;
      case 'format':
        return `Invalid format: expected ${(error.params as any).format}`;
      case 'minimum':
        return `Value must be at least ${(error.params as any).limit}`;
      case 'maximum':
        return `Value must be at most ${(error.params as any).limit}`;
      case 'minLength':
        return `String must be at least ${(error.params as any).limit} characters`;
      case 'maxLength':
        return `String must be at most ${(error.params as any).limit} characters`;
      case 'oneOf':
        return `Value does not match any of the expected schemas`;
      case 'allOf':
        return `Value does not satisfy all required schemas`;
      case 'anyOf':
        return `Value does not match any of the allowed schemas`;
      default:
        return error.message || 'Validation error';
    }
  }

  /**
   * Format JSON pointer path for display
   */
  private formatPath(path: string): string {
    if (!path || path === '/') return 'root';

    // Convert JSON pointer to dot notation
    return path
      .replace(/^\//, '')
      .replace(/\//g, '.')
      .replace(/~1/g, '/')
      .replace(/~0/g, '~');
  }

  /**
   * Validate specific parts of a flow definition
   */
  validateActions(actions: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!actions || typeof actions !== 'object') {
      return issues;
    }

    for (const [actionName, action] of Object.entries(actions)) {
      const actionObj = action as any;

      // Check for required type property
      if (!actionObj.type) {
        issues.push({
          path: `actions.${actionName}`,
          message: 'Action is missing required "type" property',
          keyword: 'required',
          severity: 'error',
          schemaPath: '',
        });
      }

      // Check for valid action types
      const validTypes = [
        'ApiConnection', 'ApiConnectionWebhook', 'Compose', 'Foreach',
        'Http', 'HttpWebhook', 'If', 'InitializeVariable', 'SetVariable',
        'Scope', 'Switch', 'Terminate', 'Until', 'Wait', 'Workflow',
        'ParseJson', 'Select', 'Query', 'Join', 'Table', 'Response',
        'Function', 'AppendToArrayVariable', 'AppendToStringVariable',
        'IncrementVariable', 'DecrementVariable', 'Expression',
      ];

      if (actionObj.type && !validTypes.includes(actionObj.type)) {
        issues.push({
          path: `actions.${actionName}`,
          message: `Unknown action type: ${actionObj.type}`,
          keyword: 'enum',
          severity: 'warning',
          schemaPath: '',
        });
      }

      // Recursively validate nested actions
      if (actionObj.actions) {
        const nestedIssues = this.validateActions(actionObj.actions);
        issues.push(...nestedIssues.map((i) => ({
          ...i,
          path: `actions.${actionName}.${i.path}`,
        })));
      }

      // Check If/Switch branches
      if (actionObj.else?.actions) {
        const elseIssues = this.validateActions(actionObj.else.actions);
        issues.push(...elseIssues.map((i) => ({
          ...i,
          path: `actions.${actionName}.else.${i.path}`,
        })));
      }

      if (actionObj.cases) {
        for (const [caseName, caseObj] of Object.entries(actionObj.cases)) {
          const caseActions = (caseObj as any).actions;
          if (caseActions) {
            const caseIssues = this.validateActions(caseActions);
            issues.push(...caseIssues.map((i) => ({
              ...i,
              path: `actions.${actionName}.cases.${caseName}.${i.path}`,
            })));
          }
        }
      }

      if (actionObj.default?.actions) {
        const defaultIssues = this.validateActions(actionObj.default.actions);
        issues.push(...defaultIssues.map((i) => ({
          ...i,
          path: `actions.${actionName}.default.${i.path}`,
        })));
      }
    }

    return issues;
  }

  /**
   * Get a summary of validation results
   */
  static getSummary(result: SchemaValidationResult): string {
    if (result.isValid) {
      return 'Flow definition is valid';
    }

    const parts: string[] = [];
    if (result.errorCount > 0) {
      parts.push(`${result.errorCount} error${result.errorCount === 1 ? '' : 's'}`);
    }
    if (result.warningCount > 0) {
      parts.push(`${result.warningCount} warning${result.warningCount === 1 ? '' : 's'}`);
    }

    return `Flow validation found ${parts.join(' and ')}`;
  }

  /**
   * Get color for issue severity
   */
  static getSeverityColor(severity: 'error' | 'warning'): string {
    return severity === 'error' ? '#d13438' : '#ff8c00';
  }
}

export default SchemaValidator;
