/**
 * Create a workflow app from a template or service URL.
 *
 * This encapsulates the core creation logic:
 * 1. Create the app (via legacy POST /apps)
 * 2. Create the variant (via legacy POST /apps/{id}/variant/from-template|from-service)
 * 3. Probe the schema, extract defaults, and auto-commit v1
 *
 * The legacy endpoints are used because the workflow API doesn't yet handle
 * template_key → URI resolution. Once the backend exposes this through
 * workflow endpoints, this function can be migrated to use them.
 *
 * This function is framework-agnostic (no Router, no Jotai) — the caller
 * handles navigation and UI status updates.
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {extractVariablesFromConfig} from "../../runnable/utils"
import {fetchRevisionSchemaWithProbe} from "../../shared/openapi"

// ============================================================================
// Types
// ============================================================================

export enum AppServiceType {
    Completion = "SERVICE:completion",
    Chat = "SERVICE:chat",
    Custom = "CUSTOM",
}

export interface CreateAppFromTemplateParams {
    projectId: string
    organizationId?: string
    workspaceId?: string
    appName: string
    templateKey: AppServiceType
    serviceUrl?: string
    folderId?: string | null
    isCustomWorkflow?: boolean
    /** Called after the app is created and before variant configuration begins */
    onConfiguring?: () => void
}

export interface CreateAppFromTemplateResult {
    appId: string
    revisionId?: string
}

// ============================================================================
// Schema extraction helpers
// ============================================================================

/**
 * Extract default parameters from a dereferenced OpenAPI spec's ag_config schema.
 * Tries endpoints in priority order and returns the first set of defaults found.
 */
function extractDefaultParameters(
    spec: Record<string, unknown>,
    routePath?: string,
): Record<string, unknown> {
    const paths = spec?.paths as Record<string, unknown> | undefined
    if (!paths) return {}

    const endpointNames = ["/test", "/run", "/generate", "/generate_deployed", "/"]

    for (const endpoint of endpointNames) {
        const endpointName = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint
        const withRoute = routePath ? `/${routePath.replace(/^\/|\/$/g, "")}/${endpointName}` : null
        const withoutRoute = `/${endpointName}`

        const fullPath =
            (withRoute && paths[withRoute] ? withRoute : null) ||
            (paths[withoutRoute] ? withoutRoute : null)

        if (!fullPath) continue

        const pathObj = paths[fullPath] as Record<string, unknown>
        const postOp = pathObj?.post as Record<string, unknown> | undefined
        const requestBody = postOp?.requestBody as Record<string, unknown> | undefined
        const content = requestBody?.content as Record<string, unknown> | undefined
        const jsonContent = content?.["application/json"] as Record<string, unknown> | undefined
        const schema = jsonContent?.schema as Record<string, unknown> | undefined
        const properties = schema?.properties as Record<string, unknown> | undefined
        const agConfig = properties?.ag_config as Record<string, unknown> | undefined

        if (!agConfig) continue

        // Prefer top-level default (Pydantic BaseModel emits this)
        if (agConfig.default && typeof agConfig.default === "object") {
            return agConfig.default as Record<string, unknown>
        }

        // Fallback: collect individual property defaults
        const agProps = agConfig.properties as Record<string, Record<string, unknown>> | undefined
        if (!agProps) {
            // Check for allOf wrapping (Pydantic v2 pattern)
            const allOf = agConfig.allOf as Record<string, unknown>[] | undefined
            if (allOf) {
                for (const branch of allOf) {
                    const branchProps = branch?.properties as
                        | Record<string, Record<string, unknown>>
                        | undefined
                    if (branchProps) {
                        const defaults: Record<string, unknown> = {}
                        for (const [key, prop] of Object.entries(branchProps)) {
                            if (prop?.default !== undefined) {
                                defaults[key] = prop.default
                            }
                        }
                        if (Object.keys(defaults).length > 0) return defaults
                    }
                }
            }
            continue
        }

        const defaults: Record<string, unknown> = {}
        for (const [key, prop] of Object.entries(agProps)) {
            if (prop?.default !== undefined) {
                defaults[key] = prop.default
            }
        }
        if (Object.keys(defaults).length > 0) return defaults
    }

    return {}
}

/**
 * Clean up raw Pydantic defaults extracted from the OpenAPI schema.
 *
 * The `PromptTemplate` Pydantic model includes legacy fields (`system_prompt`,
 * `user_prompt`) and optional fields (`tools`) that may be absent from the
 * serialized default but are expected in the commit payload.
 *
 * This function:
 *  1. Removes `system_prompt` and `user_prompt` from each prompt config
 *  2. Ensures `llm_config.tools` is `[]` when absent/null
 *  3. Extracts `input_keys` from message templates and adds them
 */
