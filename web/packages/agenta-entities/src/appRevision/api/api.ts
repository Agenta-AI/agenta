/**
 * AppRevision API Functions
 *
 * HTTP functions and data transformers for app revision entity.
 * Includes batch fetching and cache redirect patterns.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {dereferenceSchema} from "@agenta/shared/utils"

import {
    // Type guards
    isArray,
    isRecord,
    toArray,
    // URI parsing
    parseRevisionUri,
    // Revision parameter extraction
    extractRevisionParameters,
    extractRevisionParametersFromApiRevision,
    // List item types (re-export)
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // API response types (re-export)
    type ApiVariant,
    type ApiRevisionListItem,
    type ApiApp,
    // Transform utilities
    transformAppToListItem,
    transformVariantToListItem,
    transformRevisionToListItem,
    // Enhanced variant types
    type EnhancedVariantLike,
    extractUriFromEnhanced,
} from "../../shared"
import type {AppRevisionData, PromptConfig} from "../core"

// Re-export shared types and utilities for consumers
export type {
    AppListItem,
    VariantListItem,
    RevisionListItem,
    ApiVariant,
    ApiRevisionListItem,
    ApiApp,
    EnhancedVariantLike,
}
export {transformAppToListItem}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Raw API revision response from backend
 */
export interface ApiRevision {
    id: string
    revision: number
    config: {
        config_name: string
        parameters: Record<string, unknown>
    }
    created_at?: string
    updated_at?: string
}

// EnhancedVariantLike imported from shared/utils/revisionUtils

/**
 * Batch request for revision fetching
 */
export interface RevisionRequest {
    projectId: string
    revisionId: string
}

// Type guards imported from shared/utils/revisionUtils

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

/**
 * Transform EnhancedVariant (from variant revisions cache) to AppRevisionData
 * This enables cache redirect - reusing data already fetched in the EntitySelector modal
 *
 * Also extracts raw agConfig for schema-driven approach.
 * Also captures URI/runtime info for schema fetching and invocation.
 */
export function transformEnhancedVariant(enhanced: EnhancedVariantLike): AppRevisionData {
    const prompts: PromptConfig[] = []

    // EnhancedVariant has prompts directly at top level
    const enhancedPrompts = toArray(enhanced.prompts)

    enhancedPrompts.forEach((enhancedPrompt, idx) => {
        prompts.push(transformEnhancedPrompt(enhancedPrompt, idx))
    })

    // Also get parameters from the original config if available
    const params = enhanced.parameters || {}

    // Extract raw revision parameters for schema-driven approach using shared utility
    const agConfig = extractRevisionParameters(params)

    // Extract URI/runtime info using shared utility
    const uriInfo = extractUriFromEnhanced(enhanced)
    const uri = enhanced.uri
    const runtimePrefix = uriInfo?.runtimePrefix
    const routePath = uriInfo?.routePath

    return {
        id: enhanced.id,
        variantId: enhanced.variantId || "",
        appId: enhanced.appId || "",
        revision: Number(enhanced.revision) || 1,
        prompts,
        agConfig,
        parameters: params,
        createdAt: enhanced.createdAt || enhanced.created_at,
        updatedAt: enhanced.updatedAt || enhanced.updated_at,
        // WorkflowServiceConfiguration fields
        uri,
        url: enhanced.url,
        runtimePrefix,
        routePath,
        headers: enhanced.headers as
            | Record<string, string | {id?: string; slug?: string; version?: number}>
            | undefined,
        schemas: enhanced.schemas
            ? {
                  inputs: (enhanced.schemas as Record<string, unknown>).inputs as
                      | Record<string, unknown>
                      | undefined,
                  outputs: (enhanced.schemas as Record<string, unknown>).outputs as
                      | Record<string, unknown>
                      | undefined,
              }
            : undefined,
        script: enhanced.script,
        runtime: enhanced.runtime,
        // Legacy fields
        service: enhanced.service,
        configuration: enhanced.configuration,
    }
}

/**
 * Transform an Enhanced<AgentaConfigPrompt> to PromptConfig
 * Unwraps the Enhanced wrapper structure to extract raw values
 */
