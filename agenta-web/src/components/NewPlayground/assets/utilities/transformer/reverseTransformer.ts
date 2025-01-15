import {toSnakeCase} from "../genericTransformer/utilities/string"

import type {ConfigMetadata} from "../genericTransformer/types"
import type {EnhancedVariant} from "./types"

function shouldIncludeValue(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
}

/**
 * Extract raw value based on metadata type
 */
function extractValueByMetadata(enhanced: Record<string, any> | null | undefined): unknown {
    // Handle null/undefined
    if (!enhanced) return null

    // Handle primitive values
    if (typeof enhanced !== "object" || enhanced === null) {
        return enhanced
    }

    // Handle primitive enhanced values
    if (
        "value" in enhanced &&
        (!enhanced.__metadata ||
            enhanced.__metadata.type === "string" ||
            enhanced.__metadata.type === "number" ||
            enhanced.__metadata.type === "boolean")
    ) {
        return shouldIncludeValue(enhanced.value) ? enhanced.value : undefined
    }

    const metadata = enhanced.__metadata as ConfigMetadata
    if (!metadata) {
        // If no metadata, return object without __ properties and null values
        const obj = Object.entries(enhanced)
            .filter(([key]) => !key.startsWith("__"))
            .reduce(
                (acc, [key, val]) => {
                    const extracted = extractValueByMetadata(val)
                    if (shouldIncludeValue(extracted)) {
                        acc[toSnakeCase(key)] = extracted
                    }
                    return acc
                },
                {} as Record<string, unknown>,
            )

        return Object.keys(obj).length > 0 ? obj : undefined
    }

    switch (metadata.type) {
        case "array": {
            if (!Array.isArray(enhanced.value)) return undefined
            const arr = enhanced.value
                .map((item: Record<string, any>) => extractValueByMetadata(item))
                .filter(shouldIncludeValue)
            return arr.length > 0 ? arr : undefined
        }
        case "object": {
            const obj = Object.entries(enhanced)
                .filter(([key]) => !key.startsWith("__"))
                .reduce(
                    (acc, [key, val]) => {
                        const extracted = extractValueByMetadata(val)
                        if (shouldIncludeValue(extracted)) {
                            acc[toSnakeCase(key)] = extracted
                        }
                        return acc
                    },
                    {} as Record<string, unknown>,
                )
            return Object.keys(obj).length > 0 ? obj : undefined
        }
        default:
            return shouldIncludeValue(enhanced.value) ? enhanced.value : undefined
    }
}

/**
 * Extract input values from an enhanced input row
 */
function extractInputValues(inputRow: Record<string, any>): Record<string, string> {
    return Object.entries(inputRow).reduce(
        (acc, [key, value]) => {
            // Skip metadata, id, and result fields
            if (key !== "__id" && key !== "__metadata" && key !== "__result") {
                acc[key] = value.value
            }
            return acc
        },
        {} as Record<string, string>,
    )
}

/**
 * Transform EnhancedVariant back to API request shape
 */
export function transformToRequestBody(
    variant: EnhancedVariant,
    inputRow?: EnhancedVariant["inputs"]["value"][number],
): Record<string, any> {
    const data = {} as Record<string, any>
    // Get the first prompt configuration
    const promptConfig = variant.prompts[0]
    const rawConfig = extractValueByMetadata(promptConfig)
    data.ag_config = {
        prompt: rawConfig as EnhancedVariant["prompts"][number],
    }

    if (inputRow) {
        data.inputs = extractInputValues(inputRow)
    }

    return data
}