function cleanupDefaultParameters(params: Record<string, unknown>): Record<string, unknown> {
    const cleaned = {...params}

    for (const [key, value] of Object.entries(cleaned)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const config = value as Record<string, unknown>

        const hasMessages = Array.isArray(config.messages)
        const hasLlmConfig = config.llm_config && typeof config.llm_config === "object"

        if (!hasMessages && !hasLlmConfig) continue

        // 1. Remove legacy fields
        delete config.system_prompt
        delete config.user_prompt

        // 2. Ensure llm_config.tools is an empty array when absent/null
        if (hasLlmConfig) {
            const llmConfig = config.llm_config as Record<string, unknown>
            if (!Array.isArray(llmConfig.tools)) {
                llmConfig.tools = []
            }
        }

        // 3. Extract input_keys from message templates
        if (hasMessages && !config.input_keys) {
            const variables = extractVariablesFromConfig({[key]: config})
            if (variables.length > 0) {
                config.input_keys = variables
            }
        }
    }

    return cleaned
}

// ============================================================================
// Core creation function
// ============================================================================

/**
 * Create a workflow app from a template or service URL.
 *
 * Steps:
 * 1. Create the app via legacy `POST /apps`
 * 2. Create the variant via legacy `POST /apps/{id}/variant/from-template|from-service`
 * 3. Probe the OpenAPI schema, extract defaults, and auto-commit v1
 *
 * @returns `{ appId, revisionId? }` — revisionId is set when auto-commit succeeds
 * @throws On app creation or variant creation failure
 */
export async function createAppFromTemplate({
    projectId,
    organizationId,
    workspaceId,
    appName,
    templateKey,
    serviceUrl,
    folderId,
    isCustomWorkflow = false,
    onConfiguring,
}: CreateAppFromTemplateParams): Promise<CreateAppFromTemplateResult> {
    // Step 1: Create the app
    const appPayload: Record<string, unknown> = {
        app_name: appName,
        template_key: templateKey,
        organization_id: organizationId,
        workspace_id: workspaceId,
    }
    if (folderId !== undefined) appPayload.folder_id = folderId

    const appResponse = await axios.post(`${getAgentaApiUrl()}/apps`, appPayload, {
        params: {project_id: projectId},
    })
    const appId = appResponse.data?.app_id as string
    if (!appId) {
        throw new Error("[createAppFromTemplate] No app_id in response")
    }

    onConfiguring?.()

    // Step 2: Create the variant
    interface VariantRequestBody {
        config_name: string
        variant_name: string
        base_name: string
        key?: AppServiceType
        url?: string
    }

    const variantBody: VariantRequestBody = {
        variant_name: "default",
        base_name: "app",
    } as VariantRequestBody

    if (isCustomWorkflow) {
        variantBody.config_name = "default"
        variantBody.url = serviceUrl
    } else if (templateKey === AppServiceType.Custom && serviceUrl) {
        variantBody.config_name = "url"
        variantBody.url = serviceUrl
    } else {
        variantBody.config_name = "default"
        variantBody.key = templateKey
    }

    const variantEndpoint = serviceUrl ? "from-service" : "from-template"
    const variantResponse = await axios.post(
        `${getAgentaApiUrl()}/apps/${appId}/variant/${variantEndpoint}`,
        variantBody,
        {params: {project_id: projectId}},
    )
    const variant = variantResponse.data

    // Step 3: Auto-commit v1 with schema-derived default parameters
    let revisionId: string | undefined

    const uri = variant?.uri as string | undefined
    const variantId = variant?.variant_id as string | undefined

    if (uri && variantId) {
        try {
            const schemaResult = await fetchRevisionSchemaWithProbe(uri, projectId)

            const rawParams = schemaResult?.schema
                ? extractDefaultParameters(
                      schemaResult.schema as Record<string, unknown>,
                      schemaResult.routePath,
                  )
                : {}

            const defaultParams = cleanupDefaultParameters(rawParams)

            const commitResponse = await axios.put(
                `${getAgentaApiUrl()}/variants/${variantId}/parameters`,
                {
                    parameters: defaultParams,
                    commit_message: "Initial commit with default parameters",
                },
                {params: {project_id: projectId}},
            )

            revisionId = commitResponse.data?.id
        } catch (schemaError) {
            console.warn("[createAppFromTemplate] Failed to auto-commit v1:", schemaError)
        }
    }

    return {appId, revisionId}
}
