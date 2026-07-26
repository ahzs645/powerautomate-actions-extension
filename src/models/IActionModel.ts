export interface IActionModel {
    id: string;
    url: string;
    icon: string;
    title: string;
    actionJson: string;
    method: string;
    isSelected?: boolean;
    body?: any;
    isFavorite?: boolean;

    /** Grouping label shown in the predefined actions list. */
    category?: string;
    /** Longer explanation surfaced by the info button. */
    description?: string;
    /** Identifier of the pack this action came from, e.g. "file-and-utility-functions". */
    packId?: string;
    /** Warning shown before the action is used, e.g. for eval-backed endpoints. */
    warning?: string;
}