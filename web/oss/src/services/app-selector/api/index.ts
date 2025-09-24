import Router from "next/router"

import useURL from "@/oss/hooks/useURL"
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
}: {
    appName: string
    templateKey: ServiceType
}) => {
    const {selectedOrg} = getOrgValues()
    const {projectId} = getProjectValues()
    const url = new URL(`${getAgentaApiUrl()}/apps?project_id=${projectId}`)
    const response = await fetchJson(url, {
        method: "POST",
        body: JSON.stringify({
            app_name: appName,
            template_key: templateKey,
            organization_id: selectedOrg?.id,
            workspace_id: selectedOrg?.default_workspace.id,
        }),
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
    // Import the atom-based app creation system
    const {getDefaultStore} = await import("jotai")
    const {createAppMutationAtom} = await import("@/oss/components/Playground/state/atoms")
    const store = getDefaultStore()

    try {
        // Use the atom-based app creation system
        const result = await store.set(createAppMutationAtom, {
            appName,
            templateKey,
            serviceUrl,
            providerKey,
            isCustomWorkflow,
            onStatusChange,
        })

        const baseAppURL = (await waitForValidURL({requireApp: true}))?.baseAppURL
        if (!result.success) {
            // If the atom-based creation failed, propagate the error
            onStatusChange?.("error", new Error(result.error || "App creation failed"))
        } else if (result.appId && result.revisionId) {
            await Router.push({
                pathname: `${baseAppURL}/${result.appId}/playground`,
                query: {
                    revisions: buildRevisionsQueryParam([result.revisionId]),
                },
            })
        } else if (result.appId) {
            // Navigate to the newly created app's playground using Next.js router
            if (typeof window !== "undefined") {
                try {
                    await Router.push(`${baseAppURL}/${result.appId}/playground`)
                } catch (navigationError) {
                    console.error("❌ [createAndStartTemplate] Navigation failed:", navigationError)
                    // Don't fail the entire operation if navigation fails
                }
            }
        }
    } catch (error) {
        // Fallback to original implementation if atom system fails
        console.warn("Atom-based app creation failed, falling back to direct API:", error)
    }
}
