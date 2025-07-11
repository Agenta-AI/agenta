import type {
    SchemaType,
    SchemaProperty,
    AnyOfSchema,
    ExtractedSchema,
    PrimitiveSchemaType,
} from "../types"

import {hasType} from "./schema"

function isPrimitiveSchemaType(type: SchemaType | undefined): type is PrimitiveSchemaType {
    if (!type) return false
    return !["object", "array", "compound"].includes(type)
}

function createPrimitiveSchema(
    parentMetadata: Omit<AnyOfSchema, "anyOf">,
    selectedSchema: SchemaProperty,
    schemaType: SchemaType | undefined,
): SchemaProperty {
    if (!isPrimitiveSchemaType(schemaType)) {
        throw new Error(`Invalid primitive schema type: ${schemaType}`)
    }

    const choices =
        ("choices" in selectedSchema && selectedSchema.choices) ||
        ("choices" in parentMetadata && parentMetadata.choices) ||
        undefined

    const processedChoices =
        choices &&
        (Array.isArray(choices)
            ? choices.map((c) => ({label: String(c.label), value: String(c.value)}))
            : Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.map(String)])))

    return {
        ...parentMetadata,
        ...selectedSchema,
        type: schemaType,
        title: selectedSchema.title || parentMetadata.title,
        description: selectedSchema.description || parentMetadata.description,
        default: selectedSchema.default ?? parentMetadata.default,
        enum: selectedSchema.enum as string[] | undefined,
        choices: processedChoices,
    }
}

function _combineSchemas(
    parentMetadata: Omit<AnyOfSchema, "anyOf">,
    selectedSchema: SchemaProperty,
): SchemaProperty {
    if ("type" in selectedSchema) {
        const schemaType = selectedSchema.type
        switch (schemaType) {
            case "array":
                return {
                    ...parentMetadata,
                    ...selectedSchema,
                    type: "array",
                    title: selectedSchema.title || parentMetadata.title,
                    description: selectedSchema.description || parentMetadata.description,
                    default: selectedSchema.default ?? parentMetadata.default,
                }
            case "object":
                return {
                    ...parentMetadata,
                    ...selectedSchema,
                    type: "object",
                    title: selectedSchema.title || parentMetadata.title,
                    description: selectedSchema.description || parentMetadata.description,
                    default: selectedSchema.default ?? parentMetadata.default,
                }
            default:
                if (!isPrimitiveSchemaType(schemaType)) {
                    throw new Error(`Invalid schema type: ${schemaType}`)
                }
                return createPrimitiveSchema(parentMetadata, selectedSchema, schemaType)
        }
    }

    // Handle anyOf case
    if ("anyOf" in selectedSchema) {
        return {
            ...parentMetadata,
            ...selectedSchema,
        }
    }

    throw new Error("Invalid schema type")
}

/**
 * Extracts the most appropriate schema from an AnyOfSchema.
 * Prefers primitive, array, and object schemas in that order.
 * @param anyOfSchema - The AnyOfSchema to extract from.
 * @returns An ExtractedSchema object containing the chosen schema and metadata.
 *
 * An AnyOfSchema is a type of schema used in OpenAPI specifications to represent a property
 * that can conform to one of several different schemas. It is particularly useful when you
 * want to define a property that can have multiple possible types or structures. The `anyOf`
 * keyword is used to specify an array of schemas, and the property must validate against at
 * least one of these schemas.
 *
 * Example:
 * {
 *   "type": "object",
 *   "properties": {
 *     "exampleProperty": {
 *       "anyOf": [
 *         { "type": "string" },
 *         { "type": "integer" }
 *       ]
 *     }
 *   }
 * }
 *
 * In this example, `exampleProperty` can be either a string or an integer.
 */
// Recursively resolve any nested anyOf occurrences that might appear in
// array items, object properties, or the schema itself.
function resolveNestedAnyOf(schema: SchemaProperty): SchemaProperty {
    // If the schema itself is an AnyOf, extract it first.
    if ("anyOf" in schema) {
        return extractFromAnyOf(schema as AnyOfSchema).schema
    }

    // Handle array -> items
    if (schema.type === "array" && (schema as any).items) {
        const itemsSchema = (schema as any).items as SchemaProperty
        const processedItems = resolveNestedAnyOf(itemsSchema)
        return {
            ...schema,
            items: processedItems,
        }
    }

    // Handle object -> properties
    if (schema.type === "object" && (schema as any).properties) {
        const processedProps: Record<string, SchemaProperty> = {}
        for (const [key, propSchema] of Object.entries((schema as any).properties)) {
            processedProps[key] = resolveNestedAnyOf(propSchema as SchemaProperty)
        }
        return {
            ...schema,
            properties: processedProps,
        }
    }

    // Primitive or already-processed schema
    return schema
}

export function extractFromAnyOf(anyOfSchema: AnyOfSchema): ExtractedSchema {
    // Separate null from non-null branches first
    const nonNullSchemas = anyOfSchema.anyOf.filter(
        (schema) => !(hasType(schema) && schema.type === "null"),
    )

    const isNullable = anyOfSchema.anyOf.some((schema) => hasType(schema) && schema.type === "null")

    if (nonNullSchemas.length === 0) {
        throw new Error("No valid non-null schema found in anyOf")
    }

    // Recursively process every branch so nested anyOfs are flattened consistently
    const processedSchemas = nonNullSchemas.map((s) => resolveNestedAnyOf(s as SchemaProperty))

    // Combine the parent metadata with ALL processed branches instead of collapsing to one
    const {anyOf: _discard, ...parentMetadata} = anyOfSchema
    const combinedSchema: SchemaProperty = {
        ...parentMetadata,
        anyOf: processedSchemas,
    }

    return {
        schema: combinedSchema,
        isNullable,
    }
}

/**
 * Type guard to check if a schema is an AnyOfSchema.
 * @param schema - The schema to check.
 * @returns True if the schema is an AnyOfSchema, false otherwise.
 */
function isAnyOfSchema(schema: SchemaProperty): schema is AnyOfSchema {
    return "anyOf" in schema
}

/**
 * Extracts schema information from a SchemaProperty.
 * Delegates to specific extractors based on schema type.
 * @param schema - The SchemaProperty to extract from.
 * @returns An ExtractedSchema object containing the schema and metadata.
 */
export function extractSchema(schema: SchemaProperty): ExtractedSchema {
    if (isAnyOfSchema(schema)) {
        return extractFromAnyOf(schema)
    }

    return {
        schema,
        isNullable: false,
    }
}
