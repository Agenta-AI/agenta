// @ts-nocheck
import {getOrgValues} from "@/oss/contexts/org.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {
    fetchOpenApiSchemaJson,
    findCustomWorkflowPath,
    setVariant,
    transformVariant,
} from "@/oss/lib/shared/variant"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {AppTemplate} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTemplates = async () => {
    const {projectId} = getCurrentProject()
    const response = await axios.get(
        `${getAgentaApiUrl()}/containers/templates?project_id=${projectId}`,
    )
    return response.data
}

export async function deleteApp(appId: string) {
    const {projectId} = getCurrentProject()

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
}: {
    appName: string
    templateKey: ServiceType
}) => {
    const {selectedOrg} = getOrgValues()
    const {projectId} = getCurrentProject()
    const response = await axios.post(`${getAgentaApiUrl()}/apps?project_id=${projectId}`, {
        app_name: appName,
        template_key: templateKey,
        organization_id: selectedOrg?.id,
        workspace_id: selectedOrg?.default_workspace.id,
    })
    return response.data
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

    const {projectId} = getCurrentProject()

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
    const {projectId} = getCurrentProject()
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
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/apps/app_and_variant_from_template?project_id=${projectId}`,
        templateObj,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateAppName = async (appId: string, appName: string, ignoreAxiosError = false) => {
    const {projectId} = getCurrentProject()

    const response = await axios.patch(
        `${getAgentaApiUrl()}/apps/${appId}?project_id=${projectId}`,
        {app_name: appName},
        {_ignoreError: ignoreAxiosError} as any,
    )

    return response.data
}

export const createAndStartTemplate = async ({
    appName,
    providerKey,
    templateKey,
    serviceUrl,
    isCustomWorkflow = false,
    onStatusChange,
}: {
    appName: string
    templateKey: ServiceType
    serviceUrl?: string
    providerKey: LlmProvider[]
    isCustomWorkflow?: boolean
    onStatusChange?: (
        status: "creating_app" | "starting_app" | "success" | "bad_request" | "timeout" | "error",
        details?: any,
        appId?: string,
    ) => void
}) => {
    try {
        onStatusChange?.("creating_app")
        let app
        try {
            app = await createApp({
                appName,
                templateKey,
            })
            let _variant
            if (templateKey === ServiceType.Custom && serviceUrl) {
                _variant = await createVariant({
                    appId: app.app_id,
                    serviceUrl,
                    isCustomWorkflow,
                })
            } else {
                _variant = await createVariant({
                    appId: app.app_id,
                    templateKey,
                })
            }
            const uri = await findCustomWorkflowPath(_variant.uri)
            const {schema} = await fetchOpenApiSchemaJson(uri?.runtimePrefix)

            if (!schema) {
                throw new Error("No schema found")
            }

            // TODO: HANDLE NEW UPDATE -> NEW REVISION MOUNT
            const variant = transformVariant(setVariant(_variant, uri), schema, _variant.appType)

            const parameters = transformToRequestBody({
                variant,
                allMetadata: getAllMetadata(),
                routePath: uri.routePath,
            })

            // Exclude system_prompt and user_prompt keys
            if (parameters?.ag_config) {
                for (const key in parameters.ag_config) {
                    if (typeof parameters.ag_config[key] === "object") {
                        delete parameters.ag_config[key].system_prompt
                        delete parameters.ag_config[key].user_prompt
                    }
                }
            }

            await axios.put(
                `/api/variants/${variant.id}/parameters?project_id=${getCurrentProject().projectId}`,
                {
                    parameters: parameters.ag_config,
                },
            )

            onStatusChange?.("success", "", app?.app_id)
        } catch (error: any) {
            if (error?.response?.status === 400) {
                onStatusChange?.("bad_request", error)
                return
            }
            throw error
        }
    } catch (error) {
        onStatusChange?.("error", error)
    }
}
