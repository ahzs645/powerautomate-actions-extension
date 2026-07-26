// Types for the bundled utility function catalog (src/data/utility-catalog.json).
// The catalog is the single source of truth for utility presets: it drives the
// generated HTTP actions, the parameter form, and the companion Parse JSON actions.

export type UtilityParameterType =
    | 'string'
    | 'number'
    | 'boolean'
    | 'array'
    | 'stringArray'
    | 'file'
    | 'fileArray';

/** Shape of the value an endpoint returns, used to build a Parse JSON companion. */
export type UtilityReturnType =
    | 'file'
    | 'fileArray'
    | 'jsonArray'
    | 'values'
    | 'object'
    | 'html'
    | 'text';

export interface IUtilityParameter {
    name: string;
    type: UtilityParameterType;
    required: boolean;
    description: string;
    default?: any;
}

export interface IUtilityAction {
    /** Azure Function route, e.g. "merge_pdf_fitz". */
    route: string;
    title: string;
    category: string;
    description: string;
    returns: UtilityReturnType;
    parameters: IUtilityParameter[];
    /**
     * Set when the endpoint takes a bare value as the whole request body rather
     * than an object of named parameters.
     */
    rawBody?: string;
    /**
     * Set when the endpoint is unsafe by design. Presently this marks the four
     * routes that pass caller input to Python eval(). Presets for these are
     * excluded from the default pack.
     */
    unsafe?: string;
}

export interface IUtilityCatalog {
    version: number;
    packId: string;
    packName: string;
    description: string;
    baseUrlToken: string;
    keyToken: string;
    categories: string[];
    actions: IUtilityAction[];
}
