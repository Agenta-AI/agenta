import {generateId} from "@agenta/shared/utils"

import {toCamelCase} from "@/oss/lib/shared/variant/stringUtils"

import {hashMetadata} from "../../../../components/Playground/assets/hash"
import {constructPlaygroundTestUrl} from "../stringUtils"

import {createMetadata} from "./helpers/metadata"
import {isSchema} from "./helpers/schema"
import type {
    ConfigMetadata,
    Enhanced,
    ObjectMetadata,
    SchemaProperty,
    OpenAPISpec,
    ObjectSchema,
} from "./types"

function getSchemaProperties(schema: SchemaProperty): Record<string, SchemaProperty> | undefined {
    return isSchema.object(schema) ? schema.properties : undefined
}

function transformObjectValue<T extends Record<string, any>>(
    value: T,
    properties: Record<string, SchemaProperty>,
    parentMetadata?: ConfigMetadata, // Add this parameter
): Record<string, any> {
    const result = Object.entries(properties).reduce(
        (acc, [key, propSchema]) => {
            const camelKey = toCamelCase(key)
            const val = value?.[key] ?? null

            // If parent metadata exists and is an object type, get property metadata from it
            const propertyMetadata =
                typeof parentMetadata?.type === "string" && parentMetadata?.type === "object"
                    ? (parentMetadata as ObjectMetadata).properties?.[key]
                    : undefined

            acc[camelKey] = transformValue(val, propSchema, propertyMetadata)
            return acc
        },
        {} as Record<string, any>,
    )

    // Preserve any keys that are present in the value but not described in the schema
    if (value && typeof value === "object") {
        Object.keys(value).forEach((originalKey) => {
            const camelKey = toCamelCase(originalKey)
            if (camelKey in result) return
            result[camelKey] = (value as Record<string, any>)[originalKey]
        })
    }

    return result
}

function metadataToSchema(metadata: ConfigMetadata): SchemaProperty {
    const baseSchema = {
        type: metadata?.type,
        title: metadata?.title,
        description: metadata?.description,
    }

    switch (metadata?.type) {
        case "array":
            return {
                ...baseSchema,
                type: "array",
                items: metadataToSchema(metadata.itemMetadata),
                minItems: metadata.minItems,
                maxItems: metadata.maxItems,
            }
        case "object":
            return {
                ...baseSchema,
                type: "object",
                properties: Object.entries(metadata.properties).reduce(
                    (acc, [key, value]) => {
                        acc[key] = metadataToSchema(value)
                        return acc
                    },
                    {} as Record<string, SchemaProperty>,
                ),
                additionalProperties: metadata.additionalProperties,
            }
        default:
            return baseSchema as SchemaProperty
    }
}

