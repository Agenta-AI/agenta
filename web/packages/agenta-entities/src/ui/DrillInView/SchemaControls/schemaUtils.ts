/**
 * Schema Utilities
 *
 * Shared utility functions for schema detection, resolution, and manipulation.
 * Used by SchemaPropertyRenderer, PromptSchemaControl, and other schema-driven components.
 */

import type {SchemaProperty} from "../../../shared"
import type {SimpleChatMessage} from "../FieldRenderers/fieldUtils"

// ============================================================================
// Schema Resolution
// ============================================================================

/**
 * Resolve anyOf/oneOf schemas to get the actual non-null schema.
 * Handles nullable types like: anyOf: [{type: "number"}, {type: "null"}]
 */
export function resolveAnyOfSchema(
    schema: SchemaProperty | null | undefined,
): SchemaProperty | null | undefined {
    if (!schema) return schema

    // Check for anyOf (most common for nullable types)
    const anyOf = (schema as any)?.anyOf as SchemaProperty[] | undefined
    if (anyOf && Array.isArray(anyOf)) {
        // Filter out null type schemas
        const nonNullSchemas = anyOf.filter((s) => s.type !== "null")
        if (nonNullSchemas.length === 1) {
            // Merge the resolved schema with parent properties (title, description, enum, etc.)
            return {
                ...nonNullSchemas[0],
                title: schema.title ?? nonNullSchemas[0].title,
                description: (schema as any).description ?? (nonNullSchemas[0] as any).description,
                // Preserve enum from parent if not in child
                enum: schema.enum ?? nonNullSchemas[0].enum,
            }
        }
        // Multiple non-null options - return the first one for now
        if (nonNullSchemas.length > 0) {
            return nonNullSchemas[0]
        }
    }

    // Check for oneOf (similar pattern)
    const oneOf = (schema as any)?.oneOf as SchemaProperty[] | undefined
    if (oneOf && Array.isArray(oneOf)) {
        const nonNullSchemas = oneOf.filter((s) => s.type !== "null")
        if (nonNullSchemas.length === 1) {
            return {
                ...nonNullSchemas[0],
                title: schema.title ?? nonNullSchemas[0].title,
                description: (schema as any).description ?? (nonNullSchemas[0] as any).description,
                enum: schema.enum ?? nonNullSchemas[0].enum,
            }
        }
        if (nonNullSchemas.length > 0) {
            return nonNullSchemas[0]
        }
    }

    return schema
}

// ============================================================================
// Schema Type Detection
// ============================================================================

/**
 * Check if schema has grouped choices (e.g., model selection)
 */
export function hasGroupedChoices(schema: SchemaProperty | null | undefined): boolean {
    if (!schema) return false

    const xParam = (schema as any)?.["x-parameter"]
    const choices = (schema as any)?.choices

    // Check for x-parameter: "grouped_choice" or "choice" with choices object
    if (xParam === "grouped_choice" || xParam === "choice") {
        return choices && typeof choices === "object" && !Array.isArray(choices)
    }

    // Also check if choices exists as a grouped object (provider -> models)
    if (choices && typeof choices === "object" && !Array.isArray(choices)) {
        return true
    }

    return false
}

/**
 * Check if the schema represents an llm_config-like object that should be rendered inline.
 * These objects have multiple properties with known LLM configuration parameters.
 */
export function isLLMConfigLike(schema: SchemaProperty | null | undefined): boolean {
    if (!schema || schema.type !== "object" || !schema.properties) return false

    const propertyNames = Object.keys(schema.properties).map((k) => k.toLowerCase())

    // Check for common llm_config properties
    const llmConfigProps = [
        "model",
        "temperature",
        "max_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
    ]
    const matchCount = propertyNames.filter((p) => llmConfigProps.includes(p)).length

    // Consider it llm_config-like if it has at least 2 of these properties
    return matchCount >= 2
}

/**
 * Check if the object schema should be rendered inline (expanded by default).
 * This includes llm_config objects and objects explicitly marked for inline rendering.
 */
export function shouldRenderObjectInline(schema: SchemaProperty | null | undefined): boolean {
    if (!schema || schema.type !== "object") return false

    // Check for x-parameters.inline or x-parameter: "inline"
    const xParams = (schema as any)?.["x-parameters"]
    const xParam = (schema as any)?.["x-parameter"]
    if (xParams?.inline === true || xParam === "inline") {
        return true
    }

    // Check for llm_config-like structure
    if (isLLMConfigLike(schema)) {
        return true
    }

    // Check for known object names that should be inline
    const name = ((schema as any)?.name || (schema as any)?.title || "").toLowerCase()
    const inlineNames = ["llm_config", "llmconfig", "model_config", "modelconfig"]
    if (inlineNames.includes(name)) {
        return true
    }

    return false
}

// ============================================================================
// LLM Config Schema Helpers
// ============================================================================

