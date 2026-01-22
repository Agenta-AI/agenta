/**
 * AppRevision API Functions
 *
 * HTTP functions and data transformers for app revision entity.
 * Includes batch fetching and cache redirect patterns.
 */

import {axios, getAgentaApiUrl, dereferenceSchema} from "@agenta/shared"

import type {AppRevisionData, PromptConfig, RawAgConfig} from "../core"

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
 * Enhanced variant structure (from variant revisions cache)
 */
export interface EnhancedVariantLike {
    id: string
    variantId?: string
    appId?: string
    revision: number | string
    prompts?: unknown[]
    parameters?: Record<string, unknown>
    uri?: string
    uriObject?: {
        routePath?: string
        runtimePrefix?: string
    }
    createdAt?: string
    created_at?: string
    updatedAt?: string
    updated_at?: string
}

/**
 * Batch request for revision fetching
 */
export interface RevisionRequest {
    projectId: string
    revisionId: string
}

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
    const enhancedPrompts = (enhanced.prompts || []) as unknown[]

    enhancedPrompts.forEach((enhancedPrompt: unknown, idx: number) => {
        prompts.push(transformEnhancedPrompt(enhancedPrompt, idx))
    })

    // Also get parameters from the original config if available
    const params = enhanced.parameters || {}

    // Extract raw agConfig for schema-driven approach
    const agConfig = extractAgConfigFromEnhanced(enhanced)

    // Extract URI/runtime info for schema fetching and invocation
    const uri = enhanced.uri
    const uriObject = enhanced.uriObject
    const runtimePrefix = uriObject?.runtimePrefix
    const routePath = uriObject?.routePath

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
        // URI/Runtime info
        uri,
        runtimePrefix,
        routePath,
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
    const messagesContainer = prompt.messages as Record<string, unknown> | undefined
    const messagesArray = (messagesContainer?.value || messagesContainer || []) as unknown[]
    const messages = messagesArray.map((msg: unknown) => {
        const m = msg as Record<string, unknown>
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
    const inputKeysContainer = prompt.inputKeys as Record<string, unknown> | unknown[] | undefined
    const inputKeysRaw = (
        Array.isArray(inputKeysContainer)
            ? inputKeysContainer
            : (inputKeysContainer as Record<string, unknown>)?.value || []
    ) as unknown[]
    const inputKeys = inputKeysRaw.map((k: unknown) => {
        const key = k as Record<string, unknown> | string
        return (typeof key === "object" ? key?.value : key) as string
    })

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
    const llmConfig = (prompt.llm_config || prompt.llmConfig || {}) as Record<string, unknown>

    const messagesRaw = (prompt.messages || []) as unknown[]
    const messages = messagesRaw.map((msg: unknown) => {
        const m = msg as Record<string, unknown>
        return {
            role: (m.role || "user") as "system" | "user" | "assistant" | "tool",
            content: (m.content || "") as string,
            name: m.name as string | undefined,
            tool_call_id: (m.tool_call_id || m.toolCallId) as string | undefined,
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

    // Extract raw ag_config for schema-driven approach
    const rawAgConfig = extractAgConfigFromApi(apiRevision)

    // Extract prompts from parameters.ag_config (legacy transformed format)
    const agConfig = params.ag_config as Record<string, unknown> | undefined

    if (agConfig) {
        // Check for single prompt
        if (agConfig.prompt) {
            prompts.push(transformPrompt(agConfig.prompt as Record<string, unknown>, 0))
        }
        // Check for prompts array
        else if (agConfig.prompts && Array.isArray(agConfig.prompts)) {
            ;(agConfig.prompts as unknown[]).forEach((p: unknown, idx: number) => {
                prompts.push(transformPrompt(p as Record<string, unknown>, idx))
            })
        }
        // Check for direct messages in ag_config
        else if (agConfig.messages) {
            prompts.push(transformPrompt(agConfig as Record<string, unknown>, 0))
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

// ============================================================================
// AG_CONFIG EXTRACTION
// ============================================================================

/**
 * Extract raw ag_config from EnhancedVariant (cache redirect path)
 *
 * The `parameters` field IS the ag_config - it's not nested inside ag_config
 * Structure: enhanced.parameters = { prompt: {...}, llm_config: {...}, ... }
 */
export function extractAgConfigFromEnhanced(enhanced: EnhancedVariantLike): RawAgConfig {
    const parameters = enhanced?.parameters

    if (parameters && typeof parameters === "object" && Object.keys(parameters).length > 0) {
        return parameters
    }

    return {}
}

/**
 * Extract raw ag_config from API revision response
 *
 * API response structure: revision.config.parameters = { prompt: {...}, ... }
 * The `parameters` field IS the ag_config directly.
 */
export function extractAgConfigFromApi(apiRevision: ApiRevision): RawAgConfig {
    // Try multiple paths for the parameters
    const directParams = (apiRevision as unknown as Record<string, unknown>)?.parameters
    const configParams = apiRevision?.config?.parameters

    const parameters = (directParams as RawAgConfig) || configParams || {}

    return parameters as RawAgConfig
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
}

// ============================================================================
// LIST API FUNCTIONS
// ============================================================================

/**
 * Raw variant response from API (snake_case)
 */
export interface ApiVariant {
    variant_id: string
    variant_name: string
    base_id: string
    base_name: string
    app_id: string
    revision?: number
    created_at?: string
    updated_at?: string
}

/**
 * Raw revision list item from API
 */
export interface ApiRevisionListItem {
    id: string
    revision: number
    commit_message?: string
    created_at?: string
    modified_by_id?: string
}

/**
 * Variant list item (camelCase, for selection)
 */
export interface VariantListItem {
    id: string
    name: string
    appId: string
    baseId?: string
    baseName?: string
}

/**
 * Revision list item (camelCase, for selection)
 */
export interface RevisionListItem {
    id: string
    version: number
    variantId: string
    commitMessage?: string
    createdAt?: string
    modifiedById?: string
}

/**
 * App list item (camelCase, for selection)
 * Has index signature for flexibility with additional fields
 */
export interface AppListItem {
    id: string
    name: string
    appType?: string
    [key: string]: unknown
}

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

    return data.map((variant) => ({
        id: variant.variant_id,
        name: variant.variant_name || variant.variant_id,
        appId: variant.app_id || appId,
        baseId: variant.base_id,
        baseName: variant.base_name,
    }))
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

    return data.map((rev) => ({
        id: rev.id,
        version: rev.revision,
        variantId,
        commitMessage: rev.commit_message,
        createdAt: rev.created_at,
        modifiedById: rev.modified_by_id,
    }))
}

/**
 * Transform raw app data (snake_case) to AppListItem (camelCase)
 *
 * @param app - Raw app object with snake_case fields
 * @returns Normalized AppListItem
 */
export function transformAppToListItem(app: {
    app_id?: string
    id?: string
    app_name?: string
    name?: string
    app_type?: string
}): AppListItem {
    return {
        id: app.app_id || app.id || "",
        name: app.app_name || app.name || "",
        appType: app.app_type,
    }
}

/**
 * Raw app response from API (snake_case)
 */
export interface ApiApp {
    app_id: string
    app_name: string
    app_type?: string
    created_at?: string
    updated_at?: string
}

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
        const uri = data.url || undefined

        const appRevisionData: AppRevisionData = {
            id: variantRef.id || revisionId,
            variantId: variantRef.id || "",
            appId: data.application_ref?.id || "",
            revision: variantRef.version || 1,
            prompts: [], // Will be populated from agConfig
            agConfig: params,
            parameters: params,
            uri,
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
export async function fetchRevisionSchema(uri: string | undefined): Promise<{
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

        const response = await axios.get<Record<string, unknown>>(openApiUrl)
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
