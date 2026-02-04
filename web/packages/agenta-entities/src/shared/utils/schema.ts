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

/**
 * Get all property keys at a schema level
 */
export function getSchemaKeys(schema: SchemaProperty | undefined): string[] {
    if (!schema || schema.type !== "object" || !schema.properties) {
        return []
    }
    return Object.keys(schema.properties)
}

/**
 * Check if a path points to an array in the schema
 */
export function isArrayPath(
    schema: SchemaProperty | undefined,
    path: (string | number)[],
): boolean {
    const targetSchema = getSchemaAtPath(schema, path)
    return targetSchema?.type === "array"
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

/**
 * Create a new array item with default values based on schema
 */
export function createDefaultArrayItem(schema: SchemaProperty | undefined): unknown {
    if (!schema || schema.type !== "array" || !schema.items) {
        return {}
    }
    return getDefaultValue(schema.items)
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

/**
 * Convert array of evaluator fields to entity schema
 */
export function evaluatorFieldsToSchema(fields: EvaluatorField[]): EntitySchema {
    const properties: Record<string, SchemaProperty> = {}
    const required: string[] = []

    for (const field of fields) {
        properties[field.key] = evaluatorFieldToSchema(field)
        if (field.required !== false) {
            required.push(field.key)
        }
    }

    return {
        type: "object",
        properties,
        required,
    }
}

// ============================================================================
// OPENAPI SCHEMA EXTRACTION
// ============================================================================

/**
 * Extract prompt schema from openapi ag_config
 */
export function extractPromptSchema(
    agConfigProperties: Record<string, SchemaProperty>,
): EntitySchema | null {
    const promptKeys = Object.keys(agConfigProperties).filter((key) => {
        const prop = agConfigProperties[key]
        return prop?.["x-parameters"]?.prompt === true
    })

    if (promptKeys.length === 0) return null

    const properties: Record<string, SchemaProperty> = {}
    for (const key of promptKeys) {
        properties[key] = agConfigProperties[key]
    }

    return {
        type: "object",
        properties,
    }
}

/**
 * Extract custom properties (non-prompt) from openapi ag_config
 */
export function extractCustomPropertiesSchema(
    agConfigProperties: Record<string, SchemaProperty>,
): EntitySchema | null {
    const customKeys = Object.keys(agConfigProperties).filter((key) => {
        const prop = agConfigProperties[key]
        return prop?.["x-parameters"]?.prompt !== true
    })

    if (customKeys.length === 0) return null

    const properties: Record<string, SchemaProperty> = {}
    for (const key of customKeys) {
        properties[key] = agConfigProperties[key]
    }

    return {
        type: "object",
        properties,
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
