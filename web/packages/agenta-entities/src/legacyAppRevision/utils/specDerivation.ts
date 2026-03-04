/**
 * Spec Derivation Utilities
 *
 * Pure functions for deriving enhanced prompts and custom properties from
 * OpenAPI ag_config schema + saved parameters.
 *
 * These functions encapsulate the transformation logic that was previously
 * inline in schemaAtoms.ts. They are used by:
 * - Entity reactive atoms (revisionEnhancedPromptsAtomFamily, etc.)
 * - OSS transformer.ts (thin wrapper that extracts ag_config then delegates here)
 *
 * @packageDocumentation
 */

import {generateId} from "@agenta/shared/utils"

import type {EntitySchema, EntitySchemaProperty} from "../../shared"
import {
    hashMetadata as hashAndStoreMetadata,
    updateMetadataAtom,
    type ConfigMetadata,
} from "../state/metadataAtoms"

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

/**
 * Simple hash function that preserves all metadata fields including 'name'.
 * Unlike hashAndStoreMetadata which transforms schemas, this stores the object as-is.
 * Used specifically for tool configuration metadata where 'name' field is required.
 */
function hashAndStoreRawMetadata(metadata: Record<string, unknown>): string {
    // Use a stable JSON string for hashing
    const jsonString = JSON.stringify(metadata, Object.keys(metadata).sort())
    // Simple hash based on string content
    let hash = 0
    for (let i = 0; i < jsonString.length; i++) {
        const chr = jsonString.charCodeAt(i)
        hash = (hash << 5) - hash + chr
        hash |= 0 // Convert to 32bit integer
    }
    const hashKey = `raw_${Math.abs(hash).toString(16)}`
    // Store the raw metadata - cast to ConfigMetadata compatible type
    updateMetadataAtom({[hashKey]: metadata as unknown as ConfigMetadata})
    return hashKey
}

/**
 * Static schema for tool configuration - used to generate metadata hash.
 * This matches the schema used when adding tools via addPromptToolMutationAtomFamily.
 */
const TOOL_CONFIGURATION_SCHEMA = {
    type: "object",
    name: "ToolConfiguration",
    description: "Tool configuration",
    properties: {
        type: {
            type: "string",
            description: "Type of the tool",
        },
        name: {
            type: "string",
            description: "Name of the tool",
        },
        description: {
            type: "string",
            description: "Description of the tool",
        },
        parameters: {
            type: "object",
            properties: {
                type: {
                    type: "string",
                    enum: ["object", "function"],
                },
            },
        },
    },
    required: ["name", "description", "parameters"],
}

/**
 * Enhance an array of tools by adding __id and __metadata to each item.
 * This is necessary for UI components (ToolsRenderer) that rely on __id to identify tools.
 *
 * Uses hashAndStoreRawMetadata to preserve the 'name' field which is required
 * by renderMap.object to detect ToolConfiguration and render PlaygroundTool.
 */
export function enhanceToolsArray(tools: unknown[]): unknown[] {
    if (!Array.isArray(tools)) return []

    return tools.map((tool) => {
        // If tool already has __id (e.g., from draft state), preserve it
        if (tool && typeof tool === "object" && "__id" in tool) {
            return tool
        }

        // Enhance the tool with __id and __metadata
        // Use hashAndStoreRawMetadata to preserve all fields including 'name'
        return {
            __id: generateId(),
            __metadata: hashAndStoreRawMetadata(TOOL_CONFIGURATION_SCHEMA),
            value: tool,
        }
    })
}

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
 * Merge schema defaults with saved configuration for a prompt
 */
