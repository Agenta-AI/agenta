import {extractSchema} from "./schemaExtractors"
import {processProperties} from "./metadata"

import {isSchema} from "../utilities/schema"

import type {
    ObjectSchema,
    SchemaProperty,
    ObjectMetadata,
    StringMetadata,
    ConfigMetadata,
} from "../types"

/**
 * Build base metadata for string schemas.
 * @param schema - The schema to build from.
 * @returns A base metadata object for string schemas.
 */
function buildStringBase(schema: ObjectSchema) {
    return {
        type: "string" as const,
        title: schema.title,
        description: schema.description,
    }
}

/**
 * Build base metadata for object schemas.
 * @param schema - The schema to build from.
 * @returns A base metadata object for object schemas.
 */
function buildObjectBase(schema: ObjectSchema) {
    return {
        type: "object" as const,
        title: schema.title,
        description: schema.description,
    }
}

/**
 * Process object schema with const values.
 * @param schema - The object schema to process.
 * @param parentSchema - The parent schema containing the object schema.
 * @returns A StringMetadata object containing the processed metadata.
 */
export function processObjectWithConst(
    schema: ObjectSchema,
    parentSchema: SchemaProperty,
): StringMetadata {
    const {schema: extractedSchema, isNullable} = extractSchema(parentSchema)
    const constValues = isSchema.anyOf(extractedSchema)
        ? extractedSchema.anyOf.filter(isSchema.constObject).map((s) => ({
              label: s.properties.type.title || s.properties.type.const,
              value: s.properties.type.const,
          }))
        : []

    return {
        ...buildStringBase(schema),
        options: constValues,
        allowFreeform: false,
        nullable: isNullable,
    }
}

/**
 * Process object properties recursively.
 * @param properties - The properties to process.
 * @returns A record of processed properties.
 */
function processObjectProperties(
    properties: Record<string, SchemaProperty>,
): Record<string, ConfigMetadata> {
    // Skip old item keys before calling the shared function
    const filteredProps = Object.fromEntries(
        Object.entries(properties).filter(([key]) => ![""].includes(key)),
    )
    const processedProperties = processProperties(filteredProps)
    return processedProperties
}

/**
 * Main object schema processor.
 * @param schema - The object schema to process.
 * @param parentSchema - The parent schema containing the object schema.
 * @returns An ObjectMetadata or StringMetadata object containing the processed metadata.
 */
export function processObjectSchema(
    schema: ObjectSchema,
    parentSchema?: SchemaProperty,
): ObjectMetadata | StringMetadata {
    if (schema.properties?.type && "const" in schema.properties.type && parentSchema) {
        return processObjectWithConst(schema, parentSchema)
    }

    // Simplified object processing
    return {
        ...buildObjectBase(schema),
        properties: schema.properties ? processObjectProperties(schema.properties) : {},
    }
}
