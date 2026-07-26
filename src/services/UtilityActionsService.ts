// UtilityActionsService - materializes HTTP action presets from the bundled
// utility function catalog.
//
// The catalog (src/data/utility-catalog.json) is the single source of truth. This
// service turns each entry into an IActionModel whose actionJson is the exact
// `operationDefinition` envelope the modern Power Automate designer accepts, so a
// preset can be pasted straight into a live flow.

import catalogJson from '../data/utility-catalog.json';
import { HttpActionBrandColor, HttpActionIcon } from '../constants/ActionIcons';
import { IActionModel } from '../models';
import {
    IUtilityAction,
    IUtilityCatalog,
    IUtilityParameter,
} from '../models/IUtilityCatalog';

const catalog = catalogJson as IUtilityCatalog;

export type FunctionKeyMode = 'inline' | 'parameter';

export interface IUtilityFunctionConfig {
    /** Function App origin, e.g. https://my-utils.azurewebsites.net (no trailing slash). */
    baseUrl?: string;
    /** Function key. Only used when keyMode is 'inline'. */
    key?: string;
    /**
     * 'inline' writes the key into the URI.
     * 'parameter' emits @{parameters('...')} references instead, which is what a
     * solution-bound flow should use.
     */
    keyMode?: FunctionKeyMode;
    /** Parameter name used for the base URL in 'parameter' mode. */
    baseUrlParameterName?: string;
    /** Parameter name used for the key in 'parameter' mode. */
    keyParameterName?: string;
    /** Include the four eval()-backed endpoints. Off by default. */
    includeUnsafe?: boolean;
}

export const defaultUtilityFunctionConfig: Required<
    Pick<IUtilityFunctionConfig, 'keyMode' | 'baseUrlParameterName' | 'keyParameterName' | 'includeUnsafe'>
> = {
    keyMode: 'inline',
    baseUrlParameterName: 'AzureFunctionBaseUrl',
    keyParameterName: 'AzureFunctionKey',
    includeUnsafe: false,
};

/** Placeholder left in the URI when no base URL has been configured yet. */
export const BASE_URL_TOKEN = '{{functionBaseUrl}}';
/** Placeholder left in the URI when no key has been configured yet. */
export const KEY_TOKEN = '{{functionKey}}';

export class UtilityActionsService {

    public getCatalog(): IUtilityCatalog {
        return catalog;
    }

    public getCategories(): string[] {
        return catalog.categories;
    }

    public getAction(route: string): IUtilityAction | undefined {
        return catalog.actions.find(action => action.route === route);
    }

    /**
     * Build the preset list. Unsafe endpoints are omitted unless explicitly
     * opted into via config.includeUnsafe.
     */
    public getActions(config: IUtilityFunctionConfig = {}): IActionModel[] {
        const includeUnsafe = config.includeUnsafe ?? defaultUtilityFunctionConfig.includeUnsafe;

        return catalog.actions
            .filter(action => includeUnsafe || !action.unsafe)
            .map(action => this.toActionModel(action, config));
    }

    /**
     * Build the "Parse JSON" companion for an endpoint, or null when the endpoint
     * returns something that does not need parsing (plain text or HTML).
     */
    public getParseJsonAction(
        action: IUtilityAction,
        overrides?: Record<string, any>
    ): IActionModel | null {
        const schema = this.getResponseSchema(action);
        if (!schema) { return null; }

        const title = `Parse ${action.title} Response`;
        const operationDefinition = {
            type: 'ParseJson',
            inputs: {
                content: `@body('${this.toActionName(action.title)}')`,
                schema,
            },
            runAfter: {},
            metadata: { operationMetadataId: this.newGuid() },
        };

        return {
            id: `utility-parse-${action.route}`,
            title,
            url: '',
            method: '',
            icon: HttpActionIcon,
            category: action.category,
            packId: catalog.packId,
            description: `Parse JSON schema matching the response of ${action.title}.`,
            actionJson: this.wrapOperation(title, operationDefinition),
            isFavorite: false,
            isSelected: false,
            ...overrides,
        };
    }

    /** All Parse JSON companions, in catalog order. */
    public getParseJsonActions(config: IUtilityFunctionConfig = {}): IActionModel[] {
        const includeUnsafe = config.includeUnsafe ?? defaultUtilityFunctionConfig.includeUnsafe;
        return catalog.actions
            .filter(action => includeUnsafe || !action.unsafe)
            .map(action => this.getParseJsonAction(action))
            .filter((action): action is IActionModel => action !== null);
    }

    /**
     * Build the request URI for an endpoint. In 'parameter' mode the key never
     * appears in the output.
     */
    public buildUri(route: string, config: IUtilityFunctionConfig = {}): string {
        const keyMode = config.keyMode ?? defaultUtilityFunctionConfig.keyMode;

        if (keyMode === 'parameter') {
            const baseParam = config.baseUrlParameterName || defaultUtilityFunctionConfig.baseUrlParameterName;
            const keyParam = config.keyParameterName || defaultUtilityFunctionConfig.keyParameterName;
            return `@{parameters('${baseParam}')}/api/${route}?code=@{parameters('${keyParam}')}`;
        }

        const base = this.normalizeBaseUrl(config.baseUrl) || BASE_URL_TOKEN;
        const key = config.key ? config.key : KEY_TOKEN;
        return `${base}/api/${route}?code=${key}`;
    }