function mergePromptWithSaved(
    schema: EntitySchemaProperty,
    savedValue: unknown,
    key: string,
): Record<string, unknown> {
    const schemaRecord = schema as unknown as Record<string, unknown>
    const schemaDefault = schemaRecord.default as Record<string, unknown> | undefined
    const saved = savedValue as Record<string, unknown> | undefined

    // Start with schema defaults
    const merged: Record<string, unknown> = {...(schemaDefault || {})}

    // Override with saved values
    if (saved) {
        Object.assign(merged, saved)
    }

    // Backfill messages from legacy fields if not present
    const hasMessages = Array.isArray(merged.messages) && (merged.messages as unknown[]).length > 0
    const sys = saved?.system_prompt as string | undefined
    const usr = saved?.user_prompt as string | undefined

    if (!hasMessages && (sys || usr)) {
        const messages: {role: string; content: string}[] = []
        if (sys) {
            messages.push({role: "system", content: sys})
        }
        if (usr) {
            messages.push({role: "user", content: usr})
        }
        merged.messages = messages
    }

    return merged
}

/**
 * Unwrap a value that may already be in enhanced format ({value, __id, __metadata}).
 * Returns the raw inner value to prevent double-wrapping.
 */
function unwrapIfEnhanced(value: unknown): unknown {
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "__id" in (value as Record<string, unknown>) &&
        "value" in (value as Record<string, unknown>)
    ) {
        return (value as {value: unknown}).value
    }
    return value
}

/**
 * Create an enhanced value with __id and metadata hash
 * The __id is required by UI components to identify and manage properties
 */
function createEnhancedValue(
    value: unknown,
    schema: EntitySchemaProperty | undefined,
    key: string,
): {value: unknown; __id: string; __metadata?: string} {
    const id = generateId()
    const unwrapped = unwrapIfEnhanced(value)
    if (schema) {
        const metadataHash = hashAndStoreMetadata(schema, key)
        return {value: unwrapped, __id: id, __metadata: metadataHash}
    }
    return {value: unwrapped, __id: id}
}

/**
 * Create enhanced prompt from merged data and schema
 */
