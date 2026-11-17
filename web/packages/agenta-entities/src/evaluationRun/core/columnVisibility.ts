/**
 * Column settings of the scenario table: which columns are hidden, and what a group's checkbox
 * shows. Copied from the old app's column visibility popover (web/oss
 * `EvalRunDetails/components/columnVisibility`, `@agenta/ui/table` `ColumnVisibilityPopoverContentBase`),
 * where a group is checked when all its columns show, half checked when some do.
 *
 * @packageDocumentation
 */

/** The checkbox state of a group of columns. */
export type ColumnGroupCheck = boolean | "indeterminate"

/** Checked when every column shows, unchecked when none does, half checked otherwise. */
export function columnGroupCheck(
    columnKeys: readonly string[],
    hidden: ReadonlySet<string>,
): ColumnGroupCheck {
    const hiddenCount = columnKeys.filter((key) => hidden.has(key)).length
    if (hiddenCount === 0) return true
    if (hiddenCount === columnKeys.length) return false
    return "indeterminate"
}

/** The hidden set after showing or hiding some columns. The input set is not changed. */
export function setColumnsVisible(
    hidden: ReadonlySet<string>,
    columnKeys: readonly string[],
    visible: boolean,
): Set<string> {
    const next = new Set(hidden)
    for (const key of columnKeys) {
        if (visible) next.delete(key)
        else next.add(key)
    }
    return next
}
