import type {Column} from "@agenta/entities/testcase"
import type {EntityColumnHeader} from "@agenta/entity-ui/testcase"

/**
 * The top-level row keys that a column or group header's actions change, or null when the
 * header has no actions.
 *
 * A column change saves as a column delta, and the server renames and removes top-level row
 * keys only. So a column inside a nested value (`meta.lang` from `{meta: {lang}}`) has no
 * actions, and a top-level group is deleted by its own key, which takes every nested value with
 * it. A column whose own key holds a dot (`meta.lang` saved as one key) is a top-level key.
 */
export const columnHeaderTarget = (
    header: EntityColumnHeader,
    columns: Column[],
): string[] | null => {
    if (!header.isGroup) {
        const column = columns.find((candidate) => candidate.key === header.key)
        return column && !column.parentKey ? [header.key] : null
    }
    if (header.groupPath !== null) return null
    const inside = columns.filter((column) => column.key.startsWith(`${header.key}.`))
    if (inside.length === 0) return null
    return [...new Set(inside.map((column) => (column.parentKey ? header.key : column.key)))]
}
