import type {
    ConfigMetadata,
    AnyOfSchema,
    ConstDiscriminatedSchema,
    SchemaProperty,
    CompoundMetadata,
} from "../types"

import {createBaseMetadata, createMetadata} from "./metadata"
import {processObjectSchema} from "./objects"
import {isSchema} from "./schema"

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
        const processedObject = processObjectSchema(option)
        if (
            option.type === "object" &&
            Object.keys(processedObject).length > 0 &&
            !option.title?.startsWith("ResponseFormat")
        ) {
            return processedObject
        } else {
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
        const result = processConstDiscriminatedSchema(schema)
        return result
    }

    // ----- Generic mixed union handling -----
    const nonNullSchemas = schema.anyOf.filter((s) => !("type" in s && s.type === "null"))

    // If there is only one meaningful branch, fall back to previous behaviour
    if (nonNullSchemas.length === 1) {
        return {
            ...createBaseMetadata(nonNullSchemas[0]),
            title: schema.title ?? nonNullSchemas[0].title,
            description: schema.description ?? nonNullSchemas[0].description,
            nullable: schema.anyOf.length !== nonNullSchemas.length,
        }
    }

    // Build compound metadata options for each distinct branch
    const options = nonNullSchemas.map((branch, idx) => {
        const branchMetadata = createMetadata(branch)

        const label =
            branch.title || branchMetadata.title || branchMetadata.type || `Option ${idx + 1}`
        const value = branchMetadata.type ?? `option_${idx}`
        return {
            label,
            value,
            config: branchMetadata,
        }
    })

    return {
        type: "compound",
        title: schema.title,
        description: schema.description,
        nullable: schema.anyOf.length !== nonNullSchemas.length,
        options,
    }
}
