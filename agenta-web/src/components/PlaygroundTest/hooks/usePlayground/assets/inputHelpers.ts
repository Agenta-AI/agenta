import {transformPrimitive} from "../../../assets/utilities/genericTransformer"
import {generateId} from "../../../assets/utilities/genericTransformer/utilities/string"

import type {
    ObjectMetadata,
    StringMetadata,
} from "../../../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"

/**
 * Variable Management
 * ------------------
 */

/**
 * Extract variables from a message string using fstring syntax {variableName}
 * @param input - Message content to extract variables from
 * @returns Array of variable names found in the string
 */
export function extractVariables(input: string): string[] {
    const variablePattern = /\{\s*(\w+)\s*\}/g
    const variables: string[] = []

    let match: RegExpExecArray | null
    while ((match = variablePattern.exec(input)) !== null) {
        variables.push(match[1])
    }

    return variables
}

/**
 * Schema Management
 * ----------------
 */

/**
 * Creates an input schema from a list of input keys
 * @param inputKeys - Array of input key names
 * @returns InputSchema with metadata for array of input rows
 */
export function createInputSchema(inputKeys: string[]): EnhancedVariant["inputs"]["__metadata"] {
    const properties: Record<string, StringMetadata> = Object.fromEntries(
        inputKeys.map((key) => [
            key,
            {
                type: "string",
                title: key,
                nullable: false,
                allowFreeform: true,
            },
        ]),
    )

    return {
        type: "array",
        title: "Input Rows",
        description: "Input values for variant execution",
        itemMetadata: {
            type: "object",
            title: "Input Row",
            description: "Single set of input values",
            properties,
            nullable: false,
        },
        nullable: false,
    }
}

/**
 * Input Row Management
 * -------------------
 */

/**
 * Creates a new input row with enhanced primitive values
 * Properties are spread at the root level instead of being nested under "value"
 */
export function createInputRow(
    inputKeys: string[],
    metadata: ObjectMetadata,
): EnhancedVariant["inputs"]["value"][number] {
    // Create enhanced values for each input key
    const enhancedValues = Object.fromEntries(
        inputKeys.map((key) => [
            key,
            {
                __id: generateId(),
                __metadata: metadata.properties[key],
                value: "",
            },
        ]),
    )

    // Return object with properties spread at root level and initialize __result as undefined
    return {
        __id: generateId(),
        __metadata: metadata,
        __result: undefined,
        ...enhancedValues,
    } as EnhancedVariant["inputs"]["value"][number]
}

/**
 * Prompt Key Management
 * --------------------
 */

/**
 * Updates input keys for a single prompt based on its messages
 * @param prompt - Prompt configuration to update
 * @returns Array of extracted variable names
 */
export function updatePromptInputKeys(prompt: EnhancedVariant["prompts"][number]) {
    const messagesContent = prompt.messages.value.map((message) => message.content.value || "")
    const variables = messagesContent.map((message) => extractVariables(message)).flat()

    if (prompt.inputKeys) {
        prompt.inputKeys.value = variables.map((variable) => {
            const existing = (prompt.inputKeys.value || []).find((key) => key.value === variable)
            return (
                existing ||
                transformPrimitive(
                    variable,
                    createInputSchema(variables).itemMetadata.properties[variable],
                )
            )
        })
    }

    return variables
}

/**
 * Updates input keys for all prompts in a variant
 * @param variant - Variant to update prompt input keys for
 * @returns Updated variant
 */
export function updateVariantPromptKeys(variant: EnhancedVariant) {
    variant.prompts?.forEach((prompt) => updatePromptInputKeys(prompt))
    return variant
}

/**
 * Variant Input Management
 * -----------------------
 */

/**
 * Initialize variant inputs with a single empty row
 * @param variant - Variant to initialize inputs for
 * @returns Updated variant with initialized inputs
 */
export function initializeVariantInputs(variant: EnhancedVariant) {
    const allInputKeys = Array.from(
        new Set(variant.prompts.flatMap((prompt) => prompt.inputKeys?.value || [])),
    )

    const inputStrings = Array.from(allInputKeys).map((enhancedKey) => enhancedKey.value)
    const inputSchema = createInputSchema(inputStrings)
    const initialInputRow = createInputRow(inputStrings, inputSchema.itemMetadata)

    variant.inputs = {
        __id: generateId(),
        __metadata: inputSchema,
        value: [initialInputRow],
    }

    return variant
}

/**
 * Synchronizes variant inputs structure with current prompt variables
 */
export function syncVariantInputs(variant: EnhancedVariant) {
    const currentInputKeys = new Set(
        variant.prompts.flatMap((prompt) => prompt.inputKeys?.value || []),
    )

    const inputStrings = Array.from(currentInputKeys).map((enhancedKey) => enhancedKey.value)
    const inputSchema = createInputSchema(inputStrings)

    const existingInputsId = variant.inputs?.__id || generateId()

    // Create metadata with ID properly typed
    const metadata = {
        ...inputSchema,
        __id: existingInputsId,
    }

    // Update each row while preserving all IDs
    const updatedRows = (variant.inputs?.value || []).map((row) => {
        const keys = [...inputStrings] as const
        const newRow = {
            __id: row.__id,
            __metadata: inputSchema.itemMetadata.properties[Object.keys(row)[0]],
            __result: undefined,
        } as EnhancedVariant["inputs"]["value"][number]

        // For each current input key
        keys.forEach((key) => {
            if (key in row) {
                // If key existed before, preserve entire value object including ID
                if (!!key && row[key]) {
                    const _key = key as keyof typeof newRow
                    if (typeof _key === "string") {
                        newRow[_key] = row[_key]
                    }
                }
            } else {
                // Only create new ID for truly new keys
                const _key = key as keyof typeof newRow
                if (typeof _key === "string") {
                    newRow[_key] = {
                        __id: generateId(),
                        __metadata: inputSchema.itemMetadata.properties[key],
                        // type: "string",
                        // properties: {},
                    } as EnhancedVariant["inputs"]["value"][number][typeof _key]
                }
            }
        })

        return newRow
    })

    // Ensure at least one row exists
    if (updatedRows.length === 0) {
        updatedRows.push(createInputRow(inputStrings, inputSchema.itemMetadata))
    }

    variant.inputs = {
        __id: existingInputsId,
        __metadata: metadata, // Now properly typed
        value: updatedRows,
    }

    return variant
}

/**
 * Gets the current input keys from all prompts in a variant
 * @param variant - Variant to get input keys from
 * @returns Set of unique input keys
 */
export function getVariantInputKeys(variant: EnhancedVariant): Set<string> {
    const inputKeys = new Set(
        variant.prompts?.flatMap((prompt) => prompt.inputKeys?.value || []) || [],
    )
    return new Set(Array.from(inputKeys).map((key) => key.value))
}