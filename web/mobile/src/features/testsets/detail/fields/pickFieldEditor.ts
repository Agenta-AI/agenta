import type {ViewType} from "@agenta/entity-ui/view-types"
import {detectValueShape, isPlainObject, type ValueShape} from "@agenta/shared/utils"

/** A grid text field is one line of at most this many characters. */
export const GRID_TEXT_MAX_CHARS = 140

/**
 * A column that holds an identifier, drawn in mono: the key is the suffix itself or ends in it
 * after a separator or a camelCase step (`id`, `ticket_id`, `folder-hash`, `git.commit`,
 * `userId`, `commitSHA`). A word that only ends in the letters (`valid`, `paid`, `grid`) is not.
 */
export const isIdKey = (key: string) =>
    /(?:^|[_.\- ])(?:id|uuid|hash|sha|commit)$/i.test(key) ||
    /[a-z0-9](?:Id|ID|Uuid|UUID|Hash|Sha|SHA|Commit)$/.test(key)

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

/** The message keys the chat editor writes back; a message with any other key edits as JSON. */
const CHAT_EDITOR_KEYS = new Set([
    "role",
    "content",
    "id",
    "name",
    "tool_call_id",
    "tool_calls",
    "function_call",
    "provider_specific_fields",
    "annotations",
    "refusal",
])

/**
 * Whether the chat editor writes `value` back without a loss: each message has a role, a text,
 * list or null content, and only keys the editor keeps.
 */
const chatEditorKeeps = (value: unknown) =>
    Array.isArray(value) &&
    value.every(
        (message) =>
            isPlainObject(message) &&
            typeof message.role === "string" &&
            (message.content === null ||
                typeof message.content === "string" ||
                Array.isArray(message.content)) &&
            Object.keys(message).every((key) => CHAT_EDITOR_KEYS.has(key)),
    )

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
    // An empty list or object is "empty" to the shape rule, but it opens in the editor of its
    // kind: a text input would store a string in place of the list.
    const shape: ValueShape = Array.isArray(value)
        ? value.length === 0
            ? "array-scalars"
            : detected.shape
        : isPlainObject(value) && Object.keys(value).length === 0
          ? "object-flat"
          : detected.shape
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
            // A chat found under a wrapper key is an object: it edits as one. A chat with
            // message keys the chat editor drops edits as JSON.
            if (detected.key) return pick(["form", "json", "yaml"])
            return chatEditorKeeps(value) ? pick(["chat", "json"]) : pick(["json", "yaml"])
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

/**
 * Whether the editor `kind` can show and write `value` as it is. A field keeps its editor while
 * its value fits it; a value that no longer fits (the user typed another kind of value in the
 * JSON view, then picked the first view again) gets a new editor, so no editor shows a value it
 * cannot hold.
 */
export function fitsEditor(kind: FieldEditorKind, value: unknown): boolean {
    switch (kind) {
        case "boolean":
            return typeof value === "boolean"
        case "number":
            return typeof value === "number"
        case "text":
            return value == null || (typeof value === "string" && !value.includes("\n"))
        case "textArea":
        case "markdown":
            return value == null || typeof value === "string"
        case "chips":
            return Array.isArray(value) && value.every((item) => !isPlainObject(item))
        case "keyRows":
            return isPlainObject(value)
        case "messages":
            return chatEditorKeeps(value)
        case "code":
            return true
    }
}
