import { UtilityActionsService, BASE_URL_TOKEN, KEY_TOKEN } from '../../services/UtilityActionsService';

describe('UtilityActionsService', () => {
    let service: UtilityActionsService;

    beforeEach(() => {
        service = new UtilityActionsService();
    });

    describe('catalog', () => {
        it('exposes every category used by its actions', () => {
            const categories = service.getCategories();
            const used = new Set(service.getCatalog().actions.map(a => a.category));

            used.forEach(category => expect(categories).toContain(category));
        });

        it('gives every action a unique route', () => {
            const routes = service.getCatalog().actions.map(a => a.route);
            expect(new Set(routes).size).toBe(routes.length);
        });

        it('marks the four eval-backed endpoints as unsafe', () => {
            const unsafe = service.getCatalog().actions.filter(a => a.unsafe).map(a => a.route).sort();

            expect(unsafe).toEqual([
                'for_each_filter',
                'for_each_lookup',
                'py_filter',
                'py_transform_array',
            ]);
        });
    });

    describe('buildUri', () => {
        it('leaves placeholders when nothing is configured', () => {
            expect(service.buildUri('merge_pdf_fitz')).toBe(
                `${BASE_URL_TOKEN}/api/merge_pdf_fitz?code=${KEY_TOKEN}`
            );
        });

        it('substitutes the configured base url and key', () => {
            const uri = service.buildUri('merge_pdf_fitz', {
                baseUrl: 'https://my-utils.azurewebsites.net',
                key: 'abc123',
            });

            expect(uri).toBe('https://my-utils.azurewebsites.net/api/merge_pdf_fitz?code=abc123');
        });

        it('strips a trailing slash from the base url', () => {
            const uri = service.buildUri('zip_files', { baseUrl: 'https://my-utils.azurewebsites.net/' });
            expect(uri).toBe(`https://my-utils.azurewebsites.net/api/zip_files?code=${KEY_TOKEN}`);
        });

        it('never emits the key in parameter mode', () => {
            const uri = service.buildUri('zip_files', { keyMode: 'parameter', key: 'SHOULD_NOT_APPEAR' });

            expect(uri).not.toContain('SHOULD_NOT_APPEAR');
            expect(uri).toBe("@{parameters('AzureFunctionBaseUrl')}/api/zip_files?code=@{parameters('AzureFunctionKey')}");
        });

        it('honours custom parameter names', () => {
            const uri = service.buildUri('zip_files', {
                keyMode: 'parameter',
                baseUrlParameterName: 'FnUrl',
                keyParameterName: 'FnKey',
            });

            expect(uri).toBe("@{parameters('FnUrl')}/api/zip_files?code=@{parameters('FnKey')}");
        });
    });

    describe('getActions', () => {
        it('excludes eval-backed endpoints by default', () => {
            const routes = service.getActions().map(a => a.id);
            expect(routes).not.toContain('utility-py_filter');
        });

        it('includes them when explicitly opted in', () => {
            const routes = service.getActions({ includeUnsafe: true }).map(a => a.id);
            expect(routes).toContain('utility-py_filter');
        });

        it('carries the warning through to the action model', () => {
            const action = service.getActions({ includeUnsafe: true }).find(a => a.id === 'utility-py_filter');
            expect(action?.warning).toContain('eval()');
        });

        it('produces an Http operationDefinition the designer can paste', () => {
            const action = service.getActions().find(a => a.id === 'utility-merge_pdf_fitz')!;
            const parsed = JSON.parse(action.actionJson);

            expect(parsed.operationName).toBe('Merge PDFs');
            expect(parsed.operationDefinition.type).toBe('Http');
            expect(parsed.operationDefinition.inputs.method).toBe('POST');
            expect(parsed.operationDefinition.runAfter).toEqual({});
            expect(parsed.operationDefinition.metadata.operationMetadataId).toBeTruthy();
        });

        it('assigns each action a category from the catalog', () => {
            service.getActions().forEach(action => expect(action.category).toBeTruthy());
        });
    });

    describe('buildBody', () => {
        it('uses catalog defaults when no values are supplied', () => {
            const action = service.getAction('csv_to_json')!;
            const body = service.buildBody(action);

            expect(body.delimiter).toBe(',');
            expect(body.first_row_headers).toBe('YES');
        });

        it('applies supplied values over defaults', () => {
            const action = service.getAction('csv_to_json')!;
            const body = service.buildBody(action, { delimiter: ';', skip_top_rows: 2 });

            expect(body.delimiter).toBe(';');
            expect(body.skip_top_rows).toBe(2);
        });

        it('omits optional parameters left empty', () => {
            const action = service.getAction('split_pdf_fitz')!;
            const body = service.buildBody(action, { split_text: null, split_regex: '', split_chunks: null });

            expect(body).not.toHaveProperty('split_text');
            expect(body).not.toHaveProperty('split_regex');
            expect(body).not.toHaveProperty('split_chunks');
            expect(body).toHaveProperty('file_content');
        });

        it('keeps required parameters even when empty', () => {
            const action = service.getAction('replace_text_pdf')!;
            const body = service.buildBody(action, { replace_text: '' });

            expect(body).toHaveProperty('replace_text', '');
        });

        it('sends a bare value for endpoints that declare rawBody', () => {
            const action = service.getAction('document_intel_text_replica')!;
            expect(service.buildBody(action)).toBe(action.rawBody);
        });
    });

    describe('applyConfig', () => {
        it('substitutes placeholders in an already generated action', () => {
            const action = service.getActions().find(a => a.id === 'utility-zip_files')!;
            const configured = service.applyConfig(action, {
                baseUrl: 'https://real.azurewebsites.net',
                key: 'realkey',
            });

            expect(configured.url).toBe('https://real.azurewebsites.net/api/zip_files?code=realkey');
            expect(configured.actionJson).toContain('https://real.azurewebsites.net');
            expect(configured.actionJson).not.toContain(BASE_URL_TOKEN);
        });
    });

    describe('hasUnresolvedTokens', () => {
        it('is true for an unconfigured preset', () => {
            const action = service.getActions()[0];
            expect(service.hasUnresolvedTokens(action)).toBe(true);
        });

        it('is false once a base url and key are configured', () => {
            const action = service.getActions({ baseUrl: 'https://x.azurewebsites.net', key: 'k' })[0];
            expect(service.hasUnresolvedTokens(action)).toBe(false);
        });

        it('is false in parameter mode', () => {
            const action = service.getActions({ keyMode: 'parameter' })[0];
            expect(service.hasUnresolvedTokens(action)).toBe(false);
        });
    });

    describe('getParseJsonAction', () => {
        it('builds a file-shaped schema for endpoints returning a file', () => {
            const action = service.getParseJsonAction(service.getAction('merge_pdf_fitz')!)!;
            const parsed = JSON.parse(action.actionJson);

            expect(parsed.operationDefinition.type).toBe('ParseJson');
            expect(parsed.operationDefinition.inputs.schema.properties).toHaveProperty('$content');
            expect(parsed.operationDefinition.inputs.content).toBe("@body('Merge_PDFs')");
        });

        it('builds an array schema for endpoints returning many files', () => {
            const action = service.getParseJsonAction(service.getAction('pdf_to_images')!)!;
            const schema = JSON.parse(action.actionJson).operationDefinition.inputs.schema;

            expect(schema.type).toBe('array');
            expect(schema.items.properties).toHaveProperty('$content-type');
        });

        it('builds the values wrapper for for-each endpoints', () => {
            const action = service.getParseJsonAction(service.getAction('for_each_filter')!)!;
            const schema = JSON.parse(action.actionJson).operationDefinition.inputs.schema;

            expect(schema.properties).toHaveProperty('values');
            expect(schema.properties).toHaveProperty('no_value_loop_array');
        });

        it('returns null for endpoints that return plain text or html', () => {
            expect(service.getParseJsonAction(service.getAction('word_to_html')!)).toBeNull();
            expect(service.getParseJsonAction(service.getAction('document_intel_text_replica')!)).toBeNull();
        });
    });
});
