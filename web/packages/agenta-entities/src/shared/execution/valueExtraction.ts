/**
 * Value Extraction Utilities
 *
 * Core functions for extracting raw values from enhanced value wrappers
 * using metadata-based type resolution.
 *
 * @packageDocumentation
 */

import {stripAgentaMetadataDeep, stripEnhancedWrappers} from "@agenta/shared/utils"

import {extractAllEndpointSchemas} from "../openapi"
import type {OpenAPISpec} from "../openapi"

import type {ConfigMetadata, ObjectMetadata} from "./types"

export {stripAgentaMetadataDeep, stripEnhancedWrappers}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {})

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

const checkValidity = (obj: Record<string, unknown>, metadata: ConfigMetadata) => {
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
    _enhanced: unknown,
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

    const enhancedRecord = asRecord(enhanced)
    const metadataKey = enhancedRecord["__metadata"]
    const metadata =
        allMetadata && typeof metadataKey === "string" ? allMetadata[metadataKey] : null

    // Handle primitive enhanced values
    if (
        isRecord(enhanced) &&
        "value" in enhanced &&
        (!metadata ||
            metadata.type === "string" ||
            metadata.type === "number" ||
            metadata.type === "boolean")
    ) {
        // When metadata is missing and value is a complex type (array/object),
        // recursively process it to strip nested __id/__metadata wrappers
        const enhancedValue = enhancedRecord["value"]
        if (!metadata && enhancedValue !== null && enhancedValue !== undefined) {
            if (Array.isArray(enhancedValue)) {
                return enhancedValue
                    .map((item: unknown) => extractValueByMetadata(item, allMetadata, debug))
                    .filter(shouldIncludeValue)
            }
            if (typeof enhancedValue === "object") {
                return extractValueByMetadata(enhancedValue, allMetadata, debug)
            }
        }
        return shouldIncludeValue(enhancedValue) ? enhancedValue : undefined
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
                const enhancedValue = enhancedRecord["value"]
                if (!Array.isArray(enhancedValue)) return undefined
                const arr = enhancedValue
                    .map((item: unknown) => {
                        return extractValueByMetadata(item, allMetadata, debug)
                    })
                    .filter(shouldIncludeValue)
                    .filter(Boolean)

                return arr.length > 0 ? arr : undefined
            }
            case "object": {
                const obj = Object.entries(enhancedRecord)
                    .filter(([key]) => !key.startsWith("__"))
                    .reduce(
                        (acc, [key, val]) => {
                            if (key === "tools") {
                                const toolsValue = asRecord(val)["value"]
                                const toolsWithoutMetadata = (
                                    Array.isArray(toolsValue) ? toolsValue : []
                                ).map((tool: unknown) => {
                                    const rawTool = asRecord(tool)["value"] ?? tool
                                    return stripAgentaMetadataDeep(rawTool)
                                })

                                acc[key] = toolsWithoutMetadata
                            } else if (
                                key === "toolCalls" &&
                                Array.isArray(asRecord(val)["value"])
                            ) {
                                const cloned = (
                                    structuredClone(asRecord(val)["value"]) as unknown[]
                                ).map((call: unknown) => {
                                    const callRecord = asRecord(call)
                                    delete callRecord["__id"]
                                    delete callRecord["__metadata"]

                                    const fnRecord = asRecord(callRecord["function"])
                                    if (Object.keys(fnRecord).length > 0) {
                                        fnRecord["parameters"] = JSON.stringify(
                                            fnRecord["parameters"],
                                        )
                                    }
                                    return call
                                })
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

                if (obj["role"] === "tool") {
                    if (!obj["content"]) {
                        obj["content"] = ""
                    } else if (Array.isArray(obj["content"])) {
                        obj["content"] = obj["content"].map((item: unknown) => {
                            if (!item) return item
                            const itemRecord = asRecord(item)
                            const typeNode = asRecord(itemRecord["type"])
                            const textNode = asRecord(itemRecord["text"])
                            const typeValue =
                                (Object.keys(typeNode).length > 0
                                    ? (typeNode["value"] ?? itemRecord["type"])
                                    : itemRecord["type"]) ?? "text"
                            const textValue =
                                Object.keys(textNode).length > 0
                                    ? (textNode["value"] ?? itemRecord["text"])
                                    : (itemRecord["text"] ?? itemRecord["content"] ?? "")
                            return {
                                type: typeof typeValue === "string" ? typeValue : "text",
                                text:
                                    typeof textValue === "string"
                                        ? textValue
                                        : String(textValue ?? ""),
                            }
                        })
                    }

                    if (obj["toolCallId"] && typeof obj["toolCallId"] === "string") {
                        obj["tool_call_id"] = obj["toolCallId"]
                        delete obj["toolCallId"]
                    } else if (obj["tool_call_id"] && typeof obj["tool_call_id"] !== "string") {
                        obj["tool_call_id"] = String(obj["tool_call_id"] ?? "")
                    }
                }

                return Object.keys(obj).length > 0 && checkValidity(obj, metadata) ? obj : undefined
            }
            case "compound": {
                if (!metadata.options) return undefined
                const options = metadata.options
                const option = options.find(
                    (o: unknown) =>
                        isRecord(o) &&
                        o["value"] ===
                            (enhancedRecord["selected"] ||
                                (isRecord(options[0]) ? options[0]["value"] : undefined)),
                )
                if (!option) return undefined
                return extractValueByMetadata(enhancedRecord["value"], allMetadata, debug)
            }
            default:
                return shouldIncludeValue(enhancedRecord["value"])
                    ? enhancedRecord["value"]
                    : undefined
        }
    }

    const extracted = extract()
    return extracted
}

/**
 * Extract input keys from an OpenAPI spec, excluding ag_config and messages.
 */
export const extractInputKeysFromSchema = (spec: OpenAPISpec, routePath = "") => {
    const {primaryEndpoint} = extractAllEndpointSchemas(spec as Record<string, unknown>, routePath)
    if (!primaryEndpoint) return []

    const reservedInputKeys = new Set([
        "ag_config",
        "messages",
        "inputs",
        "environment",
        "revision_id",
        "variant_id",
        "app_id",
    ])

    const inputSchemaProperties = primaryEndpoint.inputsSchema?.properties
    const schemaInputKeys =
        inputSchemaProperties && typeof inputSchemaProperties === "object"
            ? Object.keys(inputSchemaProperties as Record<string, unknown>)
            : []

    if (schemaInputKeys.length > 0) {
        return schemaInputKeys.filter((key) => key && !reservedInputKeys.has(key))
    }

    return (primaryEndpoint.requestProperties || []).filter(
        (key: string) => key && !reservedInputKeys.has(key),
    )
}

/**
 * Heuristic: if a string value looks like a JSON object or array, parse
 * it so the request envelope carries structured data. Object-typed
 * variables (grouped `$.inputs.X.*` paths) are stored as JSON strings in
 * testcase cells — the backend resolver needs real objects to navigate
 * sub-paths like `$.inputs.X.subkey`.
 *
 * Only attempts parse when the trimmed value starts with `{` or `[`, so
 * plain text inputs don't accidentally get decoded. Failed parses leave
 * the string as-is.
 */
function coerceCellValue(raw: string): unknown {
    const trimmed = raw.trim()
    if (!trimmed) return raw
    const first = trimmed[0]
    if (first !== "{" && first !== "[") return raw
    try {
        return JSON.parse(trimmed)
    } catch {
        return raw
    }
}

/**
 * Extract input values from an enhanced input row.
 * Unwraps enhanced primitive wrappers ({value: X}) and strips metadata fields.
 *
 * Returns a dict keyed by the clean field name (not the raw JSONPath —
 * that translation happens at the port/grouping boundary). Values are
 * returned in their natural shape: strings stay strings, JSON-looking
 * strings become the parsed object/array, native objects/numbers come
 * through unchanged.
 */
export function extractInputValues(inputRow: Record<string, unknown>): Record<string, unknown> {
    return Object.entries(inputRow).reduce(
        (acc, [key, value]) => {
            if (key === "__id" || key === "__metadata" || key === "__result") {
                return acc
            }

            if (value && typeof value === "object" && "value" in value) {
                const wrappedValue = asRecord(value)["value"]
                if (typeof wrappedValue === "string") {
                    acc[key] = coerceCellValue(wrappedValue)
                } else if (wrappedValue !== undefined && wrappedValue !== null) {
                    // Already a native value (object, number, boolean) — keep
                    // as-is rather than round-tripping through JSON.stringify.
                    acc[key] = wrappedValue
                }
            }
            return acc
        },
        {} as Record<string, unknown>,
    )
}
