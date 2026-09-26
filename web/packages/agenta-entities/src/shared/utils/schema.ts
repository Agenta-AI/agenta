/**
 * Schema Utilities for Entity Controllers
 *
 * Provides unified schema handling for entity configuration:
 * - Schema property types
 * - Schema navigation utilities
 * - Default value generation
 * - Schema conversion helpers
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Unified schema property type that works for both openapi and evaluator schemas
 */
export interface SchemaProperty {
    type: "string" | "number" | "boolean" | "integer" | "array" | "object"
    title?: string
    description?: string
    default?: unknown
    enum?: unknown[]
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    items?: SchemaProperty
    properties?: Record<string, SchemaProperty>
    required?: string[]
    additionalProperties?: boolean | SchemaProperty

    // JSON Schema composition
    anyOf?: SchemaProperty[]
    oneOf?: SchemaProperty[]
    allOf?: SchemaProperty[]

    // OpenAPI/Custom extensions
    /** Single extension hint (e.g., "grouped_choice", "choice", "inline") */
    "x-parameter"?: string
    /** Custom extension for UI hints */
    "x-parameters"?: {
        prompt?: boolean
        multiline?: boolean
        code?: boolean
        hidden?: boolean
        inline?: boolean
        [key: string]: unknown
    }

    // Additional common properties
    /** Schema name (sometimes used instead of title) */
    name?: string
    /** Grouped choices for model selection (provider -> models) */
    choices?: Record<string, string[]>

    /** Allow additional properties */
    [key: string]: unknown
}

/**
 * Evaluator field definition (from settings array)
 */
export interface EvaluatorField {
    key: string
    label: string
    description?: string
    type:
        | "string"
        | "regex"
        | "number"
        | "boolean"
        | "bool"
        | "text"
        | "code"
        | "multiple_choice"
        | "object"
        | "hidden"
    required?: boolean
    default?: unknown
    min?: number
    max?: number
    options?: string[]
}

/**
 * Root schema for an entity
 */
export interface EntitySchema {
    type: "object"
    properties: Record<string, SchemaProperty>
    required?: string[]
    additionalProperties?: boolean | SchemaProperty
}

// ============================================================================
// SCHEMA NAVIGATION
// ============================================================================

/**
 * Get the schema property at a given path
 *
 * @example
 * getSchemaAtPath(schema, ["prompts", 0, "messages", 0, "role"])
 * // Returns { type: "string", enum: ["system", "user", "assistant"] }
 */
export function getSchemaAtPath(
    schema: SchemaProperty | EntitySchema | undefined,
    path: (string | number)[],
): SchemaProperty | undefined {
    if (!schema || path.length === 0) return schema as SchemaProperty | undefined

    const [head, ...tail] = path
    let nextSchema: SchemaProperty | undefined

    if (typeof head === "number") {
        // Array index - use items schema
        if (schema.type === "array" && schema.items) {
            nextSchema = schema.items
        }
    } else {
        // Object key - use properties
        if (schema.type === "object" && schema.properties) {
            nextSchema = schema.properties[head]
        }
    }

    if (!nextSchema) return undefined
    return tail.length === 0 ? nextSchema : getSchemaAtPath(nextSchema, tail)
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Get the default value for a schema type
 */
export function getDefaultValue(schema: SchemaProperty | undefined): unknown {
    if (!schema) return undefined

    // Use explicit default if provided
    if (schema.default !== undefined) {
        return schema.default
    }

    // Generate default based on type
    switch (schema.type) {
        case "string":
            return ""
        case "number":
        case "integer":
            return schema.minimum ?? 0
        case "boolean":
            return false
        case "array":
            return []
        case "object":
            if (schema.properties) {
                const obj: Record<string, unknown> = {}
                for (const [key, prop] of Object.entries(schema.properties)) {
                    // Only include required fields by default
                    if (schema.required?.includes(key)) {
                        obj[key] = getDefaultValue(prop)
                    }
                }
                return obj
            }
            return {}
        default:
            return undefined
    }
}

// ============================================================================
// SCHEMA CONVERSION
// ============================================================================

/**
 * Convert evaluator field definition to unified schema property
 */
export function evaluatorFieldToSchema(field: EvaluatorField): SchemaProperty {
    const base: SchemaProperty = {
        type: "string",
        title: field.label,
        description: field.description,
        default: field.default,
    }

    switch (field.type) {
        case "number":
            return {
                ...base,
                type: "number",
                minimum: field.min,
                maximum: field.max,
            }
        case "boolean":
        case "bool":
            return {
                ...base,
                type: "boolean",
            }
        case "multiple_choice":
            return {
                ...base,
                type: "string",
                enum: field.options,
            }
        case "object":
            return {
                ...base,
                type: "object",
                additionalProperties: true,
            }
        case "text":
        case "code":
            return {
                ...base,
                type: "string",
                "x-parameters": {
                    multiline: true,
                    code: field.type === "code",
                },
            }
        case "hidden":
            return {
                ...base,
                type: "string",
                "x-parameters": {
                    hidden: true,
                },
            }
        case "string":
        case "regex":
        default:
            return base
    }
}

// ============================================================================
// MESSAGE SCHEMA (for chat variants)
// ============================================================================

/**
 * Standard message schema for chat variants
 */
export const messageSchema: SchemaProperty = {
    type: "object",
    properties: {
        role: {
            type: "string",
            enum: ["system", "user", "assistant", "tool"],
            default: "user",
        },
        content: {
            type: "string",
            default: "",
            "x-parameters": {
                multiline: true,
            },
        },
        name: {
            type: "string",
        },
        tool_call_id: {
            type: "string",
        },
        tool_calls: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "string"},
                    type: {type: "string", default: "function"},
                    function: {
                        type: "object",
                        properties: {
                            name: {type: "string"},
                            arguments: {type: "string"},
                        },
                    },
                },
            },
        },
    },
    required: ["role", "content"],
}

/**
 * Standard messages array schema
 */
export const messagesSchema: SchemaProperty = {
    type: "array",
    items: messageSchema,
    default: [],
}
