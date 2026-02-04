/**
 * LegacyAppRevision Schema Atoms
 *
 * Entity-scoped schema atoms for OpenAPI schema fetching and selectors.
 *
 * ## Two-Layer Schema Resolution
 *
 * This module implements a router pattern for schema resolution:
 *
 * 1. **Service schema (fast path)** — For completion/chat apps, the OpenAPI schema
 *    is prefetched at app-selection time from known service endpoints. When a revision
 *    is selected, the schema is already available — no additional fetch needed.
 *
 * 2. **Per-revision schema (fallback)** — For custom apps (or when service schema
 *    is unavailable), the schema is fetched from the revision's URI as before.
 *
 * @see serviceSchemaAtoms.ts — Prefetch atoms and composition logic
 * @packageDocumentation
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"
import {v4 as uuidv4} from "uuid"

import type {EntitySchema, EntitySchemaProperty} from "../../shared"
import {fetchRevisionSchema, buildRevisionSchemaState, type OpenAPISpec} from "../api"
import type {RevisionSchemaState} from "../core"

import {hashMetadata as hashAndStoreMetadata} from "./metadataAtoms"
import {
    serviceSchemaForRevisionAtomFamily,
    composedServiceSchemaAtomFamily,
} from "./serviceSchemaAtoms"
import {legacyAppRevisionEntityWithBridgeAtomFamily} from "./store"

// ============================================================================
// METADATA STORE & ENHANCEMENT UTILITIES
// ============================================================================

// Re-export the unified metadata atom for backward compatibility
export {metadataAtom as customPropertyMetadataAtom} from "./metadataAtoms"

/**
 * Generate a unique ID for enhanced properties (same as OSS)
 */
const generateId = () => uuidv4()

// ============================================================================
// SCHEMA QUERY
// ============================================================================

/**
 * Empty schema state for fallback
 */
const emptySchemaState: RevisionSchemaState = {
    openApiSchema: null,
    agConfigSchema: null,
    endpoints: {
        test: null,
        run: null,
        generate: null,
        generateDeployed: null,
        root: null,
    },
    availableEndpoints: [],
    isChatVariant: false,
}

/**
 * Direct schema query that fetches OpenAPI from revision URI.
 *
 * This depends on entity data to get the URI, then fetches and transforms
 * the OpenAPI spec into RevisionSchemaState.
 */
const directSchemaQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<RevisionSchemaState>((get) => {
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const uri = entityData?.uri
        const enabled = !!revisionId && !!uri

        return {
            queryKey: ["legacyAppRevisionSchema", revisionId, uri],
            queryFn: async (): Promise<RevisionSchemaState> => {
                if (!uri) return emptySchemaState

                const result = await fetchRevisionSchema(uri)
                if (!result || !result.schema) {
                    return {
                        ...emptySchemaState,
                        runtimePrefix: result?.runtimePrefix,
                        routePath: result?.routePath,
                    }
                }

                const schemaState = buildRevisionSchemaState(
                    result.schema as OpenAPISpec,
                    result.runtimePrefix,
                    result.routePath,
                )
                return schemaState
            },
            staleTime: 1000 * 60 * 5, // 5 minutes
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Schema query atom family — **router atom**.
 *
 * This is the single consumer-facing atom for schema data. All downstream atoms
 * (isChatVariant, messagesSchema, agConfigSchema, invocationUrl, etc.) read from
 * this atom. It routes to the appropriate source:
 *
 * 1. **Service schema (fast path):** For completion/chat apps, returns the prefetched
 *    service schema composed with revision-specific runtime context. Available
 *    immediately at revision selection — no per-revision fetch needed.
 *
 * 2. **Per-revision schema (fallback):** For custom apps, or when the service schema
 *    is unavailable, falls back to fetching from the revision's URI (existing behavior).
 *
 * Downstream consumers are unaffected by this routing — they see the same
 * `{ data: RevisionSchemaState, isPending, isError, error }` interface.
 */
export const legacyAppRevisionSchemaQueryAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // Layer 1: Try service schema (fast path for completion/chat apps)
        const serviceResult = get(serviceSchemaForRevisionAtomFamily(revisionId))

        if (serviceResult.isAvailable) {
            // Service schema route is active for this revision
            if (serviceResult.isPending) {
                return {
                    data: emptySchemaState,
                    isPending: true,
                    isError: false,
                    error: null,
                }
            }

            // Compose with revision-specific runtime context
            const composed = get(composedServiceSchemaAtomFamily(revisionId))
            if (composed) {
                return {
                    data: composed,
                    isPending: false,
                    isError: false,
                    error: null,
                }
            }

            // Service schema fetch succeeded but composition failed — fall through
        }

        // Layer 2: Per-revision schema (fallback for custom apps or failed service fetch)
        const query = get(directSchemaQueryAtomFamily(revisionId))

        // Check if the query is actually enabled (has URI)
        // A disabled query returns isPending: false but has no data - we should treat this as pending
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const hasUri = !!entityData?.uri
        const isQueryDisabled = !hasUri

        // If query is still pending (fetching) or no URI available, return pending
        if (query.isPending || isQueryDisabled) {
            return {
                data: emptySchemaState,
                isPending: true,
                isError: false,
                error: null,
            }
        }

        if (query.isError) {
            return {
                data: emptySchemaState,
                isPending: false,
                isError: true,
                error: query.error ?? null,
            }
        }

        return {
            data: query.data ?? emptySchemaState,
            isPending: false,
            isError: false,
            error: null,
        }
    }),
)

