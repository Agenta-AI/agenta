/**
 * Spec Derivation Utilities
 *
 * Pure detection helpers for classifying OpenAPI ag_config schema properties
 * as prompts vs custom properties.
 *
 * NOTE: The enhanced derivation functions (deriveEnhancedPrompts, etc.) and
 * metadata pre-heating were removed when the metadata store was replaced
 * by JSON schema-driven rendering (SchemaPropertyRenderer + getSchemaAtPath).
 *
 * @packageDocumentation
 */

import type {EntitySchemaProperty} from "../../shared"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Enhanced prompt type - matches OSS EnhancedObjectConfig<AgentaConfigPrompt>
 */
export interface EnhancedPrompt {
    __id: string
    __name: string
    __metadata?: string
    __test?: string
    messages?: {
        value: {
            __id: string
            role: {value: string; __id: string; __metadata?: string}
            content: {value: string; __id: string; __metadata?: string}
        }[]
        __metadata?: string
    }
    llm_config?: {
        __id: string
        __metadata?: string
        [key: string]: unknown
    }
    [key: string]: unknown
}

/**
 * Enhanced custom property type
 */
export interface EnhancedCustomProperty {
    __id: string
    __name: string
    __metadata?: string
    __test?: string
    value: unknown
    schema?: EntitySchemaProperty
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Extract effective properties from a schema that may use `allOf` wrapping.
 *
 * Pydantic v2 wraps `$ref` in `allOf` when sibling properties (like `default`)
 * are present. After dereferencing, the schema becomes:
 *   { allOf: [{ type: "object", properties: {...} }], default: {...} }
 *
 * This helper merges all `allOf` branches' properties with the top-level
 * properties to produce the effective properties map.
 */
function getEffectiveProperties(
    schema: Record<string, unknown>,
): Record<string, EntitySchemaProperty> | undefined {
    // Direct properties — most common after full dereference
    const directProps = schema.properties as Record<string, EntitySchemaProperty> | undefined
    if (directProps && Object.keys(directProps).length > 0) {
        return directProps
    }

    // Unwrap allOf: merge all branches' properties
    const allOf = schema.allOf as Record<string, unknown>[] | undefined
    if (allOf && Array.isArray(allOf)) {
        const merged: Record<string, EntitySchemaProperty> = {}
        for (const branch of allOf) {
            if (branch && typeof branch === "object") {
                const branchProps = branch.properties as
                    | Record<string, EntitySchemaProperty>
                    | undefined
                if (branchProps) {
                    Object.assign(merged, branchProps)
                }
            }
        }
        if (Object.keys(merged).length > 0) {
            return merged
        }
    }

    return undefined
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Check if a parameter value looks like a prompt based on its structure
 * (has messages array and/or llm_config)
 */
export function isPromptLikeStructure(value: unknown): boolean {
    if (!value || typeof value !== "object") return false
    const obj = value as Record<string, unknown>
    // Check for messages array (prompt structure)
    const hasMessages = Array.isArray(obj.messages)
    // Check for llm_config (prompt structure)
    const hasLlmConfig = Boolean(obj.llm_config && typeof obj.llm_config === "object")
    return hasMessages || hasLlmConfig
}

/**
 * Check if a schema property looks like a prompt based on its schema structure.
 *
 * This is a fallback detection strategy for when:
 * 1. `x-parameters.prompt` marker is missing (e.g., service schemas after dereferencing)
 * 2. Saved parameter values are not available (entity data not yet synced)
 *
 * A prompt schema typically has sub-properties like `messages` (array) and/or
 * `llm_config` (object), or legacy `system_prompt`/`user_prompt` fields.
 */
export function isPromptLikeSchema(prop: EntitySchemaProperty): boolean {
    if (!prop || typeof prop !== "object") return false
    // Use getEffectiveProperties to handle allOf wrapping from Pydantic v2
    const properties = getEffectiveProperties(prop as unknown as Record<string, unknown>)
    if (!properties) return false

    // Check for messages sub-property (array of message objects)
    const messagesSchema = properties.messages
    const hasMessages =
        messagesSchema != null &&
        ((messagesSchema as unknown as Record<string, unknown>).type === "array" ||
            (messagesSchema as unknown as Record<string, unknown>).items != null)

    // Check for llm_config sub-property (object with model settings)
    const llmConfigSchema = properties.llm_config
    const hasLlmConfig =
        llmConfigSchema != null &&
        ((llmConfigSchema as unknown as Record<string, unknown>).type === "object" ||
            (llmConfigSchema as unknown as Record<string, unknown>).properties != null ||
            // Also check allOf wrapping for llm_config itself
            (llmConfigSchema as unknown as Record<string, unknown>).allOf != null)

    // Check for legacy prompt fields
    const hasLegacyPrompt = "system_prompt" in properties && "user_prompt" in properties

    return (hasMessages && hasLlmConfig) || hasLegacyPrompt
}

/**
 * Check if a schema property is a prompt (by any detection strategy).
 *
 * Uses three strategies:
 * 1. x-parameters.prompt === true (schema marker)
 * 2. Structure detection on saved value (has messages array or llm_config)
 * 3. Schema structure detection (prompt-like sub-properties)
 */
export function isPromptProperty(prop: EntitySchemaProperty, savedValue?: unknown): boolean {
    // Check for x-parameters.prompt marker
    const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
        | Record<string, unknown>
        | undefined
    const isPromptByMarker = xParams?.prompt === true

    // Check for prompt-like structure in saved parameters (for custom apps)
    const isPromptByStructure = isPromptLikeStructure(savedValue)

    // Check for prompt-like schema structure (fallback when marker/params unavailable)
    const isPromptBySchema = isPromptLikeSchema(prop)

    return isPromptByMarker || isPromptByStructure || isPromptBySchema
}

/**
 * Extract the ag_config parameters from a raw parameters object.
 * Unwraps `ag_config` or `agConfig` wrapper if present.
 */
export function extractVariantParameters(
    parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!parameters) return {}
    const agConfig = parameters.ag_config ?? parameters.agConfig
    return agConfig && typeof agConfig === "object" && !Array.isArray(agConfig)
        ? (agConfig as Record<string, unknown>)
        : parameters
}
