import {createContext} from "react"

import type {ProviderGroup} from "@agenta/ui/select-llm-provider"

/**
 * How the model picker draws: "menu" is the popover of a narrow control; "list" is the inline
 * grouped list of a view with room for it (the Model view, F01 f2).
 */
export const ModelPickerLayoutContext = createContext<"menu" | "list">("menu")

const isBuiltinGroup = (group: ProviderGroup) => (group.key ?? "").startsWith("builtin:")
const isSubscriptionGroup = (group: ProviderGroup) => group.tagTone === "olive"

/**
 * The groups in the list's order: the built-in models first, named as one "Agenta" row with
 * the "Built-in" tag, then the API key connections, then the subscriptions. Stable within each.
 */
export const groupsForList = (
    groups: ProviderGroup[],
    builtin: {label: string; tag: string},
): ProviderGroup[] => {
    const rank = (group: ProviderGroup) =>
        isBuiltinGroup(group) ? 0 : isSubscriptionGroup(group) || group.disabled ? 2 : 1
    return groups
        .map((group, index) => ({group, index}))
        .sort((a, b) => rank(a.group) - rank(b.group) || a.index - b.index)
        .map(({group}) =>
            isBuiltinGroup(group)
                ? {...group, label: builtin.label, tag: builtin.tag, iconKey: "agenta"}
                : group,
        )
}