// ============================================================================
// SCHEMA SELECTORS
// ============================================================================

/**
 * Get the full openapi schema for a revision
 */
export const revisionOpenApiSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<unknown | null>((get) => {
        const query = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return query.data?.openApiSchema ?? null
    }),
)

/**
 * Get the ag_config schema for a revision
 */
export const revisionAgConfigSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const query = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return query.data?.agConfigSchema ?? null
    }),
)

/**
 * Extract prompt schema from ag_config (properties with x-parameters.prompt === true)
 */
export const revisionPromptSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
        if (!agConfigSchema?.properties) return null

        const promptProperties: Record<string, EntitySchemaProperty> = {}

        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            if (xParams?.prompt === true) {
                promptProperties[key] = prop
            }
        })

        if (Object.keys(promptProperties).length === 0) return null

        return {
            type: "object",
            properties: promptProperties,
        }
    }),
)

/**
 * Check if a parameter value looks like a prompt based on its structure
 * (has messages array and/or llm_config)
 */
function isPromptLikeStructure(value: unknown): boolean {
    if (!value || typeof value !== "object") return false
    const obj = value as Record<string, unknown>
    // Check for messages array (prompt structure)
    const hasMessages = Array.isArray(obj.messages)
    // Check for llm_config (prompt structure)
    const hasLlmConfig = Boolean(obj.llm_config && typeof obj.llm_config === "object")
    return hasMessages || hasLlmConfig
}

/**
 * Extract custom properties schema (non-prompt properties)
 *
 * Identifies prompts by:
 * 1. x-parameters.prompt === true (schema marker)
 * 2. Structure detection (has messages array or llm_config) for custom apps
 */
export const revisionCustomPropertiesSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const parameters = entityData?.parameters as Record<string, unknown> | undefined

        if (!agConfigSchema?.properties) return null

        const customProperties: Record<string, EntitySchemaProperty> = {}

        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            // Check for x-parameters.prompt marker
            const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            const isPromptByMarker = xParams?.prompt === true

            // Check for prompt-like structure in saved parameters (for custom apps)
            const savedValue = parameters?.[key]
            const isPromptByStructure = isPromptLikeStructure(savedValue)

            // Only include if NOT a prompt
            if (!isPromptByMarker && !isPromptByStructure) {
                customProperties[key] = prop
            }
        })

        if (Object.keys(customProperties).length === 0) return null

        return {
            type: "object",
            properties: customProperties,
        }
    }),
)

/**
 * Get schema property at a specific path within ag_config
 */
