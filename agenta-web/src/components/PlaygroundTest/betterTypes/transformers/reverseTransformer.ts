import type {EnhancedVariant, Enhanced} from "../types"
import {toSnakeCase} from "../utilities/string"

/**
 * Extract raw value from Enhanced type, converting keys to snake_case
 */
function extractValue<T>(enhanced: Enhanced<T>): unknown {
    // If it's a primitive value
    if ("value" in enhanced) {
        return enhanced.value
    }

    // For object types
    return Object.entries(enhanced)
        .filter(([key]) => !key.startsWith("__"))
        .reduce(
            (acc, [key, val]) => {
                acc[toSnakeCase(key)] = extractValue(val as Enhanced<unknown>)
                return acc
            },
            {} as Record<string, unknown>,
        )
}

/**
 * Transform EnhancedVariant back to API request shape
 */
export function transformToRequestBody(variant: EnhancedVariant) {
    // Get the first prompt configuration (current implementation only uses one)
    const promptConfig = variant.prompts[0]

    return {
        agenta_config: {
            default: {
                prompt: extractValue(promptConfig),
            },
        },
        inputs: variant.inputs,
    }
}
