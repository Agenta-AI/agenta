import type {
    EnhancedVariant,
    PromptConfig,
    EnhancedInputRowConfig,
    InputSchema,
    StringMetadata,
    ObjectMetadata,
    EnhancedConfigValue,
    ArrayMetadata,
    TestResult,
} from "../../../betterTypes/types"

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
export function createInputSchema(inputKeys: string[]): InputSchema {
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
): EnhancedInputRowConfig {
    // Create enhanced values for each input key
    const enhancedValues = Object.fromEntries(
        inputKeys.map((key) => [
            key,
            {
                __id: crypto.randomUUID(),
                __metadata: metadata.properties[key],
                value: "",
            },
        ]),
    )

    // Return object with properties spread at root level and initialize __result as undefined
    return {
        __id: crypto.randomUUID(),
        __metadata: metadata,
        __result: undefined,
        ...enhancedValues,
    }
}

/**
 * Updates test result for a specific input row
 */
export function updateInputRowResult(
    row: EnhancedInputRowConfig,
    result: TestResult,
): EnhancedInputRowConfig {
    return {
        ...row,
        __result: result,
    }
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
export function updatePromptInputKeys(prompt: PromptConfig) {
    const messagesContent = prompt.messages.value.map((message) => message.content.value || "")
    const variables = messagesContent.map((message) => extractVariables(message)).flat()

    if (prompt.inputKeys) {
        prompt.inputKeys.value = variables
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

    const inputSchema = createInputSchema(allInputKeys)
    const initialInputRow = createInputRow(allInputKeys, inputSchema.itemMetadata)

    variant.inputs = {
        __id: crypto.randomUUID(),
        __metadata: inputSchema,
        value: [initialInputRow],
    }

    return variant
}

/** Create metadata object with ID */
function createMetadataWithId<T extends ArrayMetadata>(
    metadata: T,
    id: string,
): T & {__id: string} {
    return {
        ...metadata,
        __id: id,
    }
}

/**
 * Synchronizes variant inputs structure with current prompt variables
 */
export function syncVariantInputs(variant: EnhancedVariant) {
    const currentInputKeys = new Set(
        variant.prompts.flatMap((prompt) => prompt.inputKeys?.value || []),
    )

    const inputSchema = createInputSchema(Array.from(currentInputKeys))
    const existingInputsId = variant.inputs?.__id || crypto.randomUUID()

    // Create metadata with ID properly typed
    const metadata = createMetadataWithId(inputSchema, existingInputsId)

    // Update each row while preserving all IDs
    const updatedRows = (variant.inputs?.value || []).map((row) => {
        const newRow: EnhancedInputRowConfig = {
            __id: row.__id,
            __metadata: inputSchema.itemMetadata,
        }

        // For each current input key
        Array.from(currentInputKeys).forEach((key) => {
            if (key in row) {
                // If key existed before, preserve entire value object including ID
                newRow[key] = row[key]
            } else {
                // Only create new ID for truly new keys
                newRow[key] = {
                    __id: crypto.randomUUID(),
                    __metadata: inputSchema.itemMetadata.properties[key],
                    value: "",
                }
            }
        })

        return newRow
    })

    // Ensure at least one row exists
    if (updatedRows.length === 0) {
        updatedRows.push(createInputRow(Array.from(currentInputKeys), inputSchema.itemMetadata))
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
    return new Set(variant.prompts?.flatMap((prompt) => prompt.inputKeys?.value || []) || [])
}
