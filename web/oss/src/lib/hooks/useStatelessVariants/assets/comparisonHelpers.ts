import {hashMetadata} from "@/oss/lib/hooks/useStatelessVariants/assets/hash"
import type {EnhancedConfigValue} from "@/oss/lib/shared/variant/genericTransformer/types"
import {createInputRow, createInputSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

/**
 * Extracts all unique input keys from a collection of variants
 * @param variants - Array of variants to extract input keys from
 * @returns Array of unique input keys
 */
export const getUniqueInputKeys = (variants: EnhancedVariant[]): EnhancedConfigValue<string>[] => {
    const inputKeySets = variants.map(
        (variant) =>
            new Set((variant.prompts || []).flatMap((prompt) => prompt.inputKeys?.value || [])),
    )

    // Combine all sets into a single set of unique keys
    const uniqueKeys = inputKeySets.reduce(
        (combined, current) => new Set([...combined, ...current]),
        new Set<EnhancedConfigValue<string>>(),
    )

    return Array.from(uniqueKeys)
}

// TODO: DEPRECATE @ardaerzin
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