function transformEnhancedPrompt(enhancedPrompt: unknown, index: number): PromptConfig {
    const prompt = enhancedPrompt as Record<string, unknown>

    // Extract name from __name or fall back
    const name = (prompt.__name as string) || `prompt_${index}`

    // Messages are in EnhancedArrayValue format: { value: Enhanced<Message>[], __id, __metadata }
    const messagesArray = toArray(prompt.messages)
    const messages = messagesArray.map((msg) => {
        if (!isRecord(msg)) return {role: "user" as const, content: ""}
        const m = msg
        const roleValue = m.role as Record<string, unknown> | string
        const contentValue = m.content as Record<string, unknown> | string
        const nameValue = m.name as Record<string, unknown> | string | undefined
        const toolCallIdValue = (m.tool_call_id || m.toolCallId) as
            | Record<string, unknown>
            | string
            | undefined

        return {
            role: ((typeof roleValue === "object" ? roleValue?.value : roleValue) || "user") as
                | "system"
                | "user"
                | "assistant"
                | "tool",
            content: ((typeof contentValue === "object" ? contentValue?.value : contentValue) ||
                "") as string,
            name: (typeof nameValue === "object" ? nameValue?.value : nameValue) as
                | string
                | undefined,
            tool_call_id: (typeof toolCallIdValue === "object"
                ? toolCallIdValue?.value
                : toolCallIdValue) as string | undefined,
        }
    })

    // llmConfig is EnhancedObjectConfig - extract values from Enhanced wrappers
    const llmConfig = (prompt.llmConfig || {}) as Record<string, unknown>

    // inputKeys is EnhancedArrayValue or array of Enhanced<string>
    const inputKeysRaw = toArray(prompt.inputKeys)
    const inputKeys = inputKeysRaw
        .map((k) => {
            if (typeof k === "string") return k
            if (isRecord(k) && typeof k.value === "string") return k.value
            return ""
        })
        .filter(Boolean)

    const getValue = (obj: Record<string, unknown>, ...keys: string[]): unknown => {
        for (const key of keys) {
            const val = obj[key] as Record<string, unknown> | unknown
            if (val !== undefined) {
                return typeof val === "object" && val !== null && "value" in val
                    ? (val as Record<string, unknown>).value
                    : val
            }
        }
        return undefined
    }

    return {
        name,
        messages,
        temperature: getValue(llmConfig, "temperature") as number | undefined,
        model: getValue(llmConfig, "model") as string | undefined,
        max_tokens: getValue(llmConfig, "maxTokens", "max_tokens") as number | undefined,
        top_p: getValue(llmConfig, "topP", "top_p") as number | undefined,
        frequency_penalty: getValue(llmConfig, "frequencyPenalty", "frequency_penalty") as
            | number
            | undefined,
        presence_penalty: getValue(llmConfig, "presencePenalty", "presence_penalty") as
            | number
            | undefined,
        inputKeys: inputKeys.length > 0 ? inputKeys : undefined,
    }
}

/**
 * Transform a single prompt from API format to PromptConfig
 */
function transformPrompt(prompt: Record<string, unknown>, index: number): PromptConfig {
    // Handle both nested llm_config and flat structure
    const llmConfig = isRecord(prompt.llm_config)
        ? prompt.llm_config
        : isRecord(prompt.llmConfig)
          ? prompt.llmConfig
          : {}

    const messagesRaw = toArray(prompt.messages)
    const messages = messagesRaw.map((msg) => {
        if (!isRecord(msg)) return {role: "user" as const, content: ""}
        return {
            role: (msg.role || "user") as "system" | "user" | "assistant" | "tool",
            content: (msg.content || "") as string,
            name: msg.name as string | undefined,
            tool_call_id: (msg.tool_call_id || msg.toolCallId) as string | undefined,
        }
    })

    return {
        name: (prompt.__name || prompt.name || `prompt_${index}`) as string,
        messages,
        temperature: (prompt.temperature ?? llmConfig.temperature) as number | undefined,
        model: (prompt.model ?? llmConfig.model) as string | undefined,
        max_tokens: (prompt.max_tokens ?? llmConfig.max_tokens ?? llmConfig.maxTokens) as
            | number
            | undefined,
        top_p: (prompt.top_p ?? llmConfig.top_p ?? llmConfig.topP) as number | undefined,
        frequency_penalty: (prompt.frequency_penalty ??
            llmConfig.frequency_penalty ??
            llmConfig.frequencyPenalty) as number | undefined,
        presence_penalty: (prompt.presence_penalty ??
            llmConfig.presence_penalty ??
            llmConfig.presencePenalty) as number | undefined,
        inputKeys: (prompt.input_keys || prompt.inputKeys) as string[] | undefined,
    }
}

/**
 * Transform ApiRevision to AppRevisionData
 * Normalizes the API response to our internal format
 *
 * The backend returns:
 * - config.config_name: string
 * - config.parameters: Record<string, unknown> containing ag_config with prompts
 */
