import type {ProviderGroup} from "@agenta/ui/select-llm-provider"

/**
 * The picked row of the model list: its name, and the group whose logo it shows. The row key names
 * the exact connection; without a match the first row with the model id stands in.
 */
export const selectedModelOf = (
    groups: ProviderGroup[],
    selectedKey: string | null | undefined,
    modelId: string | null | undefined,
): {label: string; iconKey: string} | null => {
    for (const byKey of [true, false]) {
        for (const group of groups) {
            const option = group.options.find((item) =>
                byKey ? !!selectedKey && item.key === selectedKey : item.value === modelId,
            )
            if (option) return {label: option.label, iconKey: group.iconKey || group.label || ""}
        }
    }
    return null
}