function createEnhancedPrompt(
    mergedData: Record<string, unknown>,
    schema: EntitySchemaProperty,
    key: string,
): EnhancedPrompt {
    // Use getEffectiveProperties to handle allOf wrapping from Pydantic v2
    // (e.g., { allOf: [{ $ref resolved }], default: {...} } → merged properties)
    const schemaRecord = schema as unknown as Record<string, unknown>
    const schemaProperties = getEffectiveProperties(schemaRecord)

    const result: EnhancedPrompt = {
        __id: `prompt:${key}`,
        __name: key,
        __test: generateId(),
    }

    // Hash the prompt schema itself
    result.__metadata = hashAndStoreMetadata(schema, key)

    // Process messages
    const messages = mergedData.messages as {role: string; content: string}[] | undefined
    if (messages && Array.isArray(messages)) {
        const messagesSchema = schemaProperties?.messages as EntitySchemaProperty | undefined
        const itemSchema = (messagesSchema as unknown as Record<string, unknown>)?.items as
            | Record<string, EntitySchemaProperty>
            | undefined
        const itemProperties = itemSchema
            ? getEffectiveProperties(itemSchema as unknown as Record<string, unknown>)
            : undefined

        // Each message object needs __id for MessagesRenderer to render rich PromptMessageConfig
        const enhancedMessages = messages.map((msg, idx) => ({
            __id: generateId(),
            role: createEnhancedValue(
                msg.role,
                itemProperties?.role as EntitySchemaProperty | undefined,
                `messages[${idx}].role`,
            ),
            content: createEnhancedValue(
                msg.content,
                itemProperties?.content as EntitySchemaProperty | undefined,
                `messages[${idx}].content`,
            ),
        }))

        result.messages = {
            value: enhancedMessages as NonNullable<EnhancedPrompt["messages"]>["value"],
            __metadata: messagesSchema
                ? hashAndStoreMetadata(messagesSchema, "messages")
                : undefined,
        }
    }

    // Process llm_config - enhance each property individually
    const llmConfig = mergedData.llm_config as Record<string, unknown> | undefined
    const llmConfigSchema = schemaProperties?.llm_config as EntitySchemaProperty | undefined
    const llmConfigSchemaProps = llmConfigSchema
        ? getEffectiveProperties(llmConfigSchema as unknown as Record<string, unknown>)
        : undefined

    if (llmConfig || llmConfigSchemaProps) {
        // Create enhanced llm_config with individually enhanced properties
        const enhancedLlmConfig: NonNullable<EnhancedPrompt["llm_config"]> = {
            __id: generateId(),
            __metadata: llmConfigSchema
                ? hashAndStoreMetadata(llmConfigSchema, "llm_config")
                : undefined,
        }

        // First, enhance properties from saved/merged llm_config
        if (llmConfig) {
            Object.entries(llmConfig).forEach(([propKey, propValue]) => {
                const propSchema = llmConfigSchemaProps?.[propKey]

                // Special handling for tools array - each tool needs its own __id
                if (propKey === "tools" && Array.isArray(propValue)) {
                    const enhancedTools = enhanceToolsArray(propValue)
                    enhancedLlmConfig[propKey] = {
                        value: enhancedTools,
                        __id: generateId(),
                        __metadata: propSchema
                            ? hashAndStoreMetadata(propSchema, propKey)
                            : undefined,
                    }
                } else {
                    enhancedLlmConfig[propKey] = createEnhancedValue(propValue, propSchema, propKey)
                }
            })
        }

        // Then, add schema-defined properties that don't have values yet (like response_format)
        // This ensures the UI controls work even for optional fields
        if (llmConfigSchemaProps) {
            Object.entries(llmConfigSchemaProps).forEach(([propKey, propSchema]) => {
                if (!(propKey in enhancedLlmConfig)) {
                    // Get default value from schema if available
                    const schemaDefault = (propSchema as unknown as Record<string, unknown>)
                        ?.default
                    enhancedLlmConfig[propKey] = createEnhancedValue(
                        schemaDefault ?? null,
                        propSchema,
                        propKey,
                    )
                }
            })
        }

        result.llm_config = enhancedLlmConfig
    }

    // Process other properties
    Object.entries(mergedData).forEach(([propKey, propValue]) => {
        if (propKey === "messages" || propKey === "llm_config") return
        const propSchema = schemaProperties?.[propKey]
        result[propKey] = createEnhancedValue(propValue, propSchema, propKey)
    })

    return result
}

/**
 * Create enhanced prompt from raw parameter value (no schema available)
 * Used as fallback when schema is not available
 */
