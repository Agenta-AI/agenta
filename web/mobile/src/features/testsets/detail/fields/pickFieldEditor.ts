import type {ViewType} from "@agenta/entity-ui/view-types"
import {detectValueShape, type ValueShape} from "@agenta/shared/utils"

/** A grid text field is one line of at most this many characters. */
export const GRID_TEXT_MAX_CHARS = 140

/** A column that holds an identifier (`ticket_id`, `folder_hash`, `git_commit`): drawn in mono. */
export const isIdKey = (key: string) => /(?:^|[_.-])(?:id|uuid|hash|sha|commit)$/i.test(key)

/** The editor a field draws. */
export type FieldEditorKind =
    | "text"
    | "number"
    | "boolean"
    | "textArea"
    | "markdown"
    | "chips"
    | "keyRows"
    | "messages"
    | "code"

export interface FieldEditorPick {
    shape: ValueShape
    /** The value sits in the two-column grid while it shows in its first view. */
    grid: boolean
    /** The value is a string that holds JSON: an edit stores text again. */
    parsedFromText: boolean
    /** The "Show as" choices; empty when the value has one view only. */
    views: ViewType[]
    defaultView: ViewType
}

const GRID_SHAPES = new Set<ValueShape>(["empty", "boolean", "number", "url"])
const TEXT_VIEWS: ViewType[] = ["text", "markdown", "json"]

const isGridText = (shape: ValueShape, value: unknown) =>
    shape === "text-short" &&
    typeof value === "string" &&
    !value.includes("\n") &&
    value.length <= GRID_TEXT_MAX_CHARS

/**
 * The editor of a field, from its value when the drawer opens. The caller keeps the result, so a
 * field does not change editor while the user types: "yes" typed over with "true" stays text.
 */
export function pickFieldEditor(value: unknown): FieldEditorPick {
    const detected = detectValueShape(value)
    const {shape} = detected
    const parsedFromText = detected.parsedFromText === true
    const pick = (views: ViewType[], defaultView: ViewType = views[0] ?? "text") => ({
        shape,
        grid: !parsedFromText && (GRID_SHAPES.has(shape) || isGridText(shape, value)),
        parsedFromText,
        views,
        defaultView,
    })

    if (parsedFromText) return pick(["json", "yaml"])
    switch (shape) {
        case "boolean":
        case "number":
            return pick([], "text")
        case "markdown":
            return pick(TEXT_VIEWS, "markdown")
        case "messages":
            // A chat found under a wrapper key is an object: it edits as one.
            return detected.key ? pick(["form", "json", "yaml"]) : pick(["chat", "json"])
        case "array-scalars":
            return pick(["form", "json"])
        case "array-objects":
            return pick(["json", "yaml"])
        case "message":
        case "object-flat":
        case "object-nested":
            // A list of mixed items is `object-nested` too; it has no key rows.
            return Array.isArray(detected.value)
                ? pick(["json", "yaml"])
                : pick(["form", "json", "yaml"])
        default:
            return pick(TEXT_VIEWS)
    }
}

/** The editor that draws `pick` in `view`. */
export function editorKind(pick: FieldEditorPick, view: ViewType): FieldEditorKind {
    if (view === "json" || view === "yaml") return "code"
    if (view === "markdown") return "markdown"
    if (view === "chat") return "messages"
    if (view === "form") return pick.shape === "array-scalars" ? "chips" : "keyRows"
    if (pick.shape === "boolean") return "boolean"
    if (pick.shape === "number") return "number"
    return pick.grid ? "text" : "textArea"
}
