import {fetchRevisionSchema} from "@agenta/entities/legacyAppRevision"
import Router from "next/router"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {AppTemplate} from "@/oss/lib/Types"
import {getOrgValues} from "@/oss/state/org"
import {getProjectValues} from "@/oss/state/project"
import {waitForValidURL} from "@/oss/state/url"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTemplates = async () => {
    const {projectId} = getProjectValues()
    const url = new URL(`${getAgentaApiUrl()}/containers/templates?project_id=${projectId}`)
    const response = await fetchJson(url)
    return response
}

export async function deleteApp(appId: string) {
    const {projectId} = getProjectValues()

    await axios.delete(`${getAgentaApiUrl()}/apps/${appId}?project_id=${projectId}`, {
        data: {app_id: appId},
    })
}

/**
 * New function to create an app according to
 * backend changes which can be checked at
 * agenta-backend/tests/variants-from-service-url.http
 * agenta-backend/tests/variants-from-template-key.http
 * @returns
 */
export enum ServiceType {
    Completion = "SERVICE:completion",
    Chat = "SERVICE:chat",
    Custom = "CUSTOM",
}
export const createApp = async ({
    templateKey,
    appName,
    folderId,
}: {
    appName: string
    templateKey: ServiceType
    folderId?: string | null
}) => {
    const {selectedOrg} = getOrgValues()
    const {projectId} = getProjectValues()
    const url = new URL(`${getAgentaApiUrl()}/apps?project_id=${projectId}`)
    const payload: Record<string, unknown> = {
        app_name: appName,
        template_key: templateKey,
        organization_id: selectedOrg?.id,
        workspace_id: selectedOrg?.default_workspace.id,
    }
    if (folderId !== undefined) payload.folder_id = folderId

    const response = await fetchJson(url, {
        method: "POST",
        body: JSON.stringify(payload),
    })
    return response
}

export const createVariant = async ({
    appId,
    variantName = "default",
    baseName = "app",
    templateKey,
    serviceUrl,
    isCustomWorkflow = false,
}: {
    appId: string
    variantName?: string
    baseName?: string
    templateKey?: ServiceType
    serviceUrl?: string
    isCustomWorkflow?: boolean
}) => {
    interface CreateVariantRequestBody {
        config_name: string
        variant_name: string
        base_name: string
        key?: ServiceType
        url?: string
    }
    /**
     * this functions utilizes either serviceUrl or templateKey
     */
    // check for correct usage of serviceUrl and templateKey
    if (serviceUrl && templateKey) {
        throw new Error("Either serviceUrl or templateKey should be provided")
    } else if (!serviceUrl && !templateKey) {
        throw new Error("Either serviceUrl or templateKey should be provided")
    }

    const {projectId} = getProjectValues()

    const endpoint = `${getAgentaApiUrl()}/apps/${appId}/variant/${
        serviceUrl ? "from-service" : "from-template"
    }?project_id=${projectId}`

    const body: CreateVariantRequestBody = {
        variant_name: variantName,
        base_name: baseName,
    } as CreateVariantRequestBody

    if (isCustomWorkflow) {
        body.config_name = variantName
        body.url = serviceUrl
    } else if (serviceUrl) {
        body.config_name = "url"
        body.url = serviceUrl
    } else if (templateKey) {
        body.config_name = variantName
        body.key = templateKey
    }

    const response = await axios.post(endpoint, body)
    return response.data
}

export const updateVariant = async (
    {serviceUrl, variantId}: {serviceUrl: string; variantId: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()
    const response = await axios.put(
        `${getAgentaApiUrl()}/variants/${variantId}/service?project_id=${projectId}`,
        {
            url: serviceUrl,
            variant_id: variantId,
        },
        {_ignoreError: ignoreAxiosError} as any,
    )

    return response.data
}

export const createAppFromTemplate = async (templateObj: AppTemplate, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/apps/app_and_variant_from_template?project_id=${projectId}`,
        templateObj,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateAppName = async (appId: string, appName: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.patch(
        `${getAgentaApiUrl()}/apps/${appId}?project_id=${projectId}`,
        {app_name: appName},
        {_ignoreError: ignoreAxiosError} as any,
    )

    return response.data
}

export const updateAppFolder = async (
    appId: string,
    folderId: string | null,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.patch(
        `${getAgentaApiUrl()}/apps/${appId}?project_id=${projectId}`,
        {id: appId, folder_id: folderId},
        {_ignoreError: ignoreAxiosError} as any,
    )

    return response.data
}

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

        // Try with routePath first, then without (spec may omit the prefix)
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

export const createAndStartTemplate = async ({
    appName,
    providerKey: _providerKey,
    templateKey,
    serviceUrl,
    folderId,
    isCustomWorkflow = false,
    onStatusChange,
}: {
    appName: string
    templateKey: ServiceType
    serviceUrl?: string
    providerKey: LlmProvider[]
    folderId?: string | null
    isCustomWorkflow?: boolean
    onStatusChange?: (
        status: "creating_app" | "starting_app" | "success" | "bad_request" | "timeout" | "error",
        details?: any,
        appId?: string,
    ) => void
}) => {
    try {
        onStatusChange?.("creating_app")

        const app = await createApp({
            appName,
            templateKey,
            folderId,
        })

        onStatusChange?.("starting_app")

        const variant = await (async () => {
            if (templateKey === ServiceType.Custom && serviceUrl) {
                return createVariant({
                    appId: app.app_id,
                    serviceUrl,
                    isCustomWorkflow,
                })
            }
            return createVariant({
                appId: app.app_id,
                templateKey,
            })
        })()

        // Auto-commit v1 with schema-derived default parameters
        const {projectId} = getProjectValues()
        let revisionId: string | undefined

        const uri = variant?.uri as string | undefined
        const variantId = variant?.variant_id as string | undefined

        if (uri && variantId && projectId) {
            try {
                const schemaResult = await fetchRevisionSchema(uri, projectId)

                const defaultParams = schemaResult?.schema
                    ? extractDefaultParameters(
                          schemaResult.schema as Record<string, unknown>,
                          schemaResult.routePath,
                      )
                    : {}

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
                console.warn("[createAndStartTemplate] Failed to auto-commit v1:", schemaError)
            }
        }

        onStatusChange?.("success", undefined, app.app_id)

        const baseAppURL = (await waitForValidURL({requireApp: true}))?.baseAppURL

        if (app?.app_id) {
            const query: Record<string, string> = {}
            if (revisionId) {
                const revisionsParam = buildRevisionsQueryParam([revisionId])
                if (revisionsParam) query.revisions = revisionsParam
            }

            await Router.push({
                pathname: `${baseAppURL}/${app.app_id}/playground`,
                query,
            })
        }
    } catch (error: any) {
        if (error?.status === 400 || error?.response?.status === 400) {
            onStatusChange?.("bad_request", error)
            return
        }
        if (error?.status === 403 || error?.response?.status === 403) {
            onStatusChange?.("error", error)
            return
        }
        if (error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) {
            onStatusChange?.("timeout", error)
            return
        }
        onStatusChange?.("error", error)
    }
}
