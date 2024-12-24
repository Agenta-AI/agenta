import {type StateVariant} from "../../../state/types"

export const variantToPromptsSelector = (variant: StateVariant) => ({
    prompts:
        variant?.schema?.promptConfig?.map((prompt) => ({
            key: prompt.key,
        })) ?? [],
})
