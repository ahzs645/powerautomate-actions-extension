import { useCallback, useEffect, useState } from "react";
import { IconButton, MessageBar, MessageBarType, Panel, PanelType } from '@fluentui/react';
import { IActionModel } from "../models";
import { PlaceholderService } from "../services/PlaceholderService";
import ExpressionAwareTextField from "./ExpressionAwareTextField";

/** Panels leave ~180px of the 600px popup visible so the list stays in context. */
export const POPUP_PANEL_WIDTH = '420px';
export const popupPanelStyles = {
    main: { maxWidth: '100vw' },
    content: { paddingBottom: 20 },
};

export interface IActionDetailsPanelProps {
    action: IActionModel | null;
    isOpen: boolean;
    onDismiss: () => void;
    placeholderService: PlaceholderService;
    /** Enables edit mode; omitted for read-only sources such as the library. */
    onSave?: (action: IActionModel) => void;
}

interface IParsedDetails {
    parsedBody: any;
    parsedHeaders: any;
    parsedActionData: any;
}

/**
 * Pulls URL/headers/body out of either shape we store: designer actions keep
 * them under operationDefinition.inputs (plain HTTP or the SharePoint
 * connector's parameters/*), library packs may keep them at the top level.
 */
export function parseActionDetails(action: IActionModel | null): IParsedDetails {
    if (!action) {
        return { parsedBody: null, parsedHeaders: null, parsedActionData: null };
    }

    let parsedBody: any = null;
    let parsedHeaders: any = null;
    let parsedActionData: any = null;

    try {
        parsedActionData = JSON.parse(action.actionJson);
        const inputs = parsedActionData?.operationDefinition?.inputs;
        parsedBody = inputs?.body ?? inputs?.parameters?.["parameters/body"] ?? inputs?.parameters?.Body
            ?? parsedActionData?.body ?? action.body;
        parsedHeaders = inputs?.headers ?? inputs?.parameters?.["parameters/headers"] ?? parsedActionData?.headers ?? null;
    } catch {
        parsedBody = action.body;
    }

    return { parsedBody, parsedHeaders, parsedActionData };
}

function getSharePointUrlParts(url: string): { dataset: string; uri: string } | null {
    const vtiSeparator = '/_vti_bin';
    const apiSeparator = '/_api';
    const normalizedUrl = (url || '').trim();

    if (normalizedUrl.indexOf(vtiSeparator) > -1) {
        const urlSplit = normalizedUrl.split(vtiSeparator);
        return { dataset: urlSplit[0], uri: `_vti_bin${urlSplit[1] || ''}` };
    }

    if (normalizedUrl.indexOf(apiSeparator) > -1) {
        const urlSplit = normalizedUrl.split(apiSeparator);
        return { dataset: urlSplit[0], uri: `_api${urlSplit[1] || ''}` };
    }

    return null;
}

/** Writes edited URL/headers/body back into whichever input shape the action uses. */
export function buildUpdatedActionJson(action: IActionModel, updatedUrl: string, headers: any, body: any): string {
    let parsedActionJson: any = null;
    try {
        parsedActionJson = JSON.parse(action.actionJson);
    } catch {
        return action.actionJson;
    }

    const inputs = parsedActionJson?.operationDefinition?.inputs;
    if (!inputs) {
        return JSON.stringify(parsedActionJson);
    }

    const has = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
    const setOrDelete = (obj: any, key: string) => {
        if (body === null || typeof body === 'undefined') {
            delete obj[key];
        } else {
            obj[key] = body;
        }
    };

    if (has(inputs, 'uri')) { inputs.uri = updatedUrl; }
    if (has(inputs, 'headers')) { inputs.headers = headers; }
    if (has(inputs, 'body')) { setOrDelete(inputs, 'body'); }

    if (inputs.parameters) {
        const parameters = inputs.parameters;
        if (has(parameters, 'Uri')) { parameters.Uri = updatedUrl; }

        if (has(parameters, 'parameters/uri')) {
            const sharePointParts = getSharePointUrlParts(updatedUrl);
            if (sharePointParts) {
                parameters['dataset'] = sharePointParts.dataset;
                parameters['parameters/uri'] = sharePointParts.uri;
            } else {
                parameters['parameters/uri'] = updatedUrl;
            }
        }

        if (has(parameters, 'parameters/headers')) { parameters['parameters/headers'] = headers; }
        if (has(parameters, 'parameters/body')) { setOrDelete(parameters, 'parameters/body'); }
        if (has(parameters, 'Body')) { setOrDelete(parameters, 'Body'); }
    }

    return JSON.stringify(parsedActionJson);
}

