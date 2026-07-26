// UtilityActionForm - builds the request body for a utility endpoint before the
// action is pasted, so the user fills in a form instead of hand-editing JSON in
// the designer.

import { useCallback, useMemo, useState } from 'react';
import {
    DefaultButton,
    Dropdown,
    IDropdownOption,
    MessageBar,
    MessageBarType,
    Panel,
    PanelType,
    PrimaryButton,
    Stack,
    Text,
    TextField,
    Toggle,
} from '@fluentui/react';
import { IActionModel } from '../models';
import { IUtilityAction, IUtilityParameter } from '../models/IUtilityCatalog';
import { IUtilityFunctionConfig, utilityActionsService } from '../services/UtilityActionsService';

export interface IUtilityActionFormProps {
    action: IUtilityAction | null;
    config: IUtilityFunctionConfig;
    isOpen: boolean;
    onDismiss: () => void;
    /** Receives the generated action, ready to select or copy. */
    onApply: (action: IActionModel) => void;
}

const BOOLEAN_OPTIONS: IDropdownOption[] = [
    { key: 'YES', text: 'YES' },
    { key: 'NO', text: 'NO' },
];

/** Parameters whose value is a YES/NO string rather than a real boolean. */
const YES_NO_PARAMETERS = new Set([
    'first_row_headers',
    'type_detect',
    'fit_to_page',
    'text_pdf_to_jpg',
]);

function toEditorValue(value: any): string {
    if (value === null || value === undefined) { return ''; }
    if (typeof value === 'string') { return value; }
    return JSON.stringify(value, null, 2);
}

