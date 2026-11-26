import {createContext} from "react"

import type {ProviderGroup} from "@agenta/ui/select-llm-provider"

import type {PickerConnectionRow} from "../connectionPicker"
import {buildPickerGroupsWithSections} from "../pickerSections"

/**
 * How the model picker draws: "popover" is the menu of a narrow control; "list" is the inline
 * grouped list of a view with room for it (the Model view, F01 f2).
 */
export const ModelPickerLayoutContext = createContext<"popover" | "list">("popover")

const isBuiltinRow = (row: PickerConnectionRow) =>
    row.models.some((model) => model.namespace === "builtin")

/**
 * The list's groups (F01 f2): the built-in models first, then the API key connections (the
 * project's, then the organization's), then the subscriptions. A single built-in row is named
 * "Agenta" with the "Built-in" tag; several keep their own names so they stay apart.
 */
export const listPickerGroups = (
    rows: PickerConnectionRow[],
    builtin: {label: string; tag: string},
): ProviderGroup[] => {
    const rank = (row: PickerConnectionRow) =>
        isBuiltinRow(row) ? 0 : row.kind === "subscription" ? 2 : 1
    const ordered = rows
        .map((row, index) => ({row, index}))
        .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
        .map(({row}) => row)
    const builtinKeys = new Set(ordered.filter(isBuiltinRow).map((row) => row.key))
    const single = builtinKeys.size === 1
    return buildPickerGroupsWithSections(ordered).map((group) =>
        builtinKeys.has(group.key ?? "")
            ? {...group, ...(single ? {label: builtin.label} : {}), tag: builtin.tag}
            : group,
    )
}
