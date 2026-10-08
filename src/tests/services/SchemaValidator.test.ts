import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import { SchemaValidator, resolvePointer } from '../../services/SchemaValidator';
import { modernFlowDefinitions } from '../fixtures/modernFlowDefinitions';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const buildValidators = require('../../../scripts/build-validators');

const validDefinition = {
  $schema:
    'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0.0',
  triggers: {},
  actions: {},
};

const withActions = (actions: Record<string, unknown>) => ({ ...validDefinition, actions });

describe('SchemaValidator', () => {
  it('constructs without throwing', () => {
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

  describe('runs without runtime code generation (MV3 CSP forbids unsafe-eval)', () => {
    const realFunction = global.Function;

    afterEach(() => {
      global.Function = realFunction;
    });

    it('validates with Function/eval unavailable, as on an extension page', () => {
      // Ajv's runtime compile goes through `new Function(...)`; the extension CSP
      // turns that into "Refused to evaluate a string as JavaScript".
      (global as any).Function = function blocked() {
        throw new EvalError('Refused to evaluate a string as JavaScript');
      };

      const validator = new SchemaValidator();
      expect(validator.validateFlow(validDefinition).isValid).toBe(true);
      expect(validator.validateFlow({ contentVersion: 1 }).isValid).toBe(false);
    });

    it('does not bundle the Ajv compiler into the validator', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../schemas/generated/workflowDefinitionValidator.js'),
        'utf8'
      );
      expect(source).not.toMatch(/new Function|\beval\(/);
      expect(source).not.toMatch(/from ["']ajv["']|require\(["']ajv["']\)/);
    });
  });

  describe('precompiled validator', () => {
    it('matches what scripts/build-validators.js generates today', () => {
      // Fails when the schema changed but `node scripts/build-validators.js` was not re-run.
      const generated = buildValidators.generate();
      for (const [name, content] of Object.entries<string>(generated)) {
        const committed = fs.readFileSync(path.join(__dirname, '../../schemas/generated', name), 'utf8');
        expect(committed === content).toBe(true);
      }
    });

    it('agrees with a runtime-compiled Ajv validator on valid and invalid input', () => {
      const { code, ...runtimeOptions } = buildValidators.AJV_OPTIONS;
      const ajv = new Ajv(runtimeOptions);
      const runtime = ajv.compile(buildValidators.loadWorkflowSchema());
      const samples = [
        validDefinition,
        { contentVersion: 123, triggers: 'nope' },
        withActions({ A: { type: 'Http', runAfter: {}, inputs: { method: 'GET' } } }),
        ...Object.values(modernFlowDefinitions),
      ];

      for (const sample of samples) {
        const precompiled = new SchemaValidator().validateFlow(sample);
        expect(precompiled.isValid).toBe(runtime(sample));
      }
    });
  });

  describe('modern Power Automate definitions', () => {
    it.each(Object.entries(modernFlowDefinitions))('%s produces zero schema issues', (_name, definition) => {
      const result = new SchemaValidator().validateFlow(definition);

      expect(result.issues).toEqual([]);
      expect(result.isValid).toBe(true);
    });

    it('validates actions nested inside scopes, conditions and loops', () => {
      const result = new SchemaValidator().validateFlow(
        withActions({
          Try: {
            type: 'Scope',
            runAfter: {},
            actions: {
              Apply_to_each: {
                type: 'Foreach',
                foreach: '@body(\'x\')',
                runAfter: {},
                actions: { HTTP: { type: 'Http', runAfter: {}, inputs: { method: 'GET' } } },
              },
            },
          },
        })
      );

      expect(result.isValid).toBe(false);
      expect(result.issues).toEqual([
        expect.objectContaining({
          keyword: 'required',
          message: 'Missing required property: uri',
          path: 'actions.Try.actions.Apply_to_each.actions.HTTP.inputs',
          instancePath: '/actions/Try/actions/Apply_to_each/actions/HTTP/inputs',
        }),
      ]);
    });

    it('reports one targeted error for a mistyped operation type, not one per known shape', () => {
      const result = new SchemaValidator().validateFlow(
        withActions({ Send: { type: 'OpenApiConection', runAfter: {}, inputs: {} } })
      );

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].path).toBe('actions.Send.type');
      expect(result.issues[0].message).toContain('"OpenApiConection" is not an allowed value');
    });

    it('keeps the narrower enum when two lists apply to the same value', () => {
      const result = new SchemaValidator().validateFlow(
        withActions({ Stop: { type: 'Terminate', runAfter: {}, inputs: { runStatus: 'Skipped' } } })
      );

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toBe(
        '"Skipped" is not an allowed value. Expected one of: Cancelled, Failed, Succeeded'
      );
    });

    it('still requires the connector host on OpenApiConnection actions', () => {
      const result = new SchemaValidator().validateFlow(
        withActions({ Send: { type: 'OpenApiConnection', runAfter: {}, inputs: { parameters: {} } } })
      );

      expect(result.issues.map((i) => i.message)).toEqual(['Missing required property: host']);
    });

    it('accepts unknown kinds, which Power Automate adds without notice', () => {
      const result = new SchemaValidator().validateFlow(
        withActions({ Format: { type: 'Expression', kind: 'FormatNumber', runAfter: {}, inputs: {} } })
      );

      expect(result.isValid).toBe(true);
    });
  });

  it('resolves JSON pointers including escaped segments', () => {
    const data = { a: { 'b/c': [{ '~d': 1 }] } };
    expect(resolvePointer(data, '/a/b~1c/0/~0d')).toBe(1);
    expect(resolvePointer(data, '')).toBe(data);
    expect(resolvePointer(data, '/missing/x')).toBeUndefined();
  });
});