/**
 * Get the LLM config schema from prompt schema.
 * Looks for llm_config or llmConfig property.
 */
export function getLLMConfigSchema(
    schema: SchemaProperty | null | undefined,
): SchemaProperty | null {
    if (!schema?.properties) return null
    const props = schema.properties as Record<string, SchemaProperty>
    return props.llm_config || props.llmConfig || null
}

/**
 * Extract model schema from prompt schema.
 * First checks llm_config/llmConfig, then falls back to root level.
 */
export function getModelSchema(schema: SchemaProperty | null | undefined): SchemaProperty | null {
    if (!schema?.properties) return null
    const props = schema.properties as Record<string, SchemaProperty>

    // First check if model is inside llm_config
    const llmConfigSchema = getLLMConfigSchema(schema)
    if (llmConfigSchema?.properties) {
        const llmProps = llmConfigSchema.properties as Record<string, SchemaProperty>
        if (llmProps.model) return llmProps.model
    }

    // Fall back to root level
    return props.model || null
}

/**
 * Extract response_format schema from prompt schema.
 * First checks llm_config/llmConfig, then falls back to root level.
 */
export function getResponseFormatSchema(
    schema: SchemaProperty | null | undefined,
): SchemaProperty | null {
    if (!schema?.properties) return null
    const props = schema.properties as Record<string, SchemaProperty>

    // First check if response_format is inside llm_config
    const llmConfigSchema = getLLMConfigSchema(schema)
    if (llmConfigSchema?.properties) {
        const llmProps = llmConfigSchema.properties as Record<string, SchemaProperty>
        if (llmProps.response_format || llmProps.responseFormat) {
            return llmProps.response_format || llmProps.responseFormat || null
        }
    }

    // Fall back to root level
    return props.response_format || props.responseFormat || null
}

/**
 * Extract LLM config properties from prompt schema (excluding messages and model).
 * First checks llm_config/llmConfig, then falls back to root level.
 */
export function getLLMConfigProperties(
    schema: SchemaProperty | null | undefined,
): Record<string, SchemaProperty> {
    const excludeKeys = [
        "messages",
        "model",
        "tools",
        "response_format",
        "responseFormat",
        "inputKeys",
        "name",
    ]
    const llmConfigKeys = [
        "temperature",
        "max_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
    ]
    const result: Record<string, SchemaProperty> = {}

    // First check llm_config schema
    const llmConfigSchema = getLLMConfigSchema(schema)
    if (llmConfigSchema?.properties) {
        const llmProps = llmConfigSchema.properties as Record<string, SchemaProperty>
        for (const key of llmConfigKeys) {
            if (llmProps[key] && !excludeKeys.includes(key)) {
                result[key] = llmProps[key]
            }
        }
        if (Object.keys(result).length > 0) return result
    }

    // Fall back to root level
    if (!schema?.properties) return {}
    const props = schema.properties as Record<string, SchemaProperty>
    for (const key of llmConfigKeys) {
        if (props[key] && !excludeKeys.includes(key)) {
            result[key] = props[key]
        }
    }
    return result
}

/**
 * Check if llm_config is nested (vs root level properties).
 */
export function hasNestedLLMConfig(schema: SchemaProperty | null | undefined): boolean {
    return getLLMConfigSchema(schema) !== null
}

/**
 * Get the llm_config value from prompt value.
 * Handles both nested (llm_config/llmConfig) and root level.
 */
export function getLLMConfigValue(
    value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    if (!value) return {}
    return (value.llm_config || value.llmConfig || value) as Record<string, unknown>
}

// ============================================================================
// Message Normalization
// ============================================================================

/**
 * Normalize messages to SimpleChatMessage format.
 */
export function normalizeMessages(messages: unknown[]): SimpleChatMessage[] {
    return messages.map((item, index) => {
        if (typeof item !== "object" || item === null) {
            return {
                id: `msg-${index}`,
                role: "user",
                content: String(item),
            }
        }

        const msg = item as Record<string, unknown>
        return {
            id: (msg.id as string) || `msg-${index}`,
            role: (msg.role as string) || "user",
            content: (msg.content as SimpleChatMessage["content"]) ?? "",
            name: msg.name as string | undefined,
            tool_call_id: msg.tool_call_id as string | undefined,
            tool_calls: msg.tool_calls as SimpleChatMessage["tool_calls"],
            function_call: msg.function_call as SimpleChatMessage["function_call"],
        }
    })
}

/**
 * Denormalize messages back to the original format.
 */
export function denormalizeMessages(messages: SimpleChatMessage[]): Record<string, unknown>[] {
    return messages.map((msg) => {
        const result: Record<string, unknown> = {
            role: msg.role,
            content: msg.content,
        }
        if (msg.name) result.name = msg.name
        if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id
        if (msg.tool_calls && msg.tool_calls.length > 0) result.tool_calls = msg.tool_calls
        if (msg.function_call) result.function_call = msg.function_call
        return result
    })
}
