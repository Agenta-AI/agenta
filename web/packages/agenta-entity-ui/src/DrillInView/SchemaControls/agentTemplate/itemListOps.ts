/**
 * List edits behind the config item drawer (tools / MCP servers / skills).
 *
 * Its own module, free of React and of `ITEM_KINDS`, so the preservation guarantee below is
 * testable in the package's node-environment unit tests.
 *
 * The guarantee: editing ONE entry rewrites only that index. Every other entry is carried over by
 * reference, so an entry the panel cannot render, cannot classify, or deliberately shows read-only
 * survives a neighbour's edit byte-identical. A stored `@ag.embed` reference is the case that
 * matters: the agent can commit shapes the panel was never taught, and a save must never be the
 * thing that drops them.
 */

export type ItemEditMode = "create" | "edit"

/** Apply the drawer's draft to a list: append on create, replace at index on edit. */
export const applyItemToList = (
    list: readonly unknown[],
    edit: {mode: ItemEditMode; index: number},
    draft: unknown,
): unknown[] => {
    const next = [...list]
    if (edit.mode === "create") {
        next.push(draft)
        return next
    }
    // Out of range would otherwise extend the array with holes and silently reshape the list.
    if (edit.index < 0 || edit.index >= next.length) return next
    next[edit.index] = draft
    return next
}

/** Drop one entry by index, leaving the rest untouched. */
export const removeItemFromList = (list: readonly unknown[], index: number): unknown[] =>
    list.filter((_, i) => i !== index)
