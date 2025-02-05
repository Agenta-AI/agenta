import {hashMetadata} from "../../hash"

import type {
    ConfigMetadata,
    Enhanced,
    ObjectMetadata,
    SchemaProperty,
    OpenAPISpec,
    ObjectSchema,
} from "./types"
import {generateId, toCamelCase} from "./utilities/string"
import {isSchema} from "./utilities/schema"
import {createMetadata} from "./helpers/metadata"

function getSchemaProperties(schema: SchemaProperty): Record<string, SchemaProperty> | undefined {
    return isSchema.object(schema) ? schema.properties : undefined
}

function transformObjectValue<T extends Record<string, any>>(
    value: T,
    properties: Record<string, SchemaProperty>,
    parentMetadata?: ConfigMetadata, // Add this parameter
): Record<string, Enhanced<any>> {
    return Object.entries(properties).reduce(
        (acc, [key, propSchema]) => {
            const camelKey = toCamelCase(key)
            const val = value?.[key] ?? null

            // If parent metadata exists and is an object type, get property metadata from it
            const propertyMetadata =
                parentMetadata?.type === "object"
                    ? (parentMetadata as ObjectMetadata).properties?.[key]
                    : undefined

            acc[camelKey] = transformValue(val, propSchema, propertyMetadata)
            return acc
        },
        {} as Record<string, Enhanced<any>>,
    )
}

function metadataToSchema(metadata: ConfigMetadata): SchemaProperty {
    const baseSchema = {
        type: metadata.type,
        title: metadata.title,
        description: metadata.description,
    }

    switch (metadata.type) {
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
            const itemMetadataHash = hashMetadata(metadata.itemMetadata)

            if (metadata.itemMetadata.type === "object" && typeof item === "object") {
                const schema = metadataToSchema(metadata.itemMetadata)
                const properties = isSchema.object(schema) ? schema.properties || {} : {}
                const transformedObject = transformObjectValue(
                    item as Record<string, any>,
                    properties,
                    metadata.itemMetadata, // Pass the item metadata to preserve options
                )

                return {
                    __id: generateId(),
                    __metadata: itemMetadataHash,
                    ...transformedObject,
                } as Enhanced<T>
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
): Enhanced<T> {
    // Use parent property metadata if available, otherwise create new
    const metadata = parentPropertyMetadata || createMetadata(schema)

    // Handle arrays
    if (metadata.type === "array" && Array.isArray(value)) {
        return transformArray(value, metadata) as Enhanced<T>
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
            ...transformObjectValue(value, properties),
        } as Enhanced<T>
    }

    return transformPrimitive(value, metadata)
}

export function transformPrimitive<T>(value: T, metadata: ConfigMetadata): Enhanced<T> {
    const metadataHash = hashMetadata(metadata)

    return {
        value,
        __id: generateId(),
        __metadata: metadataHash,
    } as Enhanced<T>
}

export const createEnhancedConfig = <T>(value: T, schema: SchemaProperty): Enhanced<T> => {
    return transformValue(value, schema)
}

export function createNameProperty() {
    return createEnhancedConfig("Default Prompt", {
        type: "string",
        title: "Prompt Name",
        description: "Name of the prompt",
    })
}

export function detectChatVariantFromOpenAISchema(openApiSpec: OpenAPISpec): boolean {
    const properties =
        openApiSpec.paths["/playground/run"]?.post?.requestBody?.content["application/json"]?.schema
            ?.properties
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

    return result as T
}
