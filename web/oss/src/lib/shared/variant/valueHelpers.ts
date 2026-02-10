import {isObjectMetadata} from "./genericTransformer/helpers/metadata"
import {ConfigMetadata} from "./genericTransformer/types"
import {toSnakeCase} from "./stringUtils"

export function stripAgentaMetadataDeep<T = unknown>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(stripAgentaMetadataDeep) as T
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== "agenta_metadata" && key !== "__agenta_metadata")
            .map(([key, val]) => [key, stripAgentaMetadataDeep(val)])

        return Object.fromEntries(entries) as T
    }

    return value
}

/**
 * Recursively strip enhanced value wrappers (__id, __metadata) from objects
 * and unwrap {value: X} patterns where the object is a simple value wrapper.
 *
 * This is used as a safety net for chat message content parts that may not
 * have been fully extracted by extractValueByMetadata (e.g. when content
 * parts are created by fallback builders with __metadata: {} instead of
 * a proper metadata hash).
 */
export function stripEnhancedWrappers(value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (typeof value !== "object") return value

    if (Array.isArray(value)) {
        return value.map(stripEnhancedWrappers)
    }

    const obj = value as Record<string, unknown>

    // Detect enhanced wrapper keys
    const keys = Object.keys(obj)
    const hasEnhancedMeta = keys.includes("__id") || keys.includes("__metadata")

    // Check if this is a simple enhanced value wrapper: has "value" key alongside
    // only __id/__metadata keys (and optionally "selected" for compound types).
    // If so, unwrap and recursively process the value.
    const metaKeySet = new Set(["__id", "__metadata"])
    if (hasEnhancedMeta) metaKeySet.add("selected")
    const nonMetaKeys = keys.filter((k) => !metaKeySet.has(k))
    if (nonMetaKeys.length === 1 && nonMetaKeys[0] === "value") {
        return stripEnhancedWrappers(obj.value)
    }

    // Otherwise, strip __id/__metadata and recursively process remaining keys
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
        if (key === "__id" || key === "__metadata") continue
        result[key] = stripEnhancedWrappers(val)
    }
    return result
}

export function shouldIncludeValue(value: unknown): boolean {
    // Handle null and undefined
    if (value === null || value === undefined) return false

    // Handle empty strings
    if (value === "") {
        return false
    }

    // Handle empty arrays
    if (Array.isArray(value) && value.length === 0) return false

    // Preserve all other values including:
    // - Boolean false (e.g., "strict": false)
    // - Number 0 (e.g., "count": 0)
    // - Empty objects (e.g., "properties": {})
    // These all have semantic meaning and should be preserved
    return true
}

export const checkValidity = (obj: Record<string, any>, metadata: ConfigMetadata) => {
    if (!isObjectMetadata(metadata)) return true
    if (!metadata.properties) return true

    for (const [propName, propMetadata] of Object.entries(metadata.properties)) {
        const snakeCasePropName = toSnakeCase(propName)
        // If property is required (not nullable) and value is missing or undefined
        if (
            propMetadata.nullable === false &&
            (!(snakeCasePropName in obj) || !obj[snakeCasePropName])
        ) {
            // Special case for file objects: allow file_data to satisfy file_id requirement and vice versa
            const hasAlternative =
                (snakeCasePropName === "file_id" && Boolean(obj["file_data"])) ||
                (snakeCasePropName === "file_data" && Boolean(obj["file_id"]))

            if (!hasAlternative) {
                return false
            }
        }
    }

    // Handle Message object type with nullable keys
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
    debug = false,
): unknown {
    const enhanced = structuredClone(_enhanced)

    // Handle null/undefined
    if (enhanced === null || enhanced === undefined) return null

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
        // When metadata is missing and value is a complex type (array/object),
        // recursively process it to strip nested __id/__metadata wrappers
        if (!metadata && enhanced.value !== null && enhanced.value !== undefined) {
            if (Array.isArray(enhanced.value)) {
                return enhanced.value
                    .map((item: Record<string, any>) =>
                        extractValueByMetadata(item, allMetadata, debug),
                    )
                    .filter(shouldIncludeValue)
            }
            if (typeof enhanced.value === "object") {
                return extractValueByMetadata(
                    enhanced.value as Record<string, any>,
                    allMetadata,
                    debug,
                )
            }
        }
        return shouldIncludeValue(enhanced.value) ? enhanced.value : undefined
    }

    if (!metadata) {
        if (Array.isArray(enhanced)) {
            return enhanced
                .map((item) => extractValueByMetadata(item, allMetadata, debug))
                .filter(shouldIncludeValue)
        }

        // If no metadata, return object without __ properties and null values
        const obj = Object.entries(enhanced)
            .filter(([key]) => !key.startsWith("__"))
            .reduce(
                (acc, [key, val]) => {
                    const extracted = extractValueByMetadata(val, allMetadata, debug)
                    if (shouldIncludeValue(extracted)) {
                        acc[key] = extracted
                    }
                    return acc
                },
                {} as Record<string, unknown>,
            )

        // Always return the object, even if empty - empty objects have semantic meaning
        // in JSON schemas (e.g., "properties": {} vs no properties field)
        return obj
    }

    const extract = () => {
        switch (metadata.type) {
            case "array": {
                if (!Array.isArray(enhanced.value)) return undefined
                const arr = enhanced.value
                    .map((item: Record<string, any>) => {
                        return extractValueByMetadata(item, allMetadata, debug)
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
                                const toolsWithoutMetadata = (val?.value || []).map((tool: any) => {
                                    const rawTool = tool?.value ?? tool
                                    return stripAgentaMetadataDeep(rawTool)
                                })

                                acc[key] = toolsWithoutMetadata
                            } else if (
                                key === "toolCalls" &&
                                val.value &&
                                Array.isArray(val.value)
                            ) {
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
                                const extracted = extractValueByMetadata(val, allMetadata, debug)

                                if (shouldIncludeValue(extracted)) {
                                    acc[toSnakeCase(key)] = extracted
                                }
                            }
                            return acc
                        },
                        {} as Record<string, unknown>,
                    )

                if (obj.role === "tool") {
                    if (!obj.content) {
                        obj.content = ""
                    } else if (Array.isArray(obj.content)) {
                        obj.content = obj.content.map((item: any) => {
                            if (!item) return item
                            const typeValue =
                                typeof item.type === "object" && item.type
                                    ? (item.type.value ?? item.type)
                                    : item.type
                            const textValue =
                                typeof item.text === "object" && item.text
                                    ? (item.text.value ?? item.text)
                                    : (item.text ?? item.content ?? "")
                            return {
                                type: typeValue || "text",
                                text:
                                    typeof textValue === "string"
                                        ? textValue
                                        : String(textValue ?? ""),
                            }
                        })
                    }

                    if ((obj as any).toolCallId && typeof (obj as any).toolCallId === "string") {
                        obj.tool_call_id = (obj as any).toolCallId
                        delete (obj as any).toolCallId
                    } else if (
                        (obj as any).tool_call_id &&
                        typeof (obj as any).tool_call_id !== "string"
                    ) {
                        obj.tool_call_id = String((obj as any).tool_call_id ?? "")
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
                return extractValueByMetadata(enhanced.value, allMetadata, debug)
            }
            default:
                return shouldIncludeValue(enhanced.value) ? enhanced.value : undefined
        }
    }

    const extracted = extract()
    return extracted
}
