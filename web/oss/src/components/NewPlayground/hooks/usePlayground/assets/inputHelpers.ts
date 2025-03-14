import {hashMetadata} from "../../../assets/hash"
import {transformPrimitive} from "../../../assets/utilities/genericTransformer"
import type {
    ArrayMetadata,
    ObjectMetadata,
    OpenAPISpec,
    StringMetadata,
} from "../../../assets/utilities/genericTransformer/types"
import {generateId} from "../../../assets/utilities/genericTransformer/utilities/string"
import {extractInputKeysFromSchema} from "../../../assets/utilities/transformer/reverseTransformer"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {getSpecLazy} from "../../../state"
import {GenerationInputRow} from "../../../state/types"
import {PlaygroundStateData} from "../types"

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
    const variablePattern = /\{\{\s*(\w+)\s*\}\}/g
    const variables: string[] = []

    let match: RegExpExecArray | null
    while ((match = variablePattern.exec(input)) !== null) {
        variables.push(match[1])
    }

    return variables
}

export function createInputSchema(inputKeys: string[]): ArrayMetadata<ObjectMetadata> {
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
export function createInputRow(inputKeys: string[], metadata: ObjectMetadata): GenerationInputRow {
    // Create enhanced values for each input key
    const enhancedValues = Object.fromEntries(
        inputKeys.map((key) => {
            const metadataHash = hashMetadata(metadata.properties[key])

            return [
                key,
                {
                    __id: generateId(),
                    __metadata: metadataHash,
                    value: "",
                },
            ]
        }),
    )

    const metadataHash = hashMetadata(metadata)

    // Return object with properties spread at root level and initialize __result as undefined
    return {
        __id: generateId(),
        __metadata: metadataHash,
        __runs: {},
        ...enhancedValues,
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
 * Synchronizes variant inputs structure with current prompt variables
 */
export function syncVariantInputs(
    variants: EnhancedVariant[],
    generationInputData: PlaygroundStateData["generationData"]["inputs"],
    spec: OpenAPISpec | null = getSpecLazy(),
    routePath?: string,
) {
    const isCustomWorkflow = variants.some((variant) => variant.isCustom)
    let inputStrings: string[] = []
    if (isCustomWorkflow && spec) {
        inputStrings = extractInputKeysFromSchema(spec, routePath)
    } else {
        const currentInputKeys = new Set(
            variants.flatMap((variant) =>
                variant.prompts.flatMap((prompt) => prompt.inputKeys?.value || []),
            ),
        )
        inputStrings = Array.from(currentInputKeys).map((enhancedKey) => enhancedKey.value)
    }

    const inputSchema = createInputSchema(inputStrings)

    const existingInputsId = generationInputData?.__id || generateId()

    // Create metadata with ID properly typed
    const metadata = {
        ...inputSchema,
        __id: existingInputsId,
    }

    // Update each row while preserving all IDs
    const updatedRows = (generationInputData?.value || []).map((row) => {
        const keys = [...inputStrings] as const
        const metadataHash = hashMetadata(metadata.itemMetadata)

        type T = PlaygroundStateData["generationData"]["inputs"]["value"][number] &
            Record<(typeof keys)[number], any>

        const newRow = {
            __id: row.__id,
            __metadata: metadataHash,
            __result: row.__runs,
            __runs: row.__runs,
        } as T

        const _row = row as T
        // For each current input key
        keys.forEach((key) => {
            if (key in _row) {
                // If key existed before, preserve entire value object including ID
                if (!!key && _row[key]) {
                    const _key = key as keyof typeof newRow
                    if (typeof _key === "string") {
                        newRow[_key] = _row[_key]
                    }
                }
            } else {
                // Only create new ID for truly new keys
                const _key = key as keyof typeof newRow

                const metadataHash = hashMetadata(inputSchema.itemMetadata.properties[key])

                if (typeof _key === "string") {
                    newRow[_key] = {
                        __id: generateId(),
                        __metadata: metadataHash,
                    } as T[typeof _key]
                }
            }
        })

        return newRow
    })

    // Ensure at least one row exists
    if (updatedRows.length === 0) {
        updatedRows.push(createInputRow(inputStrings, inputSchema.itemMetadata))
    }

    const metadataHash = hashMetadata(metadata)

    generationInputData = {
        __id: existingInputsId,
        __metadata: metadataHash,
        value: updatedRows,
    }

    return generationInputData
}
