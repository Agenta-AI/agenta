/**
 * Schema Validator
 *
 * Validates configuration data against a JSON Schema using Zod.
 * Converts JSON Schema (from /inspect) to Zod schemas at runtime,
 * then validates user-edited config data.
 *
 * Used by PlaygroundConfigSection to surface validation errors
 * when users edit configuration in JSON/YAML raw mode.
 *
 * The validator is lenient by default:
 * - Additional properties are allowed (users can add custom fields)
 * - Missing optional fields are not errors
 * - Only type mismatches, constraint violations, and missing required fields are reported
 */

import {z} from "zod"

// ============================================================================
// TYPES
// ============================================================================

export interface SchemaValidationError {
    /** Dot-separated path to the invalid field (e.g., "prompt.temperature") */
    path: string
    /** Human-readable error message */
    message: string
}

export interface SchemaValidationResult {
    valid: boolean
    errors: SchemaValidationError[]
}

// ============================================================================
// JSON SCHEMA TYPES
// ============================================================================

interface JsonSchemaNode {
    type?: string | string[]
    properties?: Record<string, JsonSchemaNode>
    required?: string[]
    items?: JsonSchemaNode
    additionalProperties?: boolean | JsonSchemaNode
    enum?: unknown[]
    minimum?: number
    maximum?: number
    exclusiveMinimum?: number
    exclusiveMaximum?: number
    minLength?: number
    maxLength?: number
    minItems?: number
    maxItems?: number
    anyOf?: JsonSchemaNode[]
    oneOf?: JsonSchemaNode[]
    default?: unknown
    [key: string]: unknown
}

// ============================================================================
// JSON SCHEMA → ZOD CONVERSION
// ============================================================================

const MAX_DEPTH = 10

/**
 * Convert a JSON Schema node to a Zod schema.
 *
 * Handles: object, array, string, number, integer, boolean, enum,
 * anyOf/oneOf, and numeric constraints. Unknown types fall back to z.unknown().
 */
function jsonSchemaToZod(node: JsonSchemaNode, depth = 0): z.ZodTypeAny {
    if (depth > MAX_DEPTH) return z.unknown()

    // enum — before type check, since enums can coexist with type
    if (node.enum && Array.isArray(node.enum)) {
        const values = node.enum as [unknown, ...unknown[]]
        if (values.length > 0) {
            return z.enum(values.map(String) as [string, ...string[]])
        }
    }

    // anyOf / oneOf — union
    const unionSchemas = node.anyOf ?? node.oneOf
    if (unionSchemas && unionSchemas.length > 0) {
        if (unionSchemas.length === 1) {
            return jsonSchemaToZod(unionSchemas[0], depth + 1)
        }
        // Handle nullable pattern: anyOf: [{type: "X"}, {type: "null"}]
        const nonNull = unionSchemas.filter((s) => s.type !== "null")
        const hasNull = unionSchemas.some((s) => s.type === "null")
        if (hasNull && nonNull.length === 1) {
            return jsonSchemaToZod(nonNull[0], depth + 1).nullable()
        }
        const members = unionSchemas.map((s) => jsonSchemaToZod(s, depth + 1))
        if (members.length >= 2) {
            return z.union([members[0], members[1], ...members.slice(2)])
        }
        return members[0] ?? z.unknown()
    }

    const schemaType = Array.isArray(node.type) ? node.type[0] : node.type

    switch (schemaType) {
        case "object":
            return buildObjectSchema(node, depth)

        case "array": {
            const itemSchema = node.items ? jsonSchemaToZod(node.items, depth + 1) : z.unknown()
            let arr = z.array(itemSchema)
            if (node.minItems != null) arr = arr.min(node.minItems)
            if (node.maxItems != null) arr = arr.max(node.maxItems)
            return arr
        }

        case "string": {
            let str = z.string()
            if (node.minLength != null) str = str.min(node.minLength)
            if (node.maxLength != null) str = str.max(node.maxLength)
            return str
        }

        case "number":
        case "integer": {
            let num = z.number()
            if (schemaType === "integer") num = num.int()
            if (node.minimum != null) num = num.min(node.minimum)
            if (node.maximum != null) num = num.max(node.maximum)
            if (node.exclusiveMinimum != null) num = num.gt(node.exclusiveMinimum)
            if (node.exclusiveMaximum != null) num = num.lt(node.exclusiveMaximum)
            return num
        }

        case "boolean":
            return z.boolean()

        case "null":
            return z.null()

        default:
            // No type specified but has properties → treat as object
            if (node.properties) {
                return buildObjectSchema(node, depth)
            }
            return z.unknown()
    }
}

/**
 * Build a Zod object schema from a JSON Schema object node.
 * Respects additionalProperties: strict when false, loose otherwise.
 */
function buildObjectSchema(node: JsonSchemaNode, depth: number): z.ZodTypeAny {
    if (!node.properties) {
        return z.record(z.string(), z.unknown())
    }

    const requiredSet = new Set(node.required ?? [])
    const shape: Record<string, z.ZodTypeAny> = {}

    for (const [key, propSchema] of Object.entries(node.properties)) {
        let fieldSchema = jsonSchemaToZod(propSchema, depth + 1)
        if (!requiredSet.has(key)) {
            fieldSchema = fieldSchema.optional()
        }
        shape[key] = fieldSchema
    }

    // Respect additionalProperties from the JSON Schema:
    // - false → strict (reject unknown keys)
    // - true or unspecified → loose (allow extra keys)
    if (node.additionalProperties === false) {
        return z.strictObject(shape)
    }
    return z.looseObject(shape)
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a configuration object against a JSON Schema.
 *
 * Converts the schema to Zod, then validates the data.
 * Returns a list of validation errors. An empty list means the data is valid.
 * Handles edge cases gracefully — returns valid if schema is null/undefined.
 */
export function validateConfigAgainstSchema(
    data: Record<string, unknown>,
    schema: Record<string, unknown> | null | undefined,
): SchemaValidationResult {
    if (!schema) {
        return {valid: true, errors: []}
    }

    try {
        const zodSchema = jsonSchemaToZod(schema as JsonSchemaNode)
        const result = zodSchema.safeParse(data)

        if (result.success) {
            return {valid: true, errors: []}
        }

        const errors: SchemaValidationError[] = result.error.issues.map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)"
            return {path, message: issue.message}
        })

        return {valid: false, errors}
    } catch {
        // Schema conversion error — treat as valid (don't block the user)
        return {valid: true, errors: []}
    }
}
