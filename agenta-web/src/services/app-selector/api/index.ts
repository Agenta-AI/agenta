import {getOrgValues} from "@/contexts/org.context"
import {getCurrentProject} from "@/contexts/project.context"
import {AppTemplate} from "@/lib/Types"
import axios from "@/lib/api/assets/axiosConfig"
import {LlmProvider} from "@/lib/helpers/llmProviders"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {
    fetchOpenApiSchemaJson,
    setVariant,
    transformVariant,
} from "@/lib/hooks/useStatelessVariant/assets/helpers"
import {transformToRequestBody} from "@/lib/hooks/useStatelessVariant/assets/transformer/reverseTransformer"
import {getAllMetadata} from "@/lib/hooks/useStatelessVariant/state"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTemplates = async () => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/containers/templates`)
    return response.data
}

export async function deleteApp(appId: string) {
    const {projectId} = getCurrentProject()

    await axios.delete(`${getAgentaApiUrl()}/api/apps/${appId}?project_id=${projectId}`, {
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
    const response = await axios.post(`${getAgentaApiUrl()}/api/apps?project_id=${projectId}`, {
        app_name: appName,
        template_key: templateKey,
        organization_id: selectedOrg?.id,
        workspace_id: selectedOrg?.default_workspace.id,
    })
    return response.data
}

export const createVariant = async ({
    appId,
    variantName = "app.key",
    baseName = "app",
    templateKey,
    serviceUrl,
}: {
    appId: string
    variantName?: string
    baseName?: string
    templateKey?: ServiceType
    serviceUrl?: string
}) => {
    type CreateVariantRequestBody = {
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

    const endpoint = `${getAgentaApiUrl()}/api/apps/${appId}/variant/${
        serviceUrl ? "from-service" : "from-template"
    }`

    const body: CreateVariantRequestBody = {
        variant_name: variantName,
        base_name: baseName,
    } as CreateVariantRequestBody

    if (!!serviceUrl) {
        body.config_name = "url"
        body.url = serviceUrl
    } else if (!!templateKey) {
        body.config_name = "key"
        body.key = templateKey
    }

    const response = await axios.post(endpoint, body)
    return response.data
}

export const createAppFromTemplate = async (
    templateObj: AppTemplate,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/apps/app_and_variant_from_template?project_id=${projectId}`,
        templateObj,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateAppName = async (
    appId: string,
    appName: string,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.patch(
        `${getAgentaApiUrl()}/api/apps/${appId}?project_id=${projectId}`,
        {app_name: appName},
        {_ignoreError: ignoreAxiosError} as any,
    )

    return response.data
}

export const createAndStartTemplate = async ({
    appName,
    providerKey,
    templateKey,
    onStatusChange,
}: {
    appName: string
    templateKey: ServiceType
    providerKey: Array<LlmProvider>
    onStatusChange?: (
        status: "creating_app" | "starting_app" | "success" | "bad_request" | "timeout" | "error",
        details?: any,
        appId?: string,
    ) => void
}) => {
    const apiKeys = providerKey.reduce(
        (acc, {key, name}) => {
            if (key) acc[name] = key
            return acc
        },
        {} as Record<string, string>,
    )

    try {
        onStatusChange?.("creating_app")
        let app
        try {
            app = await createApp({
                appName,
                templateKey,
            })
            const _variant = await createVariant({
                appId: app.app_id,
                templateKey,
            })
            const {schema} = await fetchOpenApiSchemaJson(_variant.uri)

            if (!schema) {
                throw new Error("No schema found")
            }

            const variant = transformVariant(setVariant(_variant), schema)

            const parameters = transformToRequestBody(variant, undefined, getAllMetadata())
            await axios.put(
                `/api/variants/${variant.id}/parameters?project_id=${getCurrentProject().projectId}`,
                {
                    parameters,
                },
            )
        } catch (error: any) {
            if (error?.response?.status === 400) {
                onStatusChange?.("bad_request", error)
                return
            }
            throw error
        } finally {
            onStatusChange?.("success", "", app?.app_id)
        }
    } catch (error) {
        onStatusChange?.("error", error)
    }
}
