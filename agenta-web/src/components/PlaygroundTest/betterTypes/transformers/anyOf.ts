import type {AnyOfSchema, SchemaProperty} from "../openApiSchema"
import type {ConfigMetadata} from "../types"
import {createBaseMetadata} from "./metadata"
import {isSchema, extractNonNullSchema} from "../utilities/schema"
import {type CompoundMetadata} from "../baseTypes"

function processResponseFormat(schema: AnyOfSchema): CompoundMetadata {
    const options = schema.anyOf.filter(isSchema.constObject).map((option) => {
        const formatType = option.properties.type.const
        const label = option.properties.type.title || option.title || formatType

        // Safe type casting for json_schema
        const extraConfig =
            formatType === "json_schema" && "json_schema" in option.properties
                ? {
                      schema: Object.fromEntries(
                          Object.entries(option.properties.json_schema || {}).map(([k, v]) => [
                              k,
                              v as unknown,
                          ]),
                      ),
                  }
                : {}

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
        title: schema.title || "Response Format",
        description: schema.description,
        nullable: schema.anyOf.some((s) => "type" in s && s.type === "null"),
        options,
    }
}

export function processAnyOfSchema(schema: SchemaProperty): ConfigMetadata {
    if (!isSchema.anyOf(schema)) {
        throw new Error("Invalid schema: missing anyOf property")
    }

    if (schema.title === "Response Format") {
        return processResponseFormat(schema)
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
