/**
 * Main transformation logic for converting OpenAPI schemas to enhanced variants
 *
 * This module is responsible for:
 * - Converting OpenAPI schemas into runtime configurations
 * - Handling both chat and completion variants
 * - Maintaining type safety during transformations
 * - Creating properly structured prompt configurations
 */

import {createEnhancedConfig, mergeWithSchema} from "../genericTransformer"
import type {
    OpenAPISpec,
    ObjectSchema,
    Enhanced,
    EnhancedObjectConfig,
} from "../genericTransformer/types"
import {getRequestSchema} from "../openapiUtils"
import {generateId} from "../stringUtils"

import type {EnhancedVariant, BaseVariant, AgentaConfigSchema, AgentaConfigPrompt} from "./types"

function mergeWithSavedConfig(
    schema: ObjectSchema,
    variant: BaseVariant,
): AgentaConfigSchema["default"]["prompt"] {
    // TODO: FIX THIS TYPE
    const defaultConfig = schema.default || {}
    const savedConfig = schema.key
        ? variant.parameters?.agConfig?.[schema.key] ||
          variant.parameters?.ag_config?.[schema.key] ||
          variant.parameters?.[schema.key] ||
          variant.config?.parameters?.[schema.key]
        : undefined

    // Validate and convert saved config to match AgentaConfigSchema["default"]["prompt"]
    const validatedConfig = savedConfig
        ? {
              ...savedConfig,
          }
        : undefined

    // Merge saved into defaults following schema, ignoring legacy keys we translate below
    const merged = mergeWithSchema<AgentaConfigSchema["default"]["prompt"]>(
        schema,
        defaultConfig,
        validatedConfig,
        ["input_keys", "system_prompt", "user_prompt"],
    )

    // Backfill messages from legacy fields if not present
    try {
        const hasMessages =
            Array.isArray((merged as any)?.messages) &&
            ((merged as any).messages as any[]).length > 0
        const sys = (validatedConfig as any)?.system_prompt
        const usr = (validatedConfig as any)?.user_prompt

        if (!hasMessages && (sys || usr)) {
            const messages: any[] = []
            if (sys) {
                messages.push({role: "system", content: sys})
            }
            if (usr) {
                messages.push({role: "user", content: usr})
            }
            ;(merged as any).messages = messages
        }
    } catch {
        // noop – best effort backfill
    }

    return merged
}

/**
 * Derive prompt configs from OpenAPI spec + saved parameters without mutating input
 */
export function derivePromptsFromSpec(
    variant: EnhancedVariant,
    openApiSpec: OpenAPISpec,
    routePath?: string,
): EnhancedObjectConfig<AgentaConfigPrompt>[] {
    const requestSchema = getRequestSchema(openApiSpec, {variant, routePath})

    const agConfig = requestSchema?.properties?.ag_config as AgentaConfigSchema
    const properties = agConfig?.properties || {}

    const prompts = Object.keys(properties)
        .map((key) => {
            const property = properties[key] as Record<string, any>
            const hasXParams =
                "x-parameters" in property &&
                typeof property["x-parameters"] === "object" &&
                Boolean(property["x-parameters"])
            const isPrompt = hasXParams && Boolean(property["x-parameters"]?.prompt)
            return isPrompt ? {...property, key} : null
        })
        .filter(Boolean) as ObjectSchema[]

    // Merge schema defaults with saved configuration
    const mergedPromptData = prompts.reduce(
        (acc, cur) => {
            if (!cur || !cur?.key) return acc
            const key = cur.key
            acc[key] = mergeWithSavedConfig(cur, variant)
            return acc
        },
        {} as Record<string, AgentaConfigPrompt>,
    )

    const transformedPrompts = prompts
        .map((prompt) => {
            if (!prompt || !prompt.key) return null
            const transformed = createEnhancedConfig(mergedPromptData[prompt.key], prompt)
            return {
                ...transformed,
                __name: prompt?.key,
            }
        })
        .filter(Boolean) as EnhancedObjectConfig<AgentaConfigPrompt>[]

    return transformedPrompts
}

// Debug logging for development
const DEBUG_TRANSFORMER = process.env.NODE_ENV === "development"
const logTransformer = (...args: unknown[]) => {
    if (DEBUG_TRANSFORMER) {
        console.info("[transformer/deriveCustomProperties]", ...args)
    }
}

/**
 * Check if a property looks like a prompt based on its structure
 * (has messages array and/or llm_config)
 */
function isPromptLikeStructure(value: unknown): boolean {
    if (!value || typeof value !== "object") return false
    const obj = value as Record<string, unknown>
    // Check for messages array (prompt structure)
    const hasMessages = Array.isArray(obj.messages)
    // Check for llm_config (prompt structure)
    const hasLlmConfig = obj.llm_config && typeof obj.llm_config === "object"
    return hasMessages || hasLlmConfig
}

/**
 * Derive custom properties (non-prompt) from OpenAPI spec + saved parameters
 */
export function deriveCustomPropertiesFromSpec(
    variant: EnhancedVariant,
    openApiSpec: OpenAPISpec,
    routePath?: string,
): Record<string, Enhanced<any>> {
    const parameters =
        variant.parameters && (variant.parameters as any).ag_config
            ? (variant.parameters as any).ag_config
            : (variant.parameters ?? (variant as any).config?.parameters ?? {})

    const requestSchema = getRequestSchema(openApiSpec, {variant, routePath})

    const agConfig = requestSchema?.properties?.ag_config as AgentaConfigSchema
    const properties = agConfig?.properties || {}

    // First, find prompt keys by x-parameters.prompt marker
    const promptKeysByMarker = Object.keys(properties).filter((key) => {
        const property = properties[key] as Record<string, any>
        const hasXParams =
            "x-parameters" in property &&
            typeof property["x-parameters"] === "object" &&
            Boolean(property["x-parameters"])
        return hasXParams && Boolean(property["x-parameters"]?.prompt)
    })

    // Also detect prompts by structure (for custom apps without x-parameters markers)
    const promptKeysByStructure = Object.keys(parameters).filter((key) => {
        // Skip if already identified by marker
        if (promptKeysByMarker.includes(key)) return false
        // Check if the saved value looks like a prompt
        return isPromptLikeStructure((parameters as any)?.[key])
    })

    const allPromptKeys = [...promptKeysByMarker, ...promptKeysByStructure]

    const customPropertyKeys = Object.keys(properties).filter((property) => {
        return !!property && !allPromptKeys.includes(property)
    })

    logTransformer("deriving custom properties", {
        allPropertyKeys: Object.keys(properties),
        promptKeysByMarker,
        promptKeysByStructure,
        allPromptKeys,
        customPropertyKeys,
        parametersKeys: Object.keys(parameters),
    })

    const customProperties = customPropertyKeys.reduce(
        (acc, key) => {
            const savedValue = (parameters as any)?.[key] as any
            const node = createEnhancedConfig(
                savedValue || agConfig?.default?.[key] || "",
                properties[key],
                key,
            ) as any
            // Stabilize IDs for custom properties to avoid re-mount loops
            // Use deterministic ID based on property key
            node.__id = `custom:${key}`
            node.__test = generateId()
            acc[key] = node
            return acc
        },
        {} as Record<string, Enhanced<any>>,
    )

    return customProperties
}

/**
 * Transform OpenAPI schema into an enhanced variant
 */
export function transformToEnhancedVariant(
    variant: EnhancedVariant,
    openApiSpec: OpenAPISpec,
    appType?: string,
    routePath?: string,
): EnhancedVariant {
    return variant
}
