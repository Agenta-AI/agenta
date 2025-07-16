import {isObjectMetadata} from "./genericTransformer/helpers/metadata"
import {ConfigMetadata} from "./genericTransformer/types"
import {toSnakeCase} from "./stringUtils"

export function shouldIncludeValue(value: unknown): boolean {
    if (!value) return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
}

export const checkValidity = (obj: Record<string, any>, metadata: ConfigMetadata) => {
    if (!isObjectMetadata(metadata)) return true

    for (const [propName, propMetadata] of Object.entries(metadata.properties)) {
        const snakeCasePropName = toSnakeCase(propName)
        // If property is required (not nullable) and value is missing or undefined
        if (
            propMetadata.nullable === false &&
            (!(snakeCasePropName in obj) || !obj[snakeCasePropName])
        ) {
            return false
        }
    }

    // TODO: REMOVE THIS EDGE CASE and COME UP WITH A CORRECTED GENERIC
    // SUBSTITUTION FOR THIS CHECK
    if (metadata.type === "object" && metadata.title === "Message") {
        const nullableKeys = Object.keys(metadata.properties)
            .map((key) => {
                const snaked = toSnakeCase(key)
                if (metadata.properties[key].nullable) {
                    return snaked
                } else {
                    return undefined
                }
            })
            .filter(Boolean) as string[]

        const allEmpty = nullableKeys.every((key) => {
            return !obj[key]
        })

        if (allEmpty) return false
    }
    return true
}

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
        case "function": {
            return undefined
        }
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
                        if (key === "tools") {
                            acc[key] = val.value
                        } else if (key === "toolCalls" && val.value && Array.isArray(val.value)) {
                            const cloned = (structuredClone(val.value) || []).map(
                                (call: Record<string, any>) => {
                                    call.id = call.id
                                    delete call.__id
                                    delete call.__metadata

                                    call.function.parameters = JSON.stringify(
                                        call.function.parameters,
                                    )
                                    return call
                                },
                            )
                            delete cloned.__id
                            delete cloned.__metadata
                            acc[toSnakeCase(key)] = cloned
                        } else {
                            const extracted = extractValueByMetadata(val, allMetadata)
                            if (shouldIncludeValue(extracted)) {
                                acc[toSnakeCase(key)] = extracted
                            }
                        }
                        if (key === "tools") {
                            acc[key] = (acc[key] || []).map((tool) => {
                                return tool.value
                            })
                        }
                        return acc
                    },
                    {} as Record<string, unknown>,
                )

            if (obj.role === "tool") {
                if (!obj.content) {
                    obj.content = ""
                }
            }
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
