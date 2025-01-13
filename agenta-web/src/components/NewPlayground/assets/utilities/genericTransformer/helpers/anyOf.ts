import {createBaseMetadata} from "./metadata"

import {isSchema, extractNonNullSchema} from "../utilities/schema"

import type {
    ConfigMetadata,
    AnyOfSchema,
    ConstDiscriminatedSchema,
    SchemaProperty,
    CompoundMetadata,
} from "../types"

function isConstDiscriminatedObject(schema: SchemaProperty): schema is ConstDiscriminatedSchema {
    return (
        isSchema.object(schema) &&
        !!schema.properties &&
        !!schema.properties.type &&
        "const" in schema.properties.type
    )
}

function isConstDiscriminatedAnyOf(schema: AnyOfSchema): boolean {
    return schema.anyOf.some(isConstDiscriminatedObject)
}

function processConstDiscriminatedSchema(schema: AnyOfSchema): CompoundMetadata {
    const options = schema.anyOf.filter(isConstDiscriminatedObject).map((option) => {
        const formatType = option.properties.type.const
        const label = option.title || formatType

        // Extract additional configuration from other properties
        const extraConfig = Object.entries(option.properties)
            .filter(([key]) => key !== "type")
            .reduce(
                (acc, [key, value]) => ({
                    ...acc,
                    [key]: value,
                }),
                {},
            )

        return {
            label,
            value: formatType,
            config: {
                type: formatType,
                ...extraConfig,
            },
        }
    })

    return {
        type: "compound",
        title: schema.title || "Format Options",
        description: schema.description,
        nullable: schema.anyOf.some((s) => isSchema.null(s)),
        options,
    }
}

export function processAnyOfSchema(schema: SchemaProperty): ConfigMetadata {
    if (!isSchema.anyOf(schema)) {
        throw new Error("Invalid schema: missing anyOf property")
    }

    // Check if this is a const-discriminated union
    if (isConstDiscriminatedAnyOf(schema)) {
        return processConstDiscriminatedSchema(schema)
    }

    // Handle regular anyOf schemas (non-response-format)
    const nonNullSchema = extractNonNullSchema(schema.anyOf)
    if (!nonNullSchema) {
        throw new Error("No valid schema found in anyOf")
    }

    const baseMetadata = createBaseMetadata(nonNullSchema)
    const nullableMetadata = {
        ...baseMetadata,
        title: schema.title ?? baseMetadata.title,
        description: schema.description ?? baseMetadata.description,
        nullable: schema.anyOf.some((s) => "type" in s && s.type === "null"),
    } as const

    // Type assertion to ensure the metadata type matches the schema type
    return nullableMetadata as ConfigMetadata
}