function createEnhancedPromptFromValue(value: unknown, key: string): EnhancedPrompt | null {
    if (!value || typeof value !== "object") return null

    const promptData = value as Record<string, unknown>

    const isRecord = (maybeRecord: unknown): maybeRecord is Record<string, unknown> =>
        typeof maybeRecord === "object" && maybeRecord !== null && !Array.isArray(maybeRecord)

    const unwrapEnhancedValue = (maybeEnhanced: unknown): unknown => {
        if (
            typeof maybeEnhanced === "object" &&
            maybeEnhanced !== null &&
            "value" in maybeEnhanced
        ) {
            return (maybeEnhanced as {value: unknown}).value
        }
        return maybeEnhanced
    }

    const result: EnhancedPrompt = {
        __id: `prompt:${key}`,
        __name: key,
        __test: generateId(),
    }

    // Process messages - handle both raw format and already-enhanced format
    const rawMessages = promptData.messages
    if (rawMessages && Array.isArray(rawMessages)) {
        // Each message object needs __id for MessagesRenderer to render rich PromptMessageConfig
        const enhancedMessages = rawMessages.map((msg, idx: number) => {
            const msgRecord =
                typeof msg === "object" && msg !== null ? (msg as Record<string, unknown>) : {}
            const roleValue = unwrapEnhancedValue(msgRecord.role)
            const contentValue = unwrapEnhancedValue(msgRecord.content)

            return {
                __id: generateId(),
                role: createEnhancedValue(roleValue, undefined, `messages[${idx}].role`),
                content: createEnhancedValue(contentValue, undefined, `messages[${idx}].content`),
            }
        })

        result.messages = {
            value: enhancedMessages as NonNullable<EnhancedPrompt["messages"]>["value"],
        }
    }

    // Process llm_config - enhance each property individually
    const rawLlmConfig = promptData.llm_config
    if (rawLlmConfig) {
        const llmConfigValue = unwrapEnhancedValue(rawLlmConfig)

        if (isRecord(llmConfigValue)) {
            // Create enhanced llm_config with individually enhanced properties
            const enhancedLlmConfig: NonNullable<EnhancedPrompt["llm_config"]> = {
                __id: generateId(),
            }

            // Enhance each property in llm_config individually
            Object.entries(llmConfigValue).forEach(([propKey, propValue]) => {
                const actualValue = unwrapEnhancedValue(propValue)

                // Special handling for tools array - each tool needs its own __id
                if (propKey === "tools" && Array.isArray(actualValue)) {
                    const enhancedTools = enhanceToolsArray(actualValue)
                    enhancedLlmConfig[propKey] = {
                        value: enhancedTools,
                        __id: generateId(),
                    }
                } else {
                    enhancedLlmConfig[propKey] = createEnhancedValue(
                        actualValue,
                        undefined,
                        propKey,
                    )
                }
            })

            result.llm_config = enhancedLlmConfig
        }
    }

    // Process other properties
    Object.entries(promptData).forEach(([propKey, propValue]) => {
        if (propKey === "messages" || propKey === "llm_config") return
        // Check if already in enhanced format
        const actualValue = unwrapEnhancedValue(propValue)
        result[propKey] = createEnhancedValue(actualValue, undefined, propKey)
    })

    return result
}

// ============================================================================
// PUBLIC API
// ============================================================================

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
 * Derive enhanced prompts from ag_config schema + saved parameters.
 *
 * This is the core derivation function used by both entity atoms and OSS transformer.
 *
 * @param agConfigSchema - The ag_config schema (with properties for each prompt/custom prop)
 * @param parameters - Saved parameter values (the ag_config object from the revision)
 * @returns Array of enhanced prompts ready for UI consumption
 */
export function deriveEnhancedPrompts(
    agConfigSchema: EntitySchema | null,
    parameters: Record<string, unknown> | undefined,
): EnhancedPrompt[] {
    const result: EnhancedPrompt[] = []

    // Strategy 1: Use schema if available (preferred - has x-parameters metadata)
    if (agConfigSchema?.properties) {
        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const propSchema = prop as EntitySchemaProperty
            const savedValue = parameters?.[key]

            if (isPromptProperty(propSchema, savedValue)) {
                // Merge schema defaults with saved values
                const mergedData = mergePromptWithSaved(propSchema, savedValue, key)

                // Create enhanced prompt
                const enhancedPrompt = createEnhancedPrompt(mergedData, propSchema, key)
                result.push(enhancedPrompt)
            }
        })

        return result
    }

    // Strategy 2: Derive from parameters if schema not available
    // Use isPromptLikeStructure to detect prompts from raw values
    if (parameters && Object.keys(parameters).length > 0) {
        Object.entries(parameters).forEach(([key, value]) => {
            if (isPromptLikeStructure(value)) {
                const enhancedPrompt = createEnhancedPromptFromValue(value, key)
                if (enhancedPrompt) {
                    result.push(enhancedPrompt)
                }
            }
        })

        return result
    }

    return result
}

/**
 * Derive enhanced custom properties (non-prompt) from ag_config schema + saved parameters.
 *
 * This is the core derivation function used by both entity atoms and OSS transformer.
 *
 * @param agConfigSchema - The ag_config schema (with properties for each prompt/custom prop)
 * @param parameters - Saved parameter values (the ag_config object from the revision)
 * @returns Record of enhanced custom properties ready for UI consumption
 */
