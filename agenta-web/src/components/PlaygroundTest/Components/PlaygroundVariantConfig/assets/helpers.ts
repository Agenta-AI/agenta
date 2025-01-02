import {EnhancedVariant} from "@/components/PlaygroundTest/betterTypes/types"

export const variantToPromptsSelector = (variant: EnhancedVariant) => {
    const promptIds = (variant?.prompts || [])?.map((prompt) => prompt.__id) ?? []
    return {
        promptIds,
    }
}
