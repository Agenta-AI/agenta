import {getSpecLazy} from "../../state"
import {extractInputKeysFromSchema} from "../comparisonHelpers"
import {ConfigMetadata, EnhancedConfigValue, OpenAPISpec} from "../genericTransformer/types"
import {toSnakeCase} from "../genericTransformer/utilities/string"

// import type {ConfigMetadata} from "../genericTransformer/types"
import type {EnhancedVariant} from "./types"

function shouldIncludeValue(value: unknown, metadata?: ConfigMetadata | null): boolean {
    if (value === null || value === undefined) return false
    if (Array.isArray(value) && value.length === 0) return false
    if (metadata?.type === "boolean" && ![false, true].includes(value as boolean)) return false
    return true
}

/**
 * Extract raw value based on metadata type
 */
export function extractValueByMetadata(
    enhanced: Record<string, any> | null | undefined,
    allMetadata: Record<string, ConfigMetadata>,
): unknown {
    // Handle null/undefined
    if (!enhanced) return null

    // Handle primitive values
    if (typeof enhanced !== "object" || enhanced === null) {
        return enhanced
    }

    const metadata = allMetadata ? allMetadata[enhanced.__metadata] : null

    // Handle primitive enhanced values
    if (
        "value" in enhanced &&
        (!metadata ||
            metadata.type === "string" ||
            metadata.type === "number" ||
            metadata.type === "boolean")
    ) {
        return shouldIncludeValue(enhanced.value, metadata) ? enhanced.value : undefined
    }

    if (!metadata) {
        // If no metadata, return object without __ properties and null values
        const obj = Object.entries(enhanced)
            .filter(([key]) => !key.startsWith("__"))
            .reduce(
                (acc, [key, val]) => {
                    const extracted = extractValueByMetadata(val, allMetadata)
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
                .map((item: Record<string, any>) => extractValueByMetadata(item, allMetadata))
                .filter((item) => shouldIncludeValue(item))
            return arr.length > 0 ? arr : undefined
        }
        case "object": {
            const obj = Object.entries(enhanced)
                .filter(([key]) => !key.startsWith("__"))
                .reduce(
                    (acc, [key, val]) => {
                        const extracted = extractValueByMetadata(val, allMetadata)
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
function extractInputValues(
    variant: EnhancedVariant,
    inputRow: Record<string, any>,
): Record<string, string> {
    const variantInputs = variant.prompts.flatMap((prompt) => {
        return (prompt.inputKeys?.value || []).map((keyValue) => keyValue.value)
    })
    return Object.entries(inputRow).reduce(
        (acc, [key, value]) => {
            // Skip metadata, id, and result fields
            if (
                key !== "__id" &&
                key !== "__metadata" &&
                key !== "__result" &&
                variantInputs.includes(key)
            ) {
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
export function transformToRequestBody({
    variant,
    inputRow,
    allMetadata = {},
    spec = getSpecLazy(),
    routePath = "",
}: {
    variant: EnhancedVariant
    inputRow?: EnhancedVariant["inputs"]["value"][number]
    allMetadata: Record<string, ConfigMetadata>
    spec?: OpenAPISpec
    routePath?: string
}): Record<string, any> {
    const data = {} as Record<string, any>

    // Get the first prompt configuration
    // const promptConfig = variant.prompts[0]
    const promptConfigs = variant.prompts.reduce(
        (acc, prompt) => {
            const extracted = extractValueByMetadata(prompt, allMetadata)
            const name = prompt.__name
            if (!name) return acc

            acc[name] = extracted
            return acc
        },
        {} as Record<string, any>,
    )

    const customConfigs =
        (extractValueByMetadata(variant.customProperties, allMetadata) as Record<string, any>) || {}

    // const rawConfig = extractValueByMetadata(promptConfig, allMetadata)
    data.ag_config = {
        ...promptConfigs,
        ...customConfigs,
    }

    if (inputRow) {
        if (!variant.isCustom) {
            data.inputs = extractInputValues(variant, inputRow)
        } else if (spec) {
            const inputKeys = extractInputKeysFromSchema(spec, routePath)
            for (const key of inputKeys) {
                const value = (inputRow?.[key as keyof typeof inputRow] as EnhancedConfigValue<any>)
                    .value

                if (value) {
                    data[key] = value
                }
            }
        }
    }

    return data
}
