import {createInputRow, createInputSchema} from "./inputHelpers"
import {generateId} from "@/components/NewPlayground/assets/utilities/genericTransformer/utilities/string"
import {hashMetadata} from "@/lib/hooks/useStatelessVariant/assets/hash"

import type {EnhancedConfigValue} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"

/**
 * Extracts all unique input keys from a collection of variants
 * @param variants - Array of variants to extract input keys from
 * @returns Array of unique input keys
 */
export const getUniqueInputKeys = (variants: EnhancedVariant[]): EnhancedConfigValue<string>[] => {
    const inputKeySets = variants.map(
        (variant) => new Set(variant.prompts.flatMap((prompt) => prompt.inputKeys?.value || [])),
    )

    // Combine all sets into a single set of unique keys
    const uniqueKeys = inputKeySets.reduce(
        (combined, current) => new Set([...combined, ...current]),
        new Set<EnhancedConfigValue<string>>(),
    )

    return Array.from(uniqueKeys)
}

export const initializeComparisonInputs = (variants: EnhancedVariant[]) => {
    // Get all unique input keys across all variants
    const uniqueInputKeys = getUniqueInputKeys(variants)

    const inputStrings = Array.from(uniqueInputKeys).map((enhancedKey) => enhancedKey.value)
    const inputSchema = createInputSchema(inputStrings)
    const initialInputRow = createInputRow(inputStrings, inputSchema.itemMetadata)

    const metadataHash = hashMetadata(inputSchema)

    return {
        __id: generateId(),
        __metadata: metadataHash,
        value: [initialInputRow],
    }
}