    /**
     * Build the request body from catalog parameter defaults, applying any
     * user-supplied values. Optional parameters whose value is null/empty are
     * omitted so the pasted action stays readable.
     */
    public buildBody(action: IUtilityAction, values: Record<string, any> = {}): any {
        if (action.rawBody !== undefined) {
            return values.__raw !== undefined ? values.__raw : action.rawBody;
        }

        const body: Record<string, any> = {};
        for (const parameter of action.parameters) {
            const value = Object.prototype.hasOwnProperty.call(values, parameter.name)
                ? values[parameter.name]
                : parameter.default;

            if (!parameter.required && this.isEmpty(value)) { continue; }
            if (value === undefined) { continue; }

            body[parameter.name] = value;
        }
        return body;
    }

    /**
     * Turn a catalog entry into a pasteable action. `values` lets the parameter
     * form override defaults before the action is generated.
     */
    public toActionModel(
        action: IUtilityAction,
        config: IUtilityFunctionConfig = {},
        values: Record<string, any> = {}
    ): IActionModel {
        const uri = this.buildUri(action.route, config);
        const body = this.buildBody(action, values);

        const operationDefinition = {
            type: 'Http',
            inputs: {
                method: 'POST',
                uri,
                headers: { 'Content-Type': 'application/json' },
                body,
            },
            runAfter: {},
            metadata: { operationMetadataId: this.newGuid() },
        };

        return {
            id: `utility-${action.route}`,
            title: action.title,
            url: uri,
            method: 'POST',
            icon: HttpActionIcon,
            category: action.category,
            packId: catalog.packId,
            description: action.description,
            warning: action.unsafe,
            actionJson: this.wrapOperation(action.title, operationDefinition),
            isFavorite: false,
            isSelected: false,
        };
    }

    /**
     * Replace {{functionBaseUrl}} / {{functionKey}} placeholders in an already
     * generated action. Used when a preset was loaded from a remote pack rather
     * than built locally.
     */
    public applyConfig(action: IActionModel, config: IUtilityFunctionConfig): IActionModel {
        const keyMode = config.keyMode ?? defaultUtilityFunctionConfig.keyMode;

        let baseReplacement: string;
        let keyReplacement: string;

        if (keyMode === 'parameter') {
            const baseParam = config.baseUrlParameterName || defaultUtilityFunctionConfig.baseUrlParameterName;
            const keyParam = config.keyParameterName || defaultUtilityFunctionConfig.keyParameterName;
            baseReplacement = `@{parameters('${baseParam}')}`;
            keyReplacement = `@{parameters('${keyParam}')}`;
        } else {
            baseReplacement = this.normalizeBaseUrl(config.baseUrl) || BASE_URL_TOKEN;
            keyReplacement = config.key || KEY_TOKEN;
        }

        const substitute = (input: string) => (input || '')
            .split(BASE_URL_TOKEN).join(baseReplacement)
            .split(KEY_TOKEN).join(keyReplacement);

        return {
            ...action,
            url: substitute(action.url),
            actionJson: substitute(action.actionJson),
        };
    }

    /** True when the action still carries an unresolved placeholder. */
    public hasUnresolvedTokens(action: IActionModel): boolean {
        const haystack = `${action.url || ''}${action.actionJson || ''}`;
        return haystack.includes(BASE_URL_TOKEN) || haystack.includes(KEY_TOKEN);
    }

    /** Parse JSON schema for an endpoint's response, or null when parsing is pointless. */
    private getResponseSchema(action: IUtilityAction): any | null {
        const fileObject = {
            type: 'object',
            properties: {
                '$content-type': { type: 'string' },
                '$content': { type: 'string' },
            },
        };

        switch (action.returns) {
            case 'file':
                return fileObject;
            case 'fileArray':
                return { type: 'array', items: fileObject };
            case 'jsonArray':
                return { type: 'array', items: { type: 'object' } };
            case 'values':
                return {
                    type: 'object',
                    properties: {
                        values: { type: 'array', items: { type: 'object' } },
                        no_value_loop_array: { type: 'array' },
                    },
                };
            case 'object':
                return { type: 'object' };
            case 'html':
            case 'text':
            default:
                return null;
        }
    }

    /** Designer envelope around an operation definition. */
    private wrapOperation(name: string, operationDefinition: any): string {
        return JSON.stringify(
            {
                id: this.newGuid(),
                brandColor: HttpActionBrandColor,
                connectorDisplayName: 'HTTP',
                icon: HttpActionIcon,
                isTrigger: false,
                operationName: name,
                operationDefinition,
            },
            null,
            2
        );
    }

    /** Power Automate action names use underscores rather than spaces. */
    private toActionName(title: string): string {
        return title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    private normalizeBaseUrl(baseUrl?: string): string {
        if (!baseUrl) { return ''; }
        return baseUrl.trim().replace(/\/+$/, '');
    }

    private isEmpty(value: any): boolean {
        if (value === null || value === undefined) { return true; }
        if (typeof value === 'string') { return value.trim() === ''; }
        if (Array.isArray(value)) { return value.length === 0; }
        return false;
    }

    private newGuid(): string {
        let seed = Date.now();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
            const random = (seed + Math.random() * 16) % 16 | 0;
            seed = Math.floor(seed / 16);
            return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
        });
    }
}

export const utilityActionsService = new UtilityActionsService();
