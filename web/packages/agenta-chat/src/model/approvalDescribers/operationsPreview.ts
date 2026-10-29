/**
 * Reads the ORDERED `operations` delta of a `commit_revision` payload for the approval card.
 *
 * This deliberately DESCRIBES the requested operations. It does not compute the resulting
 * configuration. Applying the seven verbs (`set`, `merge`, `remove`, `edit_text`, `add_item`,
 * `replace_item`, `remove_item`) plus keyed selectors and anchored text edits is the backend's
 * change-set engine; a second implementation here would drift from it, and a commit card that
 * confidently shows the wrong result is worse than one that shows none.
 *
 * The card no longer shows a before/after pair, so nothing here reads the current configuration.
 * Legacy `{set, remove}` deltas return null and are described from their key paths instead.
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
    /** The value as JSON, when it is not a literal string. */
    valueJson?: string
    /** The value exactly as sent — describers read `name`/`description` off list entries. */
    value?: unknown
    /** The value comes from a workspace file, so the manifest holds the bytes. */
    fromFile: boolean
    /** The entry a selector segment picks (`{key}`/`{name}`), preserved verbatim so a key with a
     * space survives — `targetLabel` joins segments and cannot be split back apart safely. */
    selectorKey?: string
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
export const parseRevisionOperations = (delta: unknown): RevisionOperationPreview[] | null => {
    if (!isRecord(delta) || !Array.isArray(delta.operations)) return null
    const previews: RevisionOperationPreview[] = []
    delta.operations.forEach((raw, index) => {
        if (!isRecord(raw)) return
        const operation = typeof raw.operation === "string" ? raw.operation : "change"
        const target = Array.isArray(raw.target) ? raw.target : []
        const value = raw.value
        const fromFile = isRecord(value) && typeof value[FILE_MARKER] === "string"
        const selector = target.find(
            (seg): seg is Record<string, unknown> =>
                isRecord(seg) && (typeof seg.key === "string" || typeof seg.name === "string"),
        )
        const selectorKey = selector
            ? ((selector.key ?? selector.name) as string | undefined)
            : undefined
        const preview: RevisionOperationPreview = {
            index,
            operation,
            targetLabel: readableTarget(target),
            fromFile,
            value,
            ...(selectorKey ? {selectorKey} : {}),
        }
        if (typeof value === "string") {
            preview.newText = value
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
