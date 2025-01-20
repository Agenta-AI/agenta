import {createInputRow, createInputSchema} from "./inputHelpers"
import {generateId} from "../../../assets/utilities/genericTransformer/utilities/string"
import {hashMetadata} from "../../../assets/utilities/hash"
import {createMessageRow} from "./messageHelpers"

import {type EnhancedConfigValue} from "../../../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"

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

export const getUniqueMessages = (variants: EnhancedVariant[]) => {
    // Extract all messages from all prompts
    const allMessages = variants.flatMap((variant) =>
        variant.prompts.flatMap((prompt) => prompt.messages.value),
    )

    // Create a Map using role+content as key to ensure uniqueness
    const uniqueMessages = new Map<string, (typeof allMessages)[0]>()

    allMessages.forEach((message) => {
        const key = `${message.role.value}:${message.content.value}`
        if (!uniqueMessages.has(key)) {
            uniqueMessages.set(key, message)
        }
    })

    return Array.from(uniqueMessages.values())
}

export const initializeComparisonMessages = (variants: EnhancedVariant[]) => {
    const uniqueSystemMessages = getUniqueMessages(variants)

    const emptyMessage = structuredClone(uniqueSystemMessages[0])
    emptyMessage.__id = generateId()

    for (const key in emptyMessage) {
        if (key !== "__id" && key !== "__metadata") {
            emptyMessage[key].value = ""
        }
    }

    const initialMessageRows = uniqueSystemMessages.map((message) =>
        createMessageRow(message, uniqueSystemMessages[0].__metadata),
    )
    initialMessageRows.push(createMessageRow(emptyMessage, uniqueSystemMessages[0].__metadata))

    return {
        __id: generateId(),
        __metadata: variants[0].prompts[0].messages.__metadata,
        value: initialMessageRows,
    }
}
