import {toCamelCase} from "@/oss/lib/shared/variant/stringUtils"

import type {
    BaseOption,
    ConfigMetadata,
    ObjectMetadata,
    OptionGroup,
    PrimitiveSchema,
    SchemaProperty,
    SchemaType,
    SelectOptions,
} from "../types"

import {processAnyOfSchema} from "./anyOf"
import {processArraySchema} from "./arrays"
import {processObjectSchema} from "./objects"
import {createPrimitiveMetadata} from "./primitives"
import {isSchema} from "./schema"
import {extractSchema} from "./schemaExtractors"

/**
 * Iterate over schema properties and transform them into ConfigMetadata.
 * @param properties - The properties to process.
 * @returns A record of processed properties.
 */
export function processProperties(
    properties: Record<string, SchemaProperty>,
): Record<string, ConfigMetadata> {
    return Object.entries(properties).reduce(
        (acc, [key, prop]) => {
            try {
                const {schema, isNullable} = extractSchema(prop, key)
                acc[toCamelCase(key)] = {
                    ...createMetadata(schema),
                    nullable: isNullable,
                }
            } catch (error) {
                console.warn(`Error processing property ${key}:`, error)
            }
            return acc
        },
        {} as Record<string, ConfigMetadata>,
    )
}

/**
 * Gets the schema type safely, handling AnyOf cases
 */
function getSchemaType(schema: SchemaProperty): Exclude<SchemaType, "integer" | "null"> {
    if ("anyOf" in schema) {
        const nonNullSchema = schema.anyOf.find((s) => "type" in s && s.type !== "null")
        if (!nonNullSchema || !("type" in nonNullSchema)) {
            throw new Error("No valid type found in anyOf schema")
        }
        return nonNullSchema.type === "integer"
            ? "number"
            : (nonNullSchema.type as Exclude<SchemaType, "integer" | "null">)
    }

    if ("type" in schema) {
        return schema.type === "integer"
            ? "number"
            : (schema.type as Exclude<SchemaType, "integer" | "null">)
    }

    throw new Error("Invalid schema: missing type")
}

/**
 * Type guard for string arrays
 */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
}

/**
 * Type guard for Record<string, string[]>
 */
function isStringRecord(value: unknown): value is Record<string, string[]> {
    if (!value || typeof value !== "object") return false
    return Object.entries(value).every(
        ([_, arr]) => Array.isArray(arr) && arr.every((item) => typeof item === "string"),
    )
}

/**
 * Build a flat lookup map once instead of nested search each time
 */
function buildModelMetadataLookup(
    metadata?: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
    const lookup = new Map<string, Record<string, unknown>>()
    if (!metadata) return lookup

    for (const providerData of Object.values(metadata)) {
        if (providerData && typeof providerData === "object") {
            for (const [model, modelData] of Object.entries(providerData)) {
                lookup.set(model, modelData as Record<string, unknown>)
            }
        }
    }
    return lookup
}

/**
 * Transform options from various formats into a standardized array of label-value pairs
 */
function normalizeOptions(
    rawOptions: unknown,
    modelMetadata?: Record<string, unknown>,
): SelectOptions | undefined {
    try {
        if (!rawOptions) return undefined

        const metadataLookup = buildModelMetadataLookup(modelMetadata)

        // Helper to get metadata from the lookup map or fallback to backward compatibility check
        const getMetadata = (value: string) => {
            if (!modelMetadata) return undefined
            // Check lookup map first
            if (metadataLookup.has(value)) {
                return metadataLookup.get(value)
            }
            // Fallback: Check if we can find the model directly in the root metadata (backward compatibility)
            if (modelMetadata[value]) {
                return modelMetadata[value] as Record<string, unknown>
            }
            return undefined
        }

        if (isStringArray(rawOptions)) {
            return rawOptions.map(
                (opt): BaseOption => ({
                    label: opt,
                    value: opt,
                    metadata: getMetadata(opt),
                }),
            )
        }

        if (isStringRecord(rawOptions)) {
            return Object.entries(rawOptions).map(
                ([group, values]): OptionGroup => ({
                    label: group,
                    options: values.map(
                        (value): BaseOption => ({
                            label: value,
                            value,
                            group,
                            metadata: getMetadata(value),
                        }),
                    ),
                }),
            )
        }

        return undefined
    } catch (error) {
        console.warn("Error normalizing options:", error)
        return undefined
    }
}

