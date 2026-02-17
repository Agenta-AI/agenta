/**
 * Value Extraction Utilities
 *
 * Core functions for extracting raw values from enhanced value wrappers
 * using metadata-based type resolution.
 *
 * @packageDocumentation
 */

import {stripAgentaMetadataDeep, stripEnhancedWrappers} from "@agenta/shared/utils"

import {extractAllEndpointSchemas} from "../api"
import type {OpenAPISpec} from "../api"
import type {ConfigMetadata, ObjectMetadata} from "../types/enhanced"

export {stripAgentaMetadataDeep, stripEnhancedWrappers}

function isObjectMetadata(metadata: ConfigMetadata): metadata is ObjectMetadata {
    return metadata?.type === "object"
}

// Local one-liner — same as parameterConversion.ts's internal toSnakeCaseKey
const toSnakeCase = (str: string): string =>
    str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

export {toSnakeCase}

function shouldIncludeValue(value: unknown): boolean {
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

const checkValidity = (obj: Record<string, any>, metadata: ConfigMetadata) => {
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
    if (metadata.type === "object" && metadata.title === "Message" && metadata.properties) {
        const props = metadata.properties
        const nullableKeys = Object.keys(props)
            .map((key) => {
                const snaked = toSnakeCase(key)
                if (props[key].nullable) {
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
 * Extract raw value based on metadata type.
 *
 * This is the core function for unwrapping enhanced values using the metadata store.
 * It recursively processes enhanced value wrappers ({value, __id, __metadata}),
 * resolving each level's metadata type to determine how to extract the raw value.
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
                if (!metadata.options) return undefined
                const options = metadata.options
                const option = options.find(
                    (o) =>
                        "value" in o &&
                        o.value ===
                            (enhanced.selected ||
                                ("value" in options[0] ? options[0].value : undefined)),
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

/**
 * Extract input keys from an OpenAPI spec, excluding ag_config and messages.
 */
export const extractInputKeysFromSchema = (spec: OpenAPISpec, routePath = "") => {
    const {primaryEndpoint} = extractAllEndpointSchemas(spec as any, routePath)
    if (!primaryEndpoint?.requestProperties) return []
    return primaryEndpoint.requestProperties.filter(
        (key: string) => !["ag_config", "messages"].includes(key),
    )
}

/**
 * Extract input values from an enhanced input row.
 * Unwraps enhanced primitive wrappers ({value: X}) and strips metadata fields.
 */
export function extractInputValues(inputRow: Record<string, any>): Record<string, string> {
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
