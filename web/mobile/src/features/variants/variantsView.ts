import type {ListTableGroup} from "@agenta/ui/list-table"

import type {AppRevisionRow} from "./useAppRevisions"

/** "revisions" is one flat list. "variants" groups the same rows under their variant. */
export type VariantsDisplayMode = "variants" | "revisions"

export const DISPLAY_MODE_KEY = "agenta:registry:display-mode"

export const readDisplayMode = (): VariantsDisplayMode => {
    try {
        return window.localStorage.getItem(DISPLAY_MODE_KEY) === "variants"
            ? "variants"
            : "revisions"
    } catch {
        return "revisions"
    }
}

export const writeDisplayMode = (mode: VariantsDisplayMode) => {
    try {
        window.localStorage.setItem(DISPLAY_MODE_KEY, mode)
    } catch {
        // The choice then lasts until the page closes. Nothing else depends on it.
    }
}

/**
 * The rows as table groups. The rows arrive newest first, so a group's rows stay newest first
 * and the groups run in the order their newest revision appears.
 */
export const toRevisionGroups = (
    rows: readonly AppRevisionRow[],
    mode: VariantsDisplayMode,
): ListTableGroup<AppRevisionRow>[] => {
    if (mode === "revisions") return rows.length ? [{key: "all", label: null, rows: [...rows]}] : []

    const groups = new Map<string, ListTableGroup<AppRevisionRow>>()
    for (const row of rows) {
        const key = row.variantId || row.variantName
        const group = groups.get(key) ?? {key, label: row.variantName, rows: []}
        group.rows.push(row)
        groups.set(key, group)
    }
    return [...groups.values()]
}

/** The revision ids a reader can see, in display order: the rows of a collapsed group are out. */
export const visibleRevisionIds = (
    groups: readonly ListTableGroup<AppRevisionRow>[],
    collapsed: ReadonlySet<string>,
): string[] =>
    groups
        .filter((group) => !collapsed.has(group.key))
        .flatMap((group) => group.rows.map((row) => row.revisionId))