function getOptionsFromSchema(schema: SchemaProperty) {
    // Only primitive types can have enums or choices
    if (schema.type && !["array", "object"].includes(schema.type)) {
        if ("enum" in schema) return schema.enum
        if ("choices" in schema) return schema.choices
    }
    return undefined
}

export function createBaseMetadata(schema: SchemaProperty) {
    const {schema: extractedSchema, parentTitle, parentDescription} = extractSchema(schema)

    const rawOptions = getOptionsFromSchema(extractedSchema)
    const modelMetadata = extractedSchema["x-model-metadata"] as Record<string, unknown> | undefined

    return {
        type: getSchemaType(extractedSchema),
        title: parentTitle ?? extractedSchema.title,
        description: parentDescription ?? extractedSchema.description,
        options: normalizeOptions(rawOptions, modelMetadata),
        ...("minimum" in extractedSchema && {min: extractedSchema.minimum}),
        ...("maximum" in extractedSchema && {max: extractedSchema.maximum}),
        ...("format" in extractedSchema && {format: extractedSchema.format}),
        ...("pattern" in extractedSchema && {pattern: extractedSchema.pattern}),
        ...(extractedSchema.type === "integer" && {isInteger: true}),
    }
}

/**
 * Convert a schema property to ConfigMetadata.
 * @param schema - The schema property to convert.
 * @returns A ConfigMetadata object.
 */
function isSimpleObjectSchema(schema: SchemaProperty): schema is Extract<
    SchemaProperty,
    {
        type: "object"
        additionalProperties: SchemaProperty | boolean
    }
> {
    return (
        "type" in schema &&
        schema.type === "object" &&
        "additionalProperties" in schema &&
        !("properties" in schema)
    )
}

function processObjectWithAdditionalProps(schema: SchemaProperty): ConfigMetadata {
    // Create a properly typed empty properties record
    const emptyPropertiesRecord: Record<string, SchemaProperty> = {}

    if (isSchema.object(schema)) {
        return {
            type: "object",
            title: schema.title,
            description: schema.description,
            properties: processProperties(schema.properties || emptyPropertiesRecord),
            additionalProperties:
                "additionalProperties" in schema ? !!schema.additionalProperties : true,
        }
    }

    // For non-object schemas, return base metadata
    const baseProps = createBaseMetadata(schema)
    return {
        ...baseProps,
        type: "object",
        properties: processProperties(emptyPropertiesRecord),
    }
}

export function createMetadata(schema: SchemaProperty, key?: string): ConfigMetadata {
    if (!schema) {
        throw new Error("Cannot create metadata from undefined schema")
    }

    let metadata: ConfigMetadata | undefined = undefined
    // Handle integer type conversion early
    if ("type" in schema && schema.type === "integer") {
        metadata = createPrimitiveMetadata({
            ...schema,
            type: "integer",
        } as PrimitiveSchema)
    } else if (isSchema.anyOf(schema)) {
        metadata = processAnyOfSchema(schema)
    } else if (isSchema.primitive(schema)) {
        metadata = createPrimitiveMetadata(schema)
    } else if (isSchema.array(schema)) {
        metadata = processArraySchema(schema)
    } else if (isSchema.object(schema)) {
        // Check for both regular objects and those with additionalProperties
        if ("additionalProperties" in schema || isSimpleObjectSchema(schema)) {
            metadata = processObjectWithAdditionalProps(schema)
        }
        metadata = processObjectSchema(schema)
    }

    if (metadata) {
        return {
            ...metadata,
            key,
        }
    } else {
        // console.debug("Unsupported schema type", schema, key)
        // throw new Error(`Unsupported schema: ${JSON.stringify(schema)} ${key}`)
    }
}

export function isObjectMetadata(metadata: ConfigMetadata): metadata is ObjectMetadata {
    return metadata.type === "object"
}
