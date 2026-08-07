import { DesignerCopyService } from '../../services/DesignerCopyService';

describe('DesignerCopyService', () => {
    let service: DesignerCopyService;

    beforeEach(() => {
        service = new DesignerCopyService();
    });

    describe('parse - serialized node shape (modern designer / extension paste format)', () => {
        const payload = {
            nodeId: 'Get_file_content',
            serializedValue: {
                type: 'OpenApiConnection',
                inputs: {
                    host: { operationId: 'GetFileContent' },
                    parameters: { id: 'abc' },
                },
                runAfter: { Previous_step: ['Succeeded'] },
                metadata: { operationMetadataId: '123' },
            },
            allConnectionData: {},
            staticResults: {},
            isScopeNode: false,
            mslaNode: true,
        };

        test('imports the action with title derived from nodeId', () => {
            const result = service.parse(JSON.stringify(payload));

            expect(result).not.toBeNull();
            expect(result!.title).toBe('Get file content');
        });

        test('wraps serializedValue as a pasteable operationDefinition with runAfter reset', () => {
            const result = service.parse(JSON.stringify(payload));

            const actionJson = JSON.parse(result!.actionJson);
            expect(actionJson.operationName).toBe('Get file content');
            expect(actionJson.isTrigger).toBe(false);
            expect(actionJson.operationDefinition.type).toBe('OpenApiConnection');
            expect(actionJson.operationDefinition.inputs).toEqual(payload.serializedValue.inputs);
            expect(actionJson.operationDefinition.runAfter).toEqual({});
        });

        test('falls back to a generic title when nodeId is missing', () => {
            const { nodeId, ...withoutNodeId } = payload;
            const result = service.parse(JSON.stringify(withoutNodeId));

            expect(result).not.toBeNull();
            expect(result!.title).toBe('Copied action');
        });
    });

    describe('parse - legacy nodeData shape (localStorage fallback of older designers)', () => {
        const legacyPayload = {
            nodeId: 'Compose',
            operationInfo: { connectorId: 'connector', operationId: 'compose', type: 'Compose' },
            nodeData: {
                id: 'Compose',
                nodeInputs: {},
                nodeOutputs: {},
                nodeDependencies: {},
                operationMetadata: { iconUri: 'https://example.com/icon.png', brandColor: '#333' },
                settings: {},
                actionMetadata: { operationMetadataId: 'xyz' },
                repetitionInfo: { repetitionReferences: [] },
            },
            connectionData: '',
        };

        test('preserves the raw payload and extracts title and icon', () => {
            const raw = JSON.stringify(legacyPayload);
            const result = service.parse(raw);

            expect(result).not.toBeNull();
            expect(result!.actionJson).toBe(raw);
            expect(result!.title).toBe('Compose');
            expect(result!.icon).toBe('https://example.com/icon.png');
        });
    });

    describe('parse - rejects anything that is not a designer copy', () => {
        test.each([
            ['null', null],
            ['undefined', undefined],
            ['empty string', ''],
            ['plain text', 'hello world'],
            ['arbitrary JSON object', JSON.stringify({ foo: 'bar' })],
            ['JSON array', JSON.stringify([1, 2, 3])],
            ['JSON string literal', JSON.stringify('a string')],
            ['mslaNode without serializedValue', JSON.stringify({ mslaNode: true })],
            ['serializedValue without mslaNode', JSON.stringify({ serializedValue: { type: 'Http' } })],
        ])('returns null for %s', (_label, input) => {
            expect(service.parse(input as any)).toBeNull();
        });
    });
});
