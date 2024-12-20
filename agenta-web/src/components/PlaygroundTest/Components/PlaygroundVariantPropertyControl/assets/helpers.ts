import type {SchemaObject, StringSchema, NumberSchema, BooleanSchema} from "../../../types/shared"

export function isSchemaObject(value: unknown): value is SchemaObject {
    return typeof value === "object" && value !== null && "type" in value
}

export function isStringSchema(schema: SchemaObject): schema is StringSchema {
    return schema.type === "string"
}

export function isNumberSchema(schema: SchemaObject): schema is NumberSchema {
    return schema.type === "number" || schema.type === "integer"
}

export function isBooleanSchema(schema: SchemaObject): schema is BooleanSchema {
    return schema.type === "boolean"
}

export function isRangeNumberSchema(schema: NumberSchema): boolean {
    return typeof schema.minimum === "number" && typeof schema.maximum === "number"
}

export function isEnumSchema(schema: StringSchema): boolean {
    return Array.isArray(schema.enum) && schema.enum.length > 0
}

export function isModelSchema(schema: StringSchema): boolean {
    return (
        schema.title?.toLowerCase().includes("model") ||
        schema.description?.toLowerCase().includes("model") ||
        schema.key === "model"
    )
}

export function isPromptSchema(schema: StringSchema): boolean {
    return (
        schema.title?.toLowerCase().includes("prompt") ||
        schema.description?.toLowerCase().includes("prompt") ||
        (typeof schema.key === "string" && schema.key.includes("prompt_"))
    )
}