function transformArray<T>(value: T[], metadata: ConfigMetadata & {type: "array"}) {
    const metadataHash = hashMetadata(metadata)
    return {
        __id: generateId(),
        __metadata: metadataHash,
        value: value.map((item): Enhanced<T> => {
            if (!metadata || !metadata.itemMetadata) {
                if (metadata && metadata.title === "Tools" && !metadata.itemMetadata) {
                    metadata.itemMetadata = {
                        type: "object",
                        name: "ToolConfiguration",
                        description: "Tool configuration",
                        properties: {
                            type: {
                                type: "string",
                                description: "Type of the tool",
                                title: "Type",
                                nullable: false,
                                allowFreeform: true,
                            },
                            function: {
                                type: "function",
                                properties: {
                                    name: {
                                        type: "string",
                                        title: "Name",
                                        description: "Name of the tool",
                                        nullable: false,
                                        allowFreeform: true,
                                    },
                                    description: {
                                        type: "string",
                                        title: "Description",
                                        description: "Description of the tool",
                                        nullable: false,
                                        allowFreeform: true,
                                    },
                                    parameters: {
                                        type: "object",
                                        title: "Parameters",
                                        properties: {
                                            type: {
                                                type: "string",
                                                nullable: false,
                                                allowFreeform: true,
                                                title: "Type",
                                                enum: ["object", "function"],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        required: ["name", "description", "parameters"],
                    }
                }
            }

            const itemMetadataHash = hashMetadata(metadata.itemMetadata)

            if (metadata.itemMetadata.type === "compound") {
                const subSchema = metadataToSchema(metadata.itemMetadata)
                return transformValue(item, subSchema, metadata.itemMetadata) as Enhanced<T>
            }

            if (metadata.itemMetadata.type === "object" && typeof item === "object") {
                const schema = metadataToSchema(metadata.itemMetadata)
                const properties = isSchema.object(schema) ? schema.properties || {} : {}

                let transformedObject = transformObjectValue(
                    item as Record<string, any>,
                    properties,
                    metadata.itemMetadata, // Pass the item metadata to preserve options
                )

                if (metadata.title === "Tools") {
                    transformedObject = {
                        value: item,
                    }
                }

                const returnData = {
                    __id: generateId(),
                    __metadata: itemMetadataHash,
                    ...transformedObject,
                } as Enhanced<T>

                return returnData
            }

            return {
                __id: generateId(),
                __metadata: itemMetadataHash,
                value: item,
            } as Enhanced<T>
        }),
    }
}

function transformValue<T>(
    value: T,
    schema: SchemaProperty,
    parentPropertyMetadata?: ConfigMetadata, // Add this parameter
    key?: string,
): Enhanced<T> {
    // Use parent property metadata if available, otherwise create new
    const metadata = parentPropertyMetadata || createMetadata(schema, key)
    // Handle arrays
    if (!metadata) {
        return value
    }
    if (metadata.type === "array" && Array.isArray(value)) {
        return transformArray(value, metadata) as Enhanced<T>
    }

    if (metadata.type === "compound") {
        const selectedOption =
            (Array.isArray(value)
                ? metadata.options.find((o) => (o.config as any).type === "array")
                : typeof value === "string"
                  ? metadata.options.find((o) => (o.config as any).type === "string")
                  : undefined) || metadata.options[0]

        const subMetadata = selectedOption?.config as ConfigMetadata
        const subSchema = metadataToSchema(subMetadata)
        const transformedValue = transformValue(value, subSchema, subMetadata)
        const transformed = {
            __id: generateId(),
            __metadata: hashMetadata(metadata),
            selected: selectedOption?.value,
            value: transformedValue?.value || transformedValue,
        } as Enhanced<T>

        return transformed
    }

    // Handle objects
    if (metadata.type === "object" && typeof value === "object" && value !== null) {
        const properties = getSchemaProperties(schema)
        if (!properties) {
            return transformPrimitive<T>(value, metadata)
        }

        const metadataHash = hashMetadata(metadata)

        return {
            __id: generateId(),
            __metadata: metadataHash,
            ...transformObjectValue(value, properties, metadata),
        } as Enhanced<T>
    }

    return transformPrimitive(value, metadata)
}

export function transformPrimitive<T>(value: T, metadata: ConfigMetadata): Enhanced<T> {
    const metadataHash = hashMetadata(metadata)

    // Unwrap already-enhanced values to prevent double-wrapping
    const unwrapped =
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "__id" in (value as Record<string, unknown>) &&
        "value" in (value as Record<string, unknown>)
            ? ((value as {value: unknown}).value as T)
            : value

    return {
        value: unwrapped,
        __id: generateId(),
        __metadata: metadataHash,
    } as Enhanced<T>
}

export const createEnhancedConfig = <T>(
    value: T,
    schema: SchemaProperty,
    key?: string,
): Enhanced<T> => {
    return transformValue(value, schema, undefined, key)
}

export function createNameProperty() {
    return createEnhancedConfig("Default Prompt", {
        type: "string",
        title: "Prompt Name",
        description: "Name of the prompt",
    })
}

export function detectChatVariantFromOpenAISchema(
    openApiSpec: OpenAPISpec,
    uri: {
        routePath?: string
        runtimePrefix: string
    },
): boolean {
    const operation =
        openApiSpec.paths[constructPlaygroundTestUrl(uri, "/run", false)]?.post ||
        openApiSpec.paths[constructPlaygroundTestUrl(uri, "/test", false)]?.post

    // Prefer explicit x-agenta.flags.is_chat from the SDK
    const agentaExt = (operation as Record<string, unknown>)?.["x-agenta"] as
        | Record<string, unknown>
        | undefined
    const flags = agentaExt?.flags as Record<string, unknown> | undefined
    if (flags && typeof flags.is_chat === "boolean") {
        return flags.is_chat
    }

    // Fallback: heuristic — check if request body has a "messages" property
    const properties = operation?.requestBody?.content["application/json"]?.schema?.properties
    return properties?.messages !== undefined
}

// Export other utility functions
export {createMetadata} from "./helpers/metadata"

export function mergeWithSchema<T>(
    schema: ObjectSchema,
    defaultValues: Partial<T>,
    savedValues?: Partial<T>,
    ignoreKeys?: string[],
): T {
    if (!savedValues) return defaultValues as T

    const result = {} as {[K in keyof T]: T[K]}
    const schemaProperties = schema.properties || {}

    for (const key of Object.keys(schemaProperties)) {
        // Skip ignored keys
        if (ignoreKeys?.includes(key)) continue

        const schemaProperty = schemaProperties[key]
        const propertyKey = key as keyof T

        if (schemaProperty.type === "object" && "properties" in schemaProperty) {
            // Recursively merge nested objects
            result[propertyKey] = mergeWithSchema(
                schemaProperty,
                (defaultValues[propertyKey] || {}) as any,
                savedValues[propertyKey] as any,
                ignoreKeys,
            )
        } else if (schemaProperty.type === "array") {
            // Handle arrays - prefer saved values, fallback to defaults
            result[propertyKey] = (savedValues[propertyKey] ||
                defaultValues[propertyKey] ||
                []) as T[keyof T]
        } else {
            // For primitive types, prefer saved values with fallback to defaults
            result[propertyKey] = (savedValues[propertyKey] ??
                defaultValues[propertyKey]) as T[keyof T]
        }
    }

    // Preserve unknown keys from the saved config so they are not discarded when users
    // edit JSON directly (e.g. adding new prompt properties).
    for (const key of Object.keys(savedValues)) {
        if (ignoreKeys?.includes(key)) continue
        if (key in schemaProperties) continue

        const propertyKey = key as keyof T
        result[propertyKey] = savedValues[propertyKey] as T[keyof T]
    }

    // Ensure defaults remain available for non-schema keys when no saved value exists.
    for (const key of Object.keys(defaultValues || {})) {
        if (ignoreKeys?.includes(key)) continue
        if (key in schemaProperties) continue
        if (key in result) continue

        const propertyKey = key as keyof T
        result[propertyKey] = defaultValues[propertyKey] as T[keyof T]
    }

    return result as T
}