export function getSchemaPropertyAtPath(
    schema: EntitySchema | null,
    path: (string | number)[],
): EntitySchemaProperty | null {
    if (!schema || path.length === 0) return schema as EntitySchemaProperty | null

    let current: EntitySchemaProperty | undefined = schema as unknown as EntitySchemaProperty

    for (const segment of path) {
        if (!current) return null

        if (typeof segment === "number") {
            if (current.type === "array" && current.items) {
                current = current.items as EntitySchemaProperty
            } else {
                return null
            }
        } else {
            if (current.type === "object" && current.properties) {
                current = current.properties[segment]
            } else {
                return null
            }
        }
    }

    return current || null
}

/**
 * Create a path-specific schema selector
 */
export const revisionSchemaAtPathAtomFamily = atomFamily(
    ({revisionId, path}: {revisionId: string; path: (string | number)[]}) =>
        atom<EntitySchemaProperty | null>((get) => {
            const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
            return getSchemaPropertyAtPath(agConfigSchema, path)
        }),
    (a, b) => a.revisionId === b.revisionId && JSON.stringify(a.path) === JSON.stringify(b.path),
)

// ============================================================================
// ENDPOINT-SPECIFIC SELECTORS
// ============================================================================

/**
 * Get all endpoint schemas for a revision
 */
export const revisionEndpointsAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionSchemaState["endpoints"]>((get) => {
        const query = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return (
            query.data?.endpoints ?? {
                test: null,
                run: null,
                generate: null,
                generateDeployed: null,
                root: null,
            }
        )
    }),
)

// ============================================================================
// ENHANCED CUSTOM PROPERTIES (with values)
// ============================================================================

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

/**
 * Derive enhanced custom properties (with values) from schema + parameters
 *
 * This is the entity-level derivation that combines:
 * 1. Custom properties schema (non-prompt properties)
 * 2. Saved parameter values
 *
 * Returns a record of enhanced custom properties ready for UI consumption.
 *
 * Directly reads from schema query to ensure proper reactivity.
 */
export const revisionEnhancedCustomPropertiesAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, EnhancedCustomProperty>>((get) => {
        // Read directly from schema query to ensure subscription
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const parameters = entityData?.parameters as Record<string, unknown> | undefined

        // If schema is still loading, return empty
        if (schemaQuery.isPending) {
            return {}
        }

        const result: Record<string, EnhancedCustomProperty> = {}

        // Schema is required - no fallback to parameter inference
        if (!schemaQuery.data?.agConfigSchema?.properties) {
            return result
        }

        const agConfigSchema = schemaQuery.data.agConfigSchema

        // Extract non-prompt properties and enhance them
        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const propSchema = prop as EntitySchemaProperty

            // Check for x-parameters.prompt marker
            const xParams = (propSchema as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            const isPromptByMarker = xParams?.prompt === true

            // Check for prompt-like structure in saved parameters (for custom apps)
            const savedValue = parameters?.[key]
            const isPromptByStructure = isPromptLikeStructure(savedValue)

            // Only include if NOT a prompt
            if (!isPromptByMarker && !isPromptByStructure) {
                // Get default value from schema
                const schemaDefault = (agConfigSchema as unknown as Record<string, unknown>)
                    ?.default as Record<string, unknown> | undefined
                const defaultValue = schemaDefault?.[key]

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
    }),
)

/**
 * Get custom property keys for a revision.
 *
 * This atom directly reads from the schema query to ensure proper reactivity
 * when the async query completes.
 */
export const revisionCustomPropertyKeysAtomFamily = atomFamily((revisionId: string) =>
    atom<string[]>((get) => {
        // Read directly from schema query to ensure subscription
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const parameters = entityData?.parameters as Record<string, unknown> | undefined

        const keys: string[] = []

        // Schema is required - no fallback to parameter inference
        if (!schemaQuery.data?.agConfigSchema?.properties) {
            return keys
        }

        const agConfigSchema = schemaQuery.data.agConfigSchema
        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            const isPromptByMarker = xParams?.prompt === true

            const savedValue = parameters?.[key]
            const isPromptByStructure = isPromptLikeStructure(savedValue)

            if (!isPromptByMarker && !isPromptByStructure) {
                keys.push(key)
            }
        })

        return keys
    }),
)

