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
    isLocalDraftId,
    isPlaceholderId,
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
export {extractRevisionParametersFromApiRevision} from "../../shared"

// Deprecated agConfig extraction aliases
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
    if (isLocalDraftId(revisionId) || isPlaceholderId(revisionId)) return null

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
