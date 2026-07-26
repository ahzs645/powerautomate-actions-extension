// Covers the modern (V3) editor paste path: the payload written to the OS
// clipboard, which the designer reads on Ctrl+V.

import { ContentService } from '../../services';
import { ActionType, AppElement, IActionModel, ICommunicationChromeMessage } from '../../models';
import { IStorageService } from '../../services/interfaces';
import { utilityActionsService } from '../../services/UtilityActionsService';

describe('ContentService.setSelectedActionsIntoClipboardV3', () => {
    let contentService: ContentService;

    beforeEach(() => {
        contentService = new ContentService(
            {} as jest.Mocked<IStorageService>,
            { sendRequest: jest.fn() } as any
        );
    });

    const send = (actions: IActionModel[]) => {
        const message: ICommunicationChromeMessage = {
            actionType: ActionType.SetSelectedActionsIntoClipboardV3,
            message: actions,
            from: AppElement.ReactApp,
            to: AppElement.Content,
        };
        const result = contentService.setSelectedActionsIntoClipboardV3(message);
        return result ? JSON.parse(result) : undefined;
    };

    const buildAction = (title: string, operationDefinition: any, id = title): IActionModel => ({
        id,
        title,
        method: 'POST',
        icon: '',
        url: '',
        actionJson: JSON.stringify({ operationName: title, operationDefinition }),
    });

    it('wraps selected actions in a Copy_Container scope', () => {
        const payload = send([buildAction('Test', { type: 'Compose', inputs: 'hello' })]);

        expect(payload.nodeId).toBe('Copy_Container');
        expect(payload.isScopeNode).toBe(true);
        expect(payload.mslaNode).toBe(true);
        expect(payload.serializedValue.type).toBe('Scope');
    });

    it('inserts a utility preset the designer can paste', () => {
        const preset = utilityActionsService
            .getActions({ baseUrl: 'https://utils.azurewebsites.net', key: 'k' })
            .find(a => a.id === 'utility-merge_pdf_fitz')!;

        const payload = send([preset]);
        const action = payload.serializedValue.actions['Merge_PDFs'];

        expect(action).toBeDefined();
        expect(action.type).toBe('Http');
        expect(action.inputs.uri).toBe('https://utils.azurewebsites.net/api/merge_pdf_fitz?code=k');
        expect(action.runAfter).toEqual({});
    });

    // Regression: a Scope preset has no `inputs`, so reading inputs.host threw
    // and no action reached the clipboard at all.
    it('handles Scope actions that have no inputs', () => {
        const scope = buildAction('Try Catch', {
            type: 'Scope',
            actions: { Try: { type: 'Scope', actions: {}, runAfter: {} } },
            runAfter: {},
        });

        expect(() => send([scope])).not.toThrow();

        const payload = send([scope]);
        expect(payload.serializedValue.actions['Try_Catch'].type).toBe('Scope');
    });

    // Regression: identical titles collided on the same key, silently dropping
    // all but the last action.
    it('gives same-titled actions unique keys', () => {
        const payload = send([
            buildAction('Compose', { type: 'Compose', inputs: 'one' }, 'a'),
            buildAction('Compose', { type: 'Compose', inputs: 'two' }, 'b'),
        ]);

        const keys = Object.keys(payload.serializedValue.actions);
        expect(keys).toEqual(['Compose', 'Compose_1']);
        expect(payload.serializedValue.actions['Compose'].inputs).toBe('one');
        expect(payload.serializedValue.actions['Compose_1'].inputs).toBe('two');
    });

    it('replaces spaces in titles so the key is designer-safe', () => {
        const payload = send([buildAction('Merge Word Documents', { type: 'Compose', inputs: '' })]);
        expect(Object.keys(payload.serializedValue.actions)).toEqual(['Merge_Word_Documents']);
    });

    it('promotes connectionName to connection for connector actions', () => {
        const payload = send([buildAction('Get file', {
            type: 'OpenApiConnection',
            inputs: { host: { apiId: '/apis/shared_onedriveforbusiness', connectionName: 'shared_onedrive' } },
        })]);

        expect(payload.serializedValue.actions['Get_file'].inputs.host.connection).toBe('shared_onedrive');
    });

    it('skips actions with unparseable JSON rather than failing the batch', () => {
        const broken: IActionModel = {
            id: 'broken', title: 'Broken', method: '', icon: '', url: '', actionJson: '{ not json',
        };
        const good = buildAction('Good', { type: 'Compose', inputs: 'ok' });

        const payload = send([broken, good]);

        expect(Object.keys(payload.serializedValue.actions)).toEqual(['Good']);
    });

    it('returns undefined when nothing usable was selected', () => {
        const broken: IActionModel = {
            id: 'b', title: 'B', method: '', icon: '', url: '', actionJson: '{ not json',
        };

        expect(send([broken])).toBeUndefined();
    });

    it('returns undefined for an empty selection', () => {
        expect(send([])).toBeUndefined();
    });
});
