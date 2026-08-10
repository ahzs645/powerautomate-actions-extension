import { SchemaValidator } from '../../services/SchemaValidator';

const validDefinition = {
  $schema:
    'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0.0',
  triggers: {},
  actions: {},
};

describe('SchemaValidator', () => {
  // Regression: workflowdefinition.json declares draft-04, whose meta-schema Ajv 8
  // does not ship. Compiling it unmodified threw `no schema with key or ref
  // "http://json-schema.org/draft-04/schema#"`, which the flow editor surfaced as
  // "Invalid JSON" on every validation regardless of the flow's contents.
  it('constructs without throwing on the draft-04 workflow schema', () => {
    expect(() => new SchemaValidator()).not.toThrow();
  });

  it('accepts a well-formed flow definition', () => {
    const result = new SchemaValidator().validateFlow(validDefinition);

    expect(result.isValid).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('still rejects a malformed definition, so validation is not passing vacuously', () => {
    const result = new SchemaValidator().validateFlow({
      contentVersion: 123,
      triggers: 'not-an-object',
    });

    expect(result.isValid).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('reports a parse error for malformed JSON text', () => {
    const result = new SchemaValidator().validateFlowJson('{ not json');

    expect(result.isValid).toBe(false);
    expect(result.issues[0].keyword).toBe('parse');
    expect(result.issues[0].message).toContain('Invalid JSON');
  });

  it('validates a JSON string end to end', () => {
    const result = new SchemaValidator().validateFlowJson(JSON.stringify(validDefinition));

    expect(result.isValid).toBe(true);
  });

  it('returns themeable severity colours rather than fixed hex values', () => {
    expect(SchemaValidator.getSeverityColor('error')).toBe('var(--color-danger)');
    expect(SchemaValidator.getSeverityColor('warning')).toBe('var(--color-warning)');
  });
});