const UtilityActionForm: React.FC<IUtilityActionFormProps> = ({
    action,
    config,
    isOpen,
    onDismiss,
    onApply,
}) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Re-seed the form whenever a different endpoint is opened.
    const seeded = useMemo(() => {
        if (!action) { return {}; }
        const initial: Record<string, string> = {};
        for (const parameter of action.parameters) {
            initial[parameter.name] = toEditorValue(parameter.default);
        }
        if (action.rawBody !== undefined) {
            initial.__raw = toEditorValue(action.rawBody);
        }
        return initial;
    }, [action]);

    const currentValues = Object.keys(values).length > 0 ? values : seeded;

    const setValue = useCallback((name: string, value: string) => {
        setValues(prev => ({ ...(Object.keys(prev).length > 0 ? prev : seeded), [name]: value }));
        setErrors(prev => {
            if (!prev[name]) { return prev; }
            const next = { ...prev };
            delete next[name];
            return next;
        });
    }, [seeded]);

    const reset = useCallback(() => {
        setValues({});
        setErrors({});
    }, []);

    const handleDismiss = useCallback(() => {
        reset();
        onDismiss();
    }, [reset, onDismiss]);

    /**
     * Coerce the editor's string back to the type the endpoint expects.
     * Power Automate expressions (@{...}, @body(...)) are always passed through
     * as strings, even where the endpoint wants an array or number, because the
     * runtime resolves them before the request is sent.
     */
    const parseValue = useCallback((parameter: IUtilityParameter, raw: string): any => {
        const trimmed = (raw || '').trim();
        if (trimmed === '') { return parameter.required ? '' : null; }
        if (trimmed.startsWith('@')) { return trimmed; }

        switch (parameter.type) {
            case 'number': {
                const parsed = Number(trimmed);
                if (Number.isNaN(parsed)) { throw new Error('Expected a number'); }
                return parsed;
            }
            case 'boolean':
                return trimmed.toLowerCase() === 'true';
            case 'array':
            case 'stringArray':
            case 'file':
            case 'fileArray':
                try {
                    return JSON.parse(trimmed);
                } catch {
                    throw new Error('Expected valid JSON');
                }
            case 'string':
            default:
                return trimmed;
        }
    }, []);

    const handleApply = useCallback(() => {
        if (!action) { return; }

        const parsed: Record<string, any> = {};
        const nextErrors: Record<string, string> = {};

        if (action.rawBody !== undefined) {
            const raw = (currentValues.__raw || '').trim();
            if (raw === '') {
                nextErrors.__raw = 'Required';
            } else {
                parsed.__raw = raw.startsWith('@') ? raw : (() => {
                    try { return JSON.parse(raw); } catch { return raw; }
                })();
            }
        }

        for (const parameter of action.parameters) {
            const raw = currentValues[parameter.name] ?? '';
            if (parameter.required && raw.trim() === '') {
                nextErrors[parameter.name] = 'Required';
                continue;
            }
            try {
                parsed[parameter.name] = parseValue(parameter, raw);
            } catch (e: any) {
                nextErrors[parameter.name] = e?.message || 'Invalid value';
            }
        }

        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        onApply(utilityActionsService.toActionModel(action, config, parsed));
        reset();
        onDismiss();
    }, [action, currentValues, config, parseValue, onApply, reset, onDismiss]);

    const renderParameter = useCallback((parameter: IUtilityParameter) => {
        const value = currentValues[parameter.name] ?? '';
        const error = errors[parameter.name];

        if (YES_NO_PARAMETERS.has(parameter.name)) {
            return (
                <Dropdown
                    key={parameter.name}
                    label={parameter.name}
                    selectedKey={value || 'NO'}
                    options={BOOLEAN_OPTIONS}
                    onChange={(_e, option) => setValue(parameter.name, (option?.key as string) || '')}
                    errorMessage={error}
                    styles={{ root: { marginBottom: 4 } }}
                />
            );
        }

        if (parameter.type === 'boolean') {
            return (
                <Toggle
                    key={parameter.name}
                    label={parameter.name}
                    checked={value === 'true'}
                    onText="true"
                    offText="false"
                    onChange={(_e, checked) => setValue(parameter.name, checked ? 'true' : 'false')}
                    styles={{ root: { marginBottom: 4 } }}
                />
            );
        }

        const isMultiline = parameter.type === 'array'
            || parameter.type === 'stringArray'
            || parameter.type === 'fileArray'
            || (value?.length ?? 0) > 60;

        return (
            <TextField
                key={parameter.name}
                label={`${parameter.name}${parameter.required ? ' *' : ''}`}
                value={value}
                multiline={isMultiline}
                rows={isMultiline ? 3 : undefined}
                onChange={(_e, newValue) => setValue(parameter.name, newValue || '')}
                description={parameter.description}
                errorMessage={error}
                styles={{
                    root: { marginBottom: 4 },
                    field: { fontFamily: 'Consolas, monospace', fontSize: 12 },
                }}
            />
        );
    }, [currentValues, errors, setValue]);

    if (!action) { return null; }

    return (
        <Panel
            isOpen={isOpen}
            onDismiss={handleDismiss}
            type={PanelType.custom}
            customWidth="480px"
            headerText={action.title}
            closeButtonAriaLabel="Close"
            onRenderFooterContent={() => (
                <Stack horizontal tokens={{ childrenGap: 8 }}>
                    <PrimaryButton text="Add to selection" onClick={handleApply} />
                    <DefaultButton text="Reset" onClick={reset} />
                    <DefaultButton text="Cancel" onClick={handleDismiss} />
                </Stack>
            )}
            isFooterAtBottom
        >
            <Stack tokens={{ childrenGap: 10 }} styles={{ root: { paddingTop: 8 } }}>
                <Text variant="small">{action.description}</Text>

                {action.unsafe && (
                    <MessageBar messageBarType={MessageBarType.severeWarning}>
                        {action.unsafe}
                    </MessageBar>
                )}

                <Text variant="xSmall" styles={{ root: { fontFamily: 'Consolas, monospace', color: '#605e5c' } }}>
                    POST {utilityActionsService.buildUri(action.route, config)}
                </Text>

                <MessageBar messageBarType={MessageBarType.info} isMultiline>
                    Values starting with <code>@</code> are passed through as Power Automate
                    expressions. Everything else is sent literally.
                </MessageBar>

                {action.rawBody !== undefined ? (
                    <TextField
                        label="Request body *"
                        multiline
                        rows={4}
                        value={currentValues.__raw ?? ''}
                        onChange={(_e, newValue) => setValue('__raw', newValue || '')}
                        description="This endpoint takes a bare value as the whole body."
                        errorMessage={errors.__raw}
                        styles={{ field: { fontFamily: 'Consolas, monospace', fontSize: 12 } }}
                    />
                ) : (
                    action.parameters.map(renderParameter)
                )}
            </Stack>
        </Panel>
    );
};

export default UtilityActionForm;