// ============================================================================
// ENHANCED PROMPTS DERIVATION
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
 * Create an enhanced value with __id and metadata hash
 * The __id is required by UI components to identify and manage properties
 */
function createEnhancedValue(
    value: unknown,
    schema: EntitySchemaProperty | undefined,
    key: string,
): {value: unknown; __id: string; __metadata?: string} {
    const id = generateId()
    if (schema) {
        const metadataHash = hashAndStoreMetadata(schema, key)
        return {value, __id: id, __metadata: metadataHash}
    }
    return {value, __id: id}
}

/**
 * Create enhanced prompt from merged data and schema
 */
function createEnhancedPrompt(
    mergedData: Record<string, unknown>,
    schema: EntitySchemaProperty,
    key: string,
): EnhancedPrompt {
    const schemaProperties = (schema as unknown as Record<string, unknown>).properties as
        | Record<string, EntitySchemaProperty>
        | undefined

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
        const itemProperties = itemSchema?.properties

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
    const llmConfigSchemaProps = (llmConfigSchema as unknown as Record<string, unknown>)
        ?.properties as Record<string, EntitySchemaProperty> | undefined

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
                enhancedLlmConfig[propKey] = createEnhancedValue(propValue, propSchema, propKey)
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
                enhancedLlmConfig[propKey] = createEnhancedValue(actualValue, undefined, propKey)
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

/**
 * Derive enhanced prompts from schema + parameters
 *
 * This is the entity-level derivation that combines:
 * 1. Prompt schema (properties with x-parameters.prompt === true)
 * 2. Saved parameter values
 *
 * Returns an array of enhanced prompts ready for UI consumption.
 */
export const revisionEnhancedPromptsAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedPrompt[]>((get) => {
        // Read directly from schema query to ensure subscription
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const parameters = entityData?.parameters as Record<string, unknown> | undefined

        const result: EnhancedPrompt[] = []

        // Strategy 1: Use schema if available (preferred - has x-parameters metadata)
        if (schemaQuery.data?.agConfigSchema?.properties) {
            const agConfigSchema = schemaQuery.data.agConfigSchema

            // Extract prompt properties and enhance them
            Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
                const propSchema = prop as EntitySchemaProperty

                // Check for x-parameters.prompt marker
                const xParams = (propSchema as Record<string, unknown>)?.["x-parameters"] as
                    | Record<string, unknown>
                    | undefined
                const isPromptByMarker = xParams?.prompt === true

                // Check for prompt-like structure in saved parameters (for custom apps)
                const savedValue = parameters?.[key]
                const isPromptByStructure = isPromptLikeStructure(savedValue)

                // Only include if IS a prompt
                if (isPromptByMarker || isPromptByStructure) {
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
        // This mirrors how custom properties are derived - use isPromptLikeStructure
        if (parameters && Object.keys(parameters).length > 0) {
            Object.entries(parameters).forEach(([key, value]) => {
                // Only include prompt-like structures
                if (isPromptLikeStructure(value)) {
                    // Create enhanced prompt from raw parameter value
                    const enhancedPrompt = createEnhancedPromptFromValue(value, key)
                    if (enhancedPrompt) {
                        result.push(enhancedPrompt)
                    }
                }
            })

            return result
        }

        return result
    }),
)

/**
 * Get prompt keys for a revision.
 */
export const revisionPromptKeysAtomFamily = atomFamily((revisionId: string) =>
    atom<string[]>((get) => {
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const parameters = entityData?.parameters as Record<string, unknown> | undefined

        if (schemaQuery.isPending || !schemaQuery.data?.agConfigSchema?.properties) {
            return []
        }

        const agConfigSchema = schemaQuery.data.agConfigSchema
        const keys: string[] = []

        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            const isPromptByMarker = xParams?.prompt === true

            const savedValue = parameters?.[key]
            const isPromptByStructure = isPromptLikeStructure(savedValue)

            if (isPromptByMarker || isPromptByStructure) {
                keys.push(key)
            }
        })

        return keys
    }),
)