export function deriveEnhancedCustomProperties(
    agConfigSchema: EntitySchema | null,
    parameters: Record<string, unknown> | undefined,
): Record<string, EnhancedCustomProperty> {
    const result: Record<string, EnhancedCustomProperty> = {}

    // Schema is required for custom properties — no fallback to parameter inference
    if (!agConfigSchema?.properties) {
        return result
    }

    Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
        const propSchema = prop as EntitySchemaProperty
        const savedValue = parameters?.[key]

        // Only include if NOT a prompt
        if (!isPromptProperty(propSchema, savedValue)) {
            // Get default value: prefer top-level schema default, then property-level default
            const topLevelDefault = (agConfigSchema as unknown as Record<string, unknown>)
                ?.default as Record<string, unknown> | undefined
            const propertyDefault = (propSchema as unknown as Record<string, unknown>)?.default
            const defaultValue = topLevelDefault?.[key] ?? propertyDefault

            // Hash the schema and store in metadata atom for UI lookup
            const metadataHash = hashAndStoreMetadata(propSchema, key)

            result[key] = {
                __id: `custom:${key}`,
                __name: key,
                __metadata: metadataHash,
                __test: generateId(),
                value: savedValue ?? defaultValue ?? "",
                schema: propSchema,
            }
        }
    })

    return result
}

// ============================================================================
// METADATA PRE-HEATING
// ============================================================================

/**
 * Pre-hash all property schemas from an agConfigSchema into the metadata store.
 *
 * Call this once when a service schema resolves, so that downstream derivation
 * functions (`deriveEnhancedPrompts`, `deriveEnhancedCustomProperties`) find
 * metadata already warm in the store — eliminating the microtask timing gap
 * between metadata registration and first consumer read.
 *
 * Walks every property in the agConfigSchema:
 * - For prompt properties: hashes the prompt schema, messages items, llm_config
 *   and each llm_config sub-property
 * - For custom properties: hashes the property schema
 */
export function preheatSchemaMetadata(agConfigSchema: EntitySchema | null): void {
    if (!agConfigSchema?.properties) return

    Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
        const propSchema = prop as EntitySchemaProperty

        // Hash the top-level property
        hashAndStoreMetadata(propSchema, key)

        // If it's a prompt-like property, also hash nested schemas
        // Use getEffectiveProperties to handle allOf wrapping from Pydantic v2
        const properties = getEffectiveProperties(propSchema as unknown as Record<string, unknown>)

        if (!properties) return

        // Hash messages schema and its item sub-properties
        const messagesSchema = properties.messages as EntitySchemaProperty | undefined
        if (messagesSchema) {
            hashAndStoreMetadata(messagesSchema, "messages")
            const itemSchema = (messagesSchema as unknown as Record<string, unknown>)?.items as
                | Record<string, unknown>
                | undefined
            const itemProperties = itemSchema ? getEffectiveProperties(itemSchema) : undefined
            if (itemProperties) {
                Object.entries(itemProperties).forEach(([itemKey, itemProp]) => {
                    hashAndStoreMetadata(itemProp as EntitySchemaProperty, itemKey)
                })
            }
        }

        // Hash llm_config schema and each sub-property
        const llmConfigSchema = properties.llm_config as EntitySchemaProperty | undefined
        if (llmConfigSchema) {
            hashAndStoreMetadata(llmConfigSchema, "llm_config")
            const llmConfigProps = getEffectiveProperties(
                llmConfigSchema as unknown as Record<string, unknown>,
            )
            if (llmConfigProps) {
                Object.entries(llmConfigProps).forEach(([propKey, subPropSchema]) => {
                    hashAndStoreMetadata(subPropSchema as EntitySchemaProperty, propKey)
                })
            }
        }
    })
}