export function transformApiRevision(apiRevision: ApiRevision): AppRevisionData {
    const config = apiRevision.config || {config_name: "", parameters: {}}
    const params = (config.parameters || {}) as Record<string, unknown>
    const prompts: PromptConfig[] = []

    // Extract raw revision parameters for schema-driven approach
    const rawAgConfig = extractRevisionParametersFromApiRevision(apiRevision)

    // Extract prompts from parameters.ag_config (legacy transformed format)
    const agConfig = params.ag_config as Record<string, unknown> | undefined

    if (agConfig) {
        // Check for single prompt
        if (isRecord(agConfig.prompt)) {
            prompts.push(transformPrompt(agConfig.prompt, 0))
        }
        // Check for prompts array
        else if (isArray(agConfig.prompts)) {
            agConfig.prompts.forEach((p, idx) => {
                if (isRecord(p)) {
                    prompts.push(transformPrompt(p, idx))
                }
            })
        }
        // Check for direct messages in ag_config
        else if (agConfig.messages) {
            prompts.push(transformPrompt(agConfig, 0))
        }
    }

    return {
        id: apiRevision.id,
        variantId: "", // Not provided in this endpoint - would need variant lookup
        revision: apiRevision.revision || 1,
        prompts,
        agConfig: rawAgConfig,
        parameters: params,
        createdAt: apiRevision.created_at,
        updatedAt: apiRevision.created_at, // Backend doesn't provide updated_at
    }
}

// REVISION PARAMETER EXTRACTION - using shared utilities from ../../shared/utils/revisionUtils
export {
    extractRevisionParametersFromEnhanced,
    extractRevisionParametersFromApiRevision,
} from "../../shared"

// Deprecated agConfig extraction aliases
export {extractAgConfig as extractAgConfigFromEnhanced} from "../../shared"
export {extractAgConfigFromApiRevision as extractAgConfigFromApi} from "../../shared"

// LIST API FUNCTIONS - types imported from shared/utils/revisionUtils

/**
 * Fetch variants for an app
 *
 * @param appId - The app ID
 * @param projectId - The project ID
 * @returns List of variants transformed to VariantListItem format
 */
export async function fetchVariantsList(
    appId: string,
    projectId: string,
): Promise<VariantListItem[]> {
    if (!projectId || !appId) return []

    const response = await axios.get(`${getAgentaApiUrl()}/apps/${appId}/variants`, {
        params: {project_id: projectId},
    })

    const data = response.data as ApiVariant[] | undefined
    if (!data || !Array.isArray(data)) return []

    return data.map((variant) => transformVariantToListItem(variant, appId))
}

/**
 * Fetch revisions for a variant
 *
 * @param variantId - The variant ID
 * @param projectId - The project ID
 * @returns List of revisions transformed to RevisionListItem format
 */
export async function fetchRevisionsList(
    variantId: string,
    projectId: string,
): Promise<RevisionListItem[]> {
    if (!projectId || !variantId) return []

    const response = await axios.get(`${getAgentaApiUrl()}/variants/${variantId}/revisions`, {
        params: {project_id: projectId},
    })

    const data = response.data as ApiRevisionListItem[] | undefined
    if (!data || !Array.isArray(data)) return []

    return data.map((rev) => transformRevisionToListItem(rev, variantId))
}

// transformAppToListItem imported from shared/utils/revisionUtils

/**
 * Fetch apps list for a project
 *
 * @param projectId - The project ID
 * @returns List of apps transformed to AppListItem format
 */
export async function fetchAppsList(projectId: string): Promise<AppListItem[]> {
    if (!projectId) return []

    try {
        const response = await axios.get(`${getAgentaApiUrl()}/apps`, {
            params: {project_id: projectId},
        })

        const data = response.data as ApiApp[] | undefined
        if (!data || !Array.isArray(data)) return []

        // Filter out legacy custom SDK apps and transform
        return data
            .filter((app) => app.app_type !== "custom (sdk)")
            .map((app) => transformAppToListItem(app))
    } catch (error) {
        console.error("[fetchAppsList] Failed to fetch apps:", error)
        return []
    }
}

// ============================================================================
// REVISION CONFIG API
// ============================================================================

/**
 * Raw API response from /variants/configs/fetch
 *
 * Maps to backend WorkflowRevisionData structure:
 * - params: Configuration parameters (ag_config)
 * - variant_ref: Reference to the variant (id, version)
 * - application_ref: Reference to the application
 * - url: Full URL for the service endpoint
 * - uri: Base URI for the service
 * - headers: Request headers (can include secret references)
 * - schemas: JSON schemas for inputs/outputs
 * - script: Script content for custom workflows
 * - runtime: Runtime environment (python, javascript, typescript)
 * - service: Legacy service configuration
 * - configuration: Legacy configuration object
 */
