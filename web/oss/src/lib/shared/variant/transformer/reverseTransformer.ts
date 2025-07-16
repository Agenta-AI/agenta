import {toSnakeCase} from "@/oss/lib/shared/variant/stringUtils"

import type {ConfigMetadata} from "../genericTransformer/types"
import {checkValidity, shouldIncludeValue} from "../valueHelpers"

/**
 * Extract raw value based on metadata type
 */
export function extractValueByMetadata(
    _enhanced: Record<string, any> | null | undefined,
    allMetadata: Record<string, ConfigMetadata>,
): unknown {
    const enhanced = structuredClone(_enhanced)
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
        return shouldIncludeValue(enhanced.value) ? enhanced.value : undefined
    }

    if (!metadata) {
        if (Array.isArray(enhanced)) {
            return enhanced
                .map((item) => extractValueByMetadata(item, allMetadata))
                .filter(shouldIncludeValue)
        }

        // If no metadata, return object without __ properties and null values
        const obj = Object.entries(enhanced)
            .filter(([key]) => !key.startsWith("__"))
            .reduce(
                (acc, [key, val]) => {
                    const extracted = extractValueByMetadata(val, allMetadata)
                    if (shouldIncludeValue(extracted)) {
                        acc[key] = extracted
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
                .map((item: Record<string, any>) => {
                    return extractValueByMetadata(item, allMetadata)
                })
                .filter(shouldIncludeValue)
                .filter(Boolean)
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

            return Object.keys(obj).length > 0 &&
                checkValidity(obj, allMetadata[enhanced.__metadata])
                ? obj
                : undefined
        }
        case "compound": {
            const option = metadata.options.find(
                (o) => o.value === (enhanced.selected || metadata.options[0].value),
            )
            if (!option) return undefined
            return extractValueByMetadata(enhanced.value, allMetadata)
        }
        default:
            return shouldIncludeValue(enhanced.value) ? enhanced.value : undefined
    }
}
