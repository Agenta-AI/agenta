import type {
    SchemaProperty,
    PrimitiveSchema,
    ArraySchema,
    ObjectSchema,
    AnyOfSchema,
    ObjectWithConstSchema,
} from "../types"

/** Base type guard for schema type checking */
export const hasType = (
    schema: SchemaProperty,
): schema is Extract<SchemaProperty, {type: string}> =>
    "type" in schema && typeof schema.type === "string"

/** Schema type guards */
export const isSchema = {
    array: (schema: SchemaProperty): schema is ArraySchema =>
        hasType(schema) && schema.type === "array",
    object: (schema: SchemaProperty): schema is ObjectSchema =>
        hasType(schema) && schema.type === "object",
    primitive: (schema: SchemaProperty): schema is PrimitiveSchema =>
        hasType(schema) && !["object", "array", "compound"].includes(schema.type),
    anyOf: (schema: SchemaProperty): schema is AnyOfSchema =>
        "anyOf" in schema && Array.isArray(schema.anyOf),
    constObject: (schema: SchemaProperty): schema is ObjectWithConstSchema => {
        if (!isSchema.object(schema)) return false
        if (!schema.properties) return false

        const typeProperty = schema.properties.type
        return (
            typeof typeProperty === "object" &&
            typeProperty !== null &&
            "type" in typeProperty &&
            typeProperty.type === "string" &&
            "const" in typeProperty
        )
    },
    objectWithConst: (schema: SchemaProperty): schema is ObjectWithConstSchema => {
        if (!isSchema.object(schema)) return false
        if (!schema.properties) return false

        const typeProperty = schema.properties.type
        return (
            typeof typeProperty === "object" &&
            typeProperty !== null &&
            "type" in typeProperty &&
            typeProperty.type === "string" &&
            "const" in typeProperty
        )
    },
    null: (schema: SchemaProperty): schema is SchemaProperty & {type: "null"} => {
        return hasType(schema) && schema.type === "null"
    },
}

export const extractNonNullSchema = (schemas: SchemaProperty[]): SchemaProperty | undefined =>
    schemas.find((schema) => hasType(schema) && schema.type !== "null")
