/**
 * Reads the ORDERED `operations` delta of a `commit_revision` payload for the approval card.
 *
 * This deliberately DESCRIBES the requested operations. It does not compute the resulting
 * configuration. Applying the seven verbs (`set`, `merge`, `remove`, `edit_text`, `add_item`,
 * `replace_item`, `remove_item`) plus keyed selectors and anchored text edits is the backend's
 * change-set engine; a second implementation here would drift from it, and a commit card that
 * confidently shows the wrong result is worse than one that shows none.
 *
 * The one thing it does read from the current config is the value already sitting at a target,
 * so a `set` of a literal string can show old text beside new. That is a plain path walk with no
 * merge semantics, so it cannot disagree with the engine. When the old value does not resolve,
 * the caller shows the new value alone and says so.
 *
 * Legacy `{set, remove}` deltas do not come here: they keep going through
 * `classifyRevisionDeltaChanges` in @agenta/entities.
 */

/** Marker the runner replaces with workspace bytes; the approval manifest carries the content. */
const FILE_MARKER = "@ag.file"

export interface RevisionOperationPreview {
    index: number
    /** The verb exactly as sent, e.g. `set`. */
    operation: string
    /** Readable target, e.g. `instructions` or `skills pdf-tools / body`. */
    targetLabel: string
    /** New value, when the operation carries a literal string. */
    newText?: string
    /** Value already at the target, when it resolves to a string. */
    oldText?: string
    /** The value as JSON, when it is not a literal string. */
    valueJson?: string
    /** The value comes from a workspace file, so the manifest holds the bytes. */
    fromFile: boolean
    /** Number of anchored edits, for `edit_text`. */
    editCount?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/**
 * A readable name for a target path, mirroring the runner's `readableTarget`
 * (services/runner/src/tools/approval-manifest.ts) so the card and the manifest agree.
 */
export const readableTarget = (target: unknown[]): string => {
    const parts: string[] = []
    for (const segment of target) {
        if (typeof segment === "string") {
            // Leading `parameters` / `agent` are addressing scaffolding, not something to read.
            if (parts.length === 0 && (segment === "parameters" || segment === "agent")) continue
            parts.push(segment)
            continue
        }
        if (isRecord(segment)) {
            const list = segment.list ?? segment.field
            const key = segment.key ?? segment.name
            parts.push([list, key].filter((part) => typeof part === "string").join(" ") || "item")
        }
    }
    return parts.join(" / ") || "configuration"
}

/**
 * Walk one path segment. A selector segment stands in place of the LIST NAME, so it carries both
 * the list to enter and the item to pick: `{list: "skills", key: "pdf-tools"}` means `skills`,
 * then the entry named `pdf-tools`.
 */
const step = (node: unknown, segment: unknown): unknown => {
    if (typeof segment === "string") return isRecord(node) ? node[segment] : undefined
    if (!isRecord(segment)) return undefined
    const list = segment.list ?? segment.field
    const key = segment.key ?? segment.name
    if (typeof key !== "string") return undefined
    const collection = Array.isArray(node)
        ? node
        : isRecord(node) && typeof list === "string"
          ? node[list]
          : undefined
    if (!Array.isArray(collection)) return undefined
    return collection.find(
        (item) =>
            isRecord(item) &&
            [item.name, item.key, item.slug, item.id].some((candidate) => candidate === key),
    )
}

const walk = (root: unknown, target: unknown[]): unknown =>
    target.reduce<unknown>(
        (node, segment) => (node === undefined ? undefined : step(node, segment)),
        root,
    )

/**
 * The string currently at `target`, or undefined.
 *
 * Targets are rooted at the revision DATA tree (`parameters.agent...`) while the card holds only
 * `parameters`, so this tries the wrapped tree first and the bare parameters second. Both are
 * plain lookups: a miss returns undefined and the caller shows no old side.
 */
export const resolveCurrentText = (params: unknown, target: unknown[]): string | undefined => {
    for (const root of [{parameters: params}, params]) {
        const found = walk(root, target)
        if (typeof found === "string") return found
    }
    return undefined
}

const toJson = (value: unknown): string => {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/**
 * Read the ordered operations of a delta, or null when it carries none (a legacy delta, or a
 * malformed one). Null is the caller's signal to keep its existing rendering.
 */
export const parseRevisionOperations = (
    delta: unknown,
    currentParams: unknown,
): RevisionOperationPreview[] | null => {
    if (!isRecord(delta) || !Array.isArray(delta.operations)) return null
    const previews: RevisionOperationPreview[] = []
    delta.operations.forEach((raw, index) => {
        if (!isRecord(raw)) return
        const operation = typeof raw.operation === "string" ? raw.operation : "change"
        const target = Array.isArray(raw.target) ? raw.target : []
        const value = raw.value
        const fromFile = isRecord(value) && typeof value[FILE_MARKER] === "string"
        const preview: RevisionOperationPreview = {
            index,
            operation,
            targetLabel: readableTarget(target),
            fromFile,
        }
        if (typeof value === "string") {
            preview.newText = value
            const current = resolveCurrentText(currentParams, target)
            if (current !== undefined && current !== value) preview.oldText = current
        } else if (value !== undefined && !fromFile) {
            preview.valueJson = toJson(value)
        }
        if (Array.isArray(raw.edits)) preview.editCount = raw.edits.length
        previews.push(preview)
    })
    return previews.length ? previews : null
}

/** Verb as a short human phrase. Unknown verbs fall back to the raw name, never to a guess. */
export const operationLabel = (operation: string): string =>
    ({
        set: "Replace",
        merge: "Merge into",
        remove: "Remove",
        edit_text: "Edit text in",
        add_item: "Add to",
        replace_item: "Replace item in",
        remove_item: "Remove item from",
    })[operation] ?? operation