interface ApiConfigResponse {
    params?: Record<string, unknown>
    variant_ref?: {
        id?: string
        version?: number
    }
    application_ref?: {
        id?: string
    }
    url?: string
    uri?: string
    headers?: Record<string, unknown>
    schemas?: Record<string, unknown>
    script?: Record<string, unknown>
    runtime?: string | null
    // Legacy fields
    service?: Record<string, unknown>
    configuration?: Record<string, unknown>
}

/**
 * Fetch a single revision's configuration by ID
 *
 * Uses the /variants/configs/fetch endpoint which can look up by revision ID.
 *
 * @param revisionId - The revision ID to fetch
 * @param projectId - The project ID
 * @returns AppRevisionData or null if not found
 */
export async function fetchRevisionConfig(
    revisionId: string,
    projectId: string,
): Promise<AppRevisionData | null> {
    if (!revisionId || !projectId) return null

    try {
        const response = await axios.post<ApiConfigResponse>(
            `${getAgentaApiUrl()}/variants/configs/fetch?project_id=${projectId}`,
            {
                variant_ref: {id: revisionId},
            },
        )

        const data = response?.data
        if (!data) return null

        // Transform API response to AppRevisionData format
        const params = data.params || {}
        const variantRef = data.variant_ref || {}
        // Use url field (preferred) or uri field
        const uri = data.url || data.uri || undefined

        // Extract runtime prefix and route path from URI using shared utility
        const uriInfo = parseRevisionUri(uri)
        const runtimePrefix = uriInfo?.runtimePrefix
        const routePath = uriInfo?.routePath

        const appRevisionData: AppRevisionData = {
            id: variantRef.id || revisionId,
            variantId: variantRef.id || "",
            appId: data.application_ref?.id || "",
            revision: variantRef.version || 1,
            prompts: [], // Will be populated from agConfig
            agConfig: params,
            parameters: params,
            // WorkflowServiceConfiguration fields
            uri,
            url: data.url,
            runtimePrefix,
            routePath,
            headers: data.headers as
                | Record<string, string | {id?: string; slug?: string; version?: number}>
                | undefined,
            schemas: data.schemas
                ? {
                      inputs: (data.schemas as Record<string, unknown>).inputs as
                          | Record<string, unknown>
                          | undefined,
                      outputs: (data.schemas as Record<string, unknown>).outputs as
                          | Record<string, unknown>
                          | undefined,
                  }
                : undefined,
            script: data.script,
            runtime: data.runtime,
            // Legacy fields
            service: data.service,
            configuration: data.configuration,
        }

        return appRevisionData
    } catch (error) {
        console.error("[fetchRevisionConfig] Failed to fetch revision", {
            revisionId,
            error,
        })
        return null
    }
}

// ============================================================================
// SCHEMA FETCH API
// ============================================================================

/**
 * Fetch OpenAPI schema from a revision's URI
 *
 * Fetches the OpenAPI spec and dereferences all $ref pointers to produce
 * a fully resolved schema that can be traversed without encountering any refs.
 *
 * @param uri - The base URI of the revision endpoint
 * @returns The dereferenced OpenAPI spec or null if not found
 */
export async function fetchRevisionSchema(
    uri: string | undefined,
    projectId?: string | null,
): Promise<{
    schema: Record<string, unknown> | null
    runtimePrefix: string
    routePath?: string
} | null> {
    if (!uri) return null

    try {
        // Extract runtime prefix and route path from URI
        // URI format: https://runtime.example.com/app-slug/v1
        const url = new URL(uri)
        const runtimePrefix = `${url.protocol}//${url.host}`
        const routePath = url.pathname.replace(/^\//, "").replace(/\/$/, "") || undefined

        // Fetch OpenAPI spec
        const openApiUrl = uri.endsWith("/") ? `${uri}openapi.json` : `${uri}/openapi.json`

        const response = await axios.get<Record<string, unknown>>(openApiUrl, {
            params: projectId ? {project_id: projectId} : undefined,
        })
        const rawSchema = response.data

        if (!rawSchema) {
            return {
                schema: null,
                runtimePrefix,
                routePath,
            }
        }

        // Dereference all $ref pointers in the schema
        // This ensures we have a fully resolved schema without any refs
        const {schema: dereferencedSchema, errors} = await dereferenceSchema(rawSchema)

        if (errors && errors.length > 0) {
            console.warn("[fetchRevisionSchema] Schema dereference warnings:", errors)
        }

        return {
            schema: dereferencedSchema,
            runtimePrefix,
            routePath,
        }
    } catch (error) {
        console.error("[fetchRevisionSchema] Failed to fetch schema", {uri, error})
        return null
    }
}
