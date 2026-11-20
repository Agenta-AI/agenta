import type {ProviderGroup} from "@agenta/ui/select-llm-provider"

/**
 * The picked row of the model list, by the list's own rule (`SelectLLMProviderBase`): the row key
 * when the caller resolved one, else the model id. Returns its name and the group whose logo it
 * shows; null when no row matches.
 */
export const selectedModelOf = (
    groups: ProviderGroup[],
    selectedKey: string | null | undefined,
    modelId: string | null | undefined,
): {label: string; iconKey: string} | null => {
    for (const group of groups) {
        const option = group.options.find((item) =>
            selectedKey ? (item.key ?? item.value) === selectedKey : item.value === modelId,
        )
        if (option) return {label: option.label, iconKey: group.iconKey || group.label || ""}
    }
    return null
}
