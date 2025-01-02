import type {SchemaProperty, OpenAPISpec} from "../openApiSchema"
import type {
    ConfigMetadata,
    Enhanced,
    EnhancedArrayItem,
    EnhancedArrayValue,
    EnhancedPrimitiveArrayItem,
    ObjectMetadata,
} from "../types"
import {generateId, toCamelCase} from "../utilities/string"
import {isSchema} from "../utilities/schema"
import {createMetadata} from "./metadata"

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

function transformArray<T>(
    value: T[],
    metadata: ConfigMetadata & {type: "array"},
): EnhancedArrayValue<T> {
    return {
        __id: generateId(),
        __metadata: metadata,
        value: value.map((item): EnhancedArrayItem<T> => {
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
                    __metadata: metadata.itemMetadata,
                    ...transformedObject,
                } as EnhancedArrayItem<T>
            }

            return {
                __id: generateId(),
                __metadata: metadata.itemMetadata,
                value: item,
            } as EnhancedPrimitiveArrayItem<T>
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
        return transformArray(value, metadata as ConfigMetadata & {type: "array"}) as Enhanced<T>
    }

    // Handle objects
    if (metadata.type === "object" && typeof value === "object" && value !== null) {
        const properties = getSchemaProperties(schema)
        if (!properties) {
            return transformPrimitive(value, metadata)
        }

        return {
            __id: generateId(),
            __metadata: metadata,
            ...transformObjectValue(value, properties),
        } as Enhanced<T>
    }

    return transformPrimitive(value, metadata)
}

function transformPrimitive<T>(value: T, metadata: ConfigMetadata): Enhanced<T> {
    return {
        value,
        __id: generateId(),
        __metadata: metadata,
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
export {createMetadata} from "./metadata"
