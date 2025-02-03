import {processAnyOfSchema} from "./anyOf"
import {processArraySchema} from "./arrays"
import {processObjectSchema} from "./objects"
import {createPrimitiveMetadata} from "./primitives"
import {extractSchema} from "./schemaExtractors"

import {isSchema} from "../utilities/schema"
import {toCamelCase} from "../utilities/string"

import type {
    SelectOptions,
    BaseOption,
    OptionGroup,
    SchemaProperty,
    PrimitiveSchema,
    ConfigMetadata,
    SchemaType,
} from "../types"

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
            const {schema, isNullable} = extractSchema(prop)
            acc[toCamelCase(key)] = {
                ...createMetadata(schema),
                nullable: isNullable,
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
 * Transform options from various formats into a standardized array of label-value pairs
 */
function normalizeOptions(rawOptions: unknown): SelectOptions | undefined {
    if (!rawOptions) return undefined

    if (isStringArray(rawOptions)) {
        return rawOptions.map(
            (opt): BaseOption => ({
                label: opt,
                value: opt,
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
                    }),
                ),
            }),
        )
    }

    return undefined
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

    return {
        type: getSchemaType(extractedSchema),
        title: parentTitle ?? extractedSchema.title,
        description: parentDescription ?? extractedSchema.description,
        options: normalizeOptions(rawOptions),
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

export function createMetadata(schema: SchemaProperty): ConfigMetadata {
    if (!schema) {
        throw new Error("Cannot create metadata from undefined schema")
    }

    // Handle integer type conversion early
    if ("type" in schema && schema.type === "integer") {
        return createPrimitiveMetadata({
            ...schema,
            type: "number",
        } as PrimitiveSchema)
    }

    if (isSchema.anyOf(schema)) {
        return processAnyOfSchema(schema)
    }

    if (isSchema.primitive(schema)) {
        return createPrimitiveMetadata(schema)
    }

    if (isSchema.array(schema)) {
        return processArraySchema(schema)
    }

    if (isSchema.object(schema)) {
        // Check for both regular objects and those with additionalProperties
        if ("additionalProperties" in schema || isSimpleObjectSchema(schema)) {
            return processObjectWithAdditionalProps(schema)
        }
        return processObjectSchema(schema)
    }

    console.debug("Unsupported schema type", schema)
    throw new Error(`Unsupported schema: ${JSON.stringify(schema)}`)
}