const stringify = (value: any) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const ActionDetailsPanel: React.FC<IActionDetailsPanelProps> = ({ action, isOpen, onDismiss, placeholderService, onSave }) => {
    const [current, setCurrent] = useState<IActionModel | null>(action);
    const [isEditing, setIsEditing] = useState(false);
    const [editedUrl, setEditedUrl] = useState('');
    const [editedHeaders, setEditedHeaders] = useState('');
    const [editedBody, setEditedBody] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        setCurrent(action);
        setIsEditing(false);
        setValidationError(null);
    }, [action]);

    const startEditing = useCallback(() => {
        if (!current) { return; }
        const details = parseActionDetails(current);
        setEditedUrl(current.url || '');
        setEditedHeaders(details.parsedHeaders ? JSON.stringify(details.parsedHeaders, null, 2) : '{}');
        setEditedBody(details.parsedBody === undefined || details.parsedBody === null ? 'null' : JSON.stringify(details.parsedBody, null, 2));
        setValidationError(null);
        setIsEditing(true);
    }, [current]);

    const cancelEditing = useCallback(() => {
        setIsEditing(false);
        setValidationError(null);
    }, []);

    const save = useCallback(() => {
        if (!current || !onSave) { return; }

        try {
            const parsedHeaders = JSON.parse(editedHeaders);
            const parsedBody = JSON.parse(editedBody);
            const updatedUrl = editedUrl.trim();

            if (!updatedUrl) {
                setValidationError('URL cannot be empty.');
                return;
            }

            const updatedAction: IActionModel = {
                ...current,
                url: updatedUrl,
                body: parsedBody,
                actionJson: buildUpdatedActionJson(current, updatedUrl, parsedHeaders, parsedBody),
            };

            onSave(updatedAction);
            setCurrent(updatedAction);
            setValidationError(null);
            setIsEditing(false);
        } catch {
            setValidationError('Headers and Body must be valid JSON.');
        }
    }, [current, onSave, editedHeaders, editedBody, editedUrl]);

    if (!current) { return null; }

    const { parsedBody, parsedHeaders, parsedActionData } = parseActionDetails(current);

    const renderEditControls = () => onSave && (
        <div className="details-panel-toolbar">
            {isEditing ? (
                <>
                    <IconButton iconProps={{ iconName: 'CheckMark' }} title="Save" ariaLabel="Save changes" onClick={save} />
                    <IconButton iconProps={{ iconName: 'Cancel' }} title="Cancel" ariaLabel="Cancel editing" onClick={cancelEditing} />
                </>
            ) : (
                <IconButton iconProps={{ iconName: 'Edit' }} title="Edit" ariaLabel="Edit URL, headers and body" onClick={startEditing} />
            )}
        </div>
    );

    return (
        <Panel
            isOpen={isOpen}
            onDismiss={onDismiss}
            type={PanelType.custom}
            customWidth={POPUP_PANEL_WIDTH}
            headerText={current.title}
            closeButtonAriaLabel="Close"
            isLightDismiss
            styles={popupPanelStyles}
        >
            <div className="details-panel">
                {renderEditControls()}

                {validationError && (
                    <MessageBar messageBarType={MessageBarType.error} isMultiline={true}>
                        {validationError}
                    </MessageBar>
                )}

                <section className="details-panel-section">
                    <h3 className="details-panel-label">URL</h3>
                    <ExpressionAwareTextField
                        value={isEditing ? editedUrl : current.url}
                        placeholderService={placeholderService}
                        onChange={isEditing ? setEditedUrl : undefined}
                        ariaLabel="URL"
                    />
                </section>

                <section className="details-panel-section">
                    <h3 className="details-panel-label">Method</h3>
                    <div className="details-panel-code">{current.method}</div>
                </section>

                {(isEditing || parsedHeaders) && (
                    <section className="details-panel-section">
                        <h3 className="details-panel-label">Headers</h3>
                        <div className="details-panel-scroll">
                            <ExpressionAwareTextField
                                value={isEditing ? editedHeaders : JSON.stringify(parsedHeaders, null, 2)}
                                placeholderService={placeholderService}
                                onChange={isEditing ? setEditedHeaders : undefined}
                                multiline={true}
                                rows={8}
                                ariaLabel="Headers"
                            />
                        </div>
                    </section>
                )}

                {(isEditing || (parsedBody !== undefined && parsedBody !== null)) && (
                    <section className="details-panel-section">
                        <h3 className="details-panel-label">Body</h3>
                        <div className="details-panel-scroll">
                            <ExpressionAwareTextField
                                value={isEditing ? editedBody : stringify(parsedBody)}
                                placeholderService={placeholderService}
                                onChange={isEditing ? setEditedBody : undefined}
                                multiline={true}
                                rows={10}
                                ariaLabel="Body"
                            />
                        </div>
                    </section>
                )}

                <section className="details-panel-section">
                    <h3 className="details-panel-label">Raw action JSON</h3>
                    <pre className="details-panel-code details-panel-code--raw">
                        {parsedActionData ? JSON.stringify(parsedActionData, null, 2) : current.actionJson}
                    </pre>
                </section>

                {renderEditControls()}
            </div>
        </Panel>
    );
};

export default ActionDetailsPanel;
