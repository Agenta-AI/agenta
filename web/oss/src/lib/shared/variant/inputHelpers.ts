import {transformPrimitive} from "./genericTransformer"
import {ArrayMetadata, ObjectMetadata, StringMetadata} from "./genericTransformer/types"
import {getRequestSchema} from "./openapiUtils"
import {EnhancedVariant} from "./transformer/types"
import {OpenAPISpec} from "./types/openapi"

export const extractInputKeysFromSchema = (spec: OpenAPISpec, routePath = "") => {
    const requestSchema = getRequestSchema(spec, {routePath})
    if (!requestSchema || !("properties" in requestSchema)) {
        return []
    }
    const expectedProperties = requestSchema?.properties || {}
    const expectedPropertyKeys = Object.keys(expectedProperties).filter(
        // Exclude reserved container keys; call sites decide whether to include schema keys for custom/non-custom
        (key) => !["ag_config", "messages"].includes(key),
    )
    return expectedPropertyKeys
}

/**
 * Extract variables from a message string using fstring syntax {variableName}
 * @param input - Message content to extract variables from
 * @returns Array of variable names found in the string
 */
export function extractVariables(input: string): string[] {
    const variablePattern = /\{\{((?:\\.|[^\}\\])*)\}\}/g

    const variables: string[] = []

    let match: RegExpExecArray | null
    while ((match = variablePattern.exec(input)) !== null) {
        const variable = match[1].replaceAll(/\\(.)/g, "$1").trim()
        if (variable) {
            variables.push(variable)
        }
    }

    return variables
}

export function extractVariablesFromJson(obj: any): string[] {
    let variables: string[] = []
    if (typeof obj === "string") {
        return extractVariables(obj)
    }
    if (Array.isArray(obj)) {
        variables = obj.flatMap((item) => extractVariablesFromJson(item))
    } else if (obj && typeof obj === "object") {
        variables = Object.entries(obj).flatMap(([k, v]) => {
            const keyVars = typeof k === "string" ? extractVariables(k) : []
            return [...keyVars, ...extractVariablesFromJson(v)]
        })
    }
    return Array.from(new Set(variables))
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
 * Updates input keys for a single prompt based on its messages
 * @param prompt - Prompt configuration to update
 * @returns Array of extracted variable names
 */
export function updatePromptInputKeys(prompt: EnhancedVariant["prompts"][number]) {
    // @ts-ignore
    const messagesContent = prompt.messages.value.map((message) => {
        const content = message.content.value
        if (Array.isArray(content)) {
            return content.map((part) => (part as any).text || "").join(" ")
        }
        return content || ""
    })
    // @ts-ignore
    const messageVars = messagesContent.map((message) => extractVariables(message)).flat()

    // @ts-ignore
    const responseFormat = prompt.llmConfig?.responseFormat?.value
    const responseVars = responseFormat ? extractVariablesFromJson(responseFormat) : []
    const variables = Array.from(new Set([...messageVars, ...responseVars]))

    if (prompt.inputKeys) {
        // @ts-ignore
        prompt.inputKeys.value = variables.map((variable) => {
            // @ts-ignore
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
    ;(variant.prompts || []).forEach((prompt) => updatePromptInputKeys(prompt))
    return variant
}

/**
 * Variant Input Management
 * -----------------------
 */

/**
 * Extract input values from an enhanced input row
 */
export function extractInputValues(
    _variant: EnhancedVariant,
    inputRow: Record<string, any>,
): Record<string, string> {
    // Derive inputs directly from the provided inputRow.
    // We avoid relying on variant.inputParams (deprecated) and instead
    // include any root-level fields that look like enhanced primitive objects
    // (i.e., have a `value` property), excluding metadata fields.

    return Object.entries(inputRow).reduce(
        (acc, [key, value]) => {
            if (key === "__id" || key === "__metadata" || key === "__result") {
                return acc
            }

            if (value && typeof value === "object" && "value" in value) {
                acc[key] = (value as {value: string}).value
            }
            return acc
        },
        {} as Record<string, string>,
    )
}
