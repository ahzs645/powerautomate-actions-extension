// DesignerCopyService - imports an action copied inside the Power Automate
// designer back into the extension's "Copied Actions" list.
//
// The modern designer's copy handler writes its payload to the system
// clipboard via navigator.clipboard.writeText and only falls back to
// localStorage.setItem('msla-clipboard', ...) when the async clipboard API is
// unavailable. Reading only the localStorage key therefore misses every copy
// made in a normal Chrome session, so the import must be clipboard-first: the
// popup reads navigator.clipboard (it is focused and the manifest holds
// clipboardRead), and only on a miss asks the content script for the
// localStorage fallback.

import { IActionModel, ICopiedActionV3Model } from '../models';

/** Default brand color for imported actions, matching getElementsFromMyClipboard. */
const IMPORT_BRAND_COLOR = '#007ee5';

export class DesignerCopyService {

    /**
     * Parse a designer copy payload into an action for the My Clipboard list.
     * Returns null when the text is not a designer copy (arbitrary clipboard
     * content must never be imported or stored).
     *
     * Two payload shapes exist:
     * - the serialized-node shape ({ nodeId, serializedValue, mslaNode: true })
     *   used by the current designer and by this extension's own paste
     *   direction - serializedValue is a complete operation definition;
     * - the legacy nodeData shape ({ nodeData: { id, operationMetadata } })
     *   found in older designer builds' localStorage fallback. Its nodeInputs
     *   are designer view state, not an operation definition, so the raw
     *   payload is preserved instead of being wrapped as pasteable.
     */
    public parse(text: string | null | undefined): IActionModel | null {
        if (!text) { return null; }

        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch {
            return null;
        }
        if (!parsed || typeof parsed !== 'object') { return null; }

        if (parsed.mslaNode === true && parsed.serializedValue && typeof parsed.serializedValue === 'object') {
            return this.fromSerializedNode(parsed);
        }

        if (parsed.nodeData && typeof parsed.nodeData === 'object') {
            return this.fromLegacyNodeData(text, parsed as ICopiedActionV3Model);
        }

        return null;
    }

    private fromSerializedNode(parsed: any): IActionModel {
        const title = typeof parsed.nodeId === 'string' && parsed.nodeId
            ? parsed.nodeId.replace(/_/g, ' ')
            : 'Copied action';

        const operationDefinition = { ...parsed.serializedValue, runAfter: {} };

        const actionJson = JSON.stringify({
            id: this.newGuid(),
            brandColor: IMPORT_BRAND_COLOR,
            icon: '',
            isTrigger: false,
            operationName: title,
            operationDefinition,
        }, null, 2);

        return {
            actionJson,
            id: this.generateUniqueId(),
            method: '',
            url: '',
            icon: '',
            title,
        };
    }

    private fromLegacyNodeData(rawText: string, parsed: ICopiedActionV3Model): IActionModel {
        return {
            actionJson: rawText,
            id: this.generateUniqueId(),
            method: '',
            url: '',
            icon: parsed.nodeData?.operationMetadata?.iconUri || '',
            title: parsed.nodeData?.id || 'Copied action',
        };
    }

    private generateUniqueId(): string {
        const timestamp = Date.now().toString(16);
        const randomNum = Math.floor(Math.random() * 1000000).toString(16);
        return `${timestamp}-${randomNum}`;
    }

    private newGuid(): string {
        let d = new Date().getTime();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
        });
    }
}

export const designerCopyService = new DesignerCopyService();
