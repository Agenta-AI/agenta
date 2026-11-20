/**
 * The words a commit diff shows. `@agenta/entities` holds no wording: `@agenta/entity-ui` builds
 * this from the `entityUi.commitDiff` catalog in the active language (`commitDiffTextNow()`).
 */
import type {SectionId} from "./types"

/** Fixed words: section titles, the instructions tag, row details and value names. */
export type CommitDiffWord =
    | `section.${SectionId | "integrations"}`
    | "edited"
    | "changed"
    | "added"
    | "removed"
    | "permissions"
    | "description"
    | "name"
    | "instructions"
    | "item"
    | "on"
    | "off"
    | "none"

export interface CommitDiffText {
    word: (word: CommitDiffWord) => string
    /** A section tag: "3 added", "1 edited". */
    count: (kind: "added" | "edited" | "removed" | "changed", count: number) => string
    /** A parameter added to a tool, with its schema type: "string, added". */
    typeAdded: (type: string) => string
    /** "description & instructions changed". */
    fieldsChanged: (fields: string[]) => string
    /** A setting name inside a row detail ("temperature changed" in English). */
    inSentence: (label: string) => string
    /** "2 parameters". */
    parameterCount: (count: number) => string
    /** "permission Ask → Allow". `from` and `to` are already named. */
    permissionChange: (from: string, to: string) => string
    /** The fold line under a capped body diff: "… 4 more lines". */
    moreLines: (count: number) => string
    /** The name of a config path ("Tool permissions"). Undefined: the path is humanized. */
    pathLabel: (path: string) => string | undefined
    /** The name of a stored enum value at a path ("Allow reads"). Undefined: shown as stored. */
    valueLabel: (path: string, value: string) => string | undefined
    /** An integration's tool permission; unset means it inherits the integration default. */
    gatewayPermission: (value: string | undefined) => string
}

const empty = () => ""

/**
 * No words at all, for a caller that reads only ids, kinds and stored values (the commit message
 * builder). Never pass it for sections that are shown.
 */
export const NO_COMMIT_DIFF_TEXT: CommitDiffText = {
    word: empty,
    count: empty,
    typeAdded: empty,
    fieldsChanged: empty,
    inSentence: (label) => label,
    parameterCount: empty,
    permissionChange: empty,
    moreLines: empty,
    pathLabel: () => undefined,
    valueLabel: () => undefined,
    gatewayPermission: empty,
}
