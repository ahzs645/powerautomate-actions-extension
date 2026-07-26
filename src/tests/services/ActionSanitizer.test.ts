import { ActionSanitizer } from '../../services/ActionSanitizer';
import { IActionModel } from '../../models';

describe('ActionSanitizer', () => {
    let sanitizer: ActionSanitizer;

    beforeEach(() => {
        sanitizer = new ActionSanitizer();
    });

    const buildAction = (definition: any, url = ''): IActionModel => ({
        id: 'test',
        title: 'Test',
        method: 'POST',
        icon: '',
        url,
        actionJson: JSON.stringify({ operationName: 'Test', operationDefinition: definition }),
    });

    describe('sanitizeString', () => {
        it('redacts an Azure Function key from a query string', () => {
            const result = sanitizer.sanitizeString(
                'https://utils.azurewebsites.net/api/merge_pdf_fitz?code=abc123SECRETkey=='
            );

            expect(result.value).toBe('https://utils.azurewebsites.net/api/merge_pdf_fitz?code=REDACTED');
            expect(result.report.secretsRedacted).toBe(1);
        });

        it('redacts SAS signature parameters', () => {
            const result = sanitizer.sanitizeString('https://a.blob.core.windows.net/x?sv=2021&sig=deadbeef');

            expect(result.value).not.toContain('deadbeef');
            expect(result.report.secretsRedacted).toBe(2);
        });

        it('redacts email addresses', () => {
            const result = sanitizer.sanitizeString('owner is OpExOptimization@ghsc-psm.org today');

            expect(result.value).toBe('owner is user@example.com today');
            expect(result.report.emailsRedacted).toBe(1);
        });

        it('redacts drive ids, drive item ids and tenant SharePoint hostnames', () => {
            const result = sanitizer.sanitizeString(
                'b!y2rxipfTvUi7ALZMiyxLa89aQqkbMORMksjFtKI_dfKgJA8V37mjQICJm9mYgy-T'
                + ' 01JWBUU4GNEWKHDBRESJH2GDE4DZFD5EHT'
                + ' https://contosodev.sharepoint.com/sites/x'
            );

            expect(result.value).not.toContain('b!y2rxip');
            expect(result.value).not.toContain('01JWBUU4');
            expect(result.value).not.toContain('contosodev');
            expect(result.report.tenantIdsRedacted).toBe(3);
        });

        it('leaves ordinary text untouched', () => {
            const result = sanitizer.sanitizeString('Merge PDFs into a single document');

            expect(result.value).toBe('Merge PDFs into a single document');
            expect(result.report.secretsRedacted).toBe(0);
        });
    });

    describe('sanitizeAction', () => {
        it('strips the drive item id to filename map from metadata', () => {
            const action = buildAction({
                type: 'OpenApiConnection',
                metadata: {
                    operationMetadataId: 'keep-me',
                    'b!driveIdGoesHere012345678901234567890': '/Employment Application 2023.pdf',
                },
                inputs: { parameters: { id: 'Choose File' } },
            });

            const result = sanitizer.sanitizeAction(action);
            const parsed = JSON.parse(result.value.actionJson);

            expect(parsed.operationDefinition.metadata).toEqual({ operationMetadataId: 'keep-me' });
            expect(result.value.actionJson).not.toContain('Employment Application');
            expect(result.report.metadataKeysRemoved).toBe(1);
        });

        it('removes connection references and authentication blocks', () => {
            const action = buildAction({
                type: 'OpenApiConnection',
                inputs: {
                    host: { apiId: '/apis/shared_onedriveforbusiness', connection: 'shared-guid-123' },
                    authentication: { type: 'Raw', value: '@json(...)' },
                },
            });

            const result = sanitizer.sanitizeAction(action);
            const parsed = JSON.parse(result.value.actionJson);

            expect(parsed.operationDefinition.inputs.host.connection).toBeUndefined();
            expect(parsed.operationDefinition.inputs.host.apiId).toBe('/apis/shared_onedriveforbusiness');
            expect(parsed.operationDefinition.inputs.authentication).toBeUndefined();
            expect(result.report.connectionsRemoved).toBe(1);
        });

        it('redacts the function key from both the url field and the definition', () => {
            const action = buildAction(
                { type: 'Http', inputs: { uri: 'https://u.azurewebsites.net/api/zip_files?code=SECRET' } },
                'https://u.azurewebsites.net/api/zip_files?code=SECRET'
            );

            const result = sanitizer.sanitizeAction(action);

            expect(result.value.url).not.toContain('SECRET');
            expect(result.value.actionJson).not.toContain('SECRET');
        });

        it('still redacts secrets when actionJson is not valid JSON', () => {
            const action: IActionModel = {
                id: 'broken', title: 'Broken', method: '', icon: '', url: '',
                actionJson: 'not json at all ?code=SECRETVALUE',
            };

            const result = sanitizer.sanitizeAction(action);

            expect(result.value.actionJson).not.toContain('SECRETVALUE');
            expect(result.report.secretsRedacted).toBe(1);
        });
    });

    describe('sanitizeActions', () => {
        it('aggregates the report across every action', () => {
            const actions = [
                buildAction({ type: 'Http', inputs: { uri: 'https://a/api/x?code=ONE' } }),
                buildAction({ type: 'Http', inputs: { uri: 'https://b/api/y?code=TWO' } }),
            ];

            const result = sanitizer.sanitizeActions(actions);

            expect(result.report.secretsRedacted).toBe(2);
            expect(result.value).toHaveLength(2);
        });
    });

    describe('containsSecret', () => {
        it('detects a key left in the url', () => {
            expect(sanitizer.containsSecret(buildAction({}, 'https://a/api/x?code=abc'))).toBe(true);
        });

        it('returns false for a placeholder url', () => {
            expect(sanitizer.containsSecret(buildAction({}, '{{functionBaseUrl}}/api/x?code={{functionKey}}')))
                .toBe(false);
        });
    });

    describe('describeReport', () => {
        it('returns null when nothing was removed', () => {
            const result = sanitizer.sanitizeString('nothing sensitive here');
            expect(sanitizer.describeReport(result.report)).toBeNull();
        });

        it('summarises what was removed', () => {
            const result = sanitizer.sanitizeString('a@b.com and ?code=xyz');
            expect(sanitizer.describeReport(result.report)).toBe('Removed 1 secrets, 1 email addresses');
        });
    });
});
