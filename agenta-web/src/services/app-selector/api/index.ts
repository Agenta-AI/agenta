import {AppTemplate} from "@/lib/Types"
import axios from "@/lib/helpers/axiosConfig"
import {dynamicContext} from "@/lib/helpers/dynamic"
import {LlmProvider} from "@/lib/helpers/llmProviders"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {waitForAppToStart} from "@/services/api"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTemplates = async () => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/containers/templates/`)
    return response.data
}

export async function deleteApp(appId: string) {
    await axios.delete(`${getAgentaApiUrl()}/api/apps/${appId}/`, {
        data: {app_id: appId},
    })
}

export const createAppFromTemplate = async (
    templateObj: AppTemplate,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/api/apps/app_and_variant_from_template/`,
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
    const response = await axios.patch(
        `${getAgentaApiUrl()}/api/apps/${appId}`,
        {app_name: appName},
        {_ignoreError: ignoreAxiosError} as any,
    )

    return response.data
}

export const createAndStartTemplate = async ({
    appName,
    providerKey,
    templateId,
    timeout,
    onStatusChange,
}: {
    appName: string
    providerKey: Array<LlmProvider>
    templateId: string
    timeout?: number
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
        const {getOrgValues} = await dynamicContext("org.context", {
            getOrgValues: () => ({
                selectedOrg: {id: undefined, default_workspace: {id: undefined}},
            }),
        })
        const {selectedOrg} = getOrgValues()
        onStatusChange?.("creating_app")
        let app
        try {
            app = await createAppFromTemplate(
                {
                    app_name: appName,
                    template_id: templateId,
                    organization_id: selectedOrg.id,
                    workspace_id: selectedOrg.default_workspace.id,
                    env_vars: apiKeys,
                },
                true,
            )
        } catch (error: any) {
            if (error?.response?.status === 400) {
                onStatusChange?.("bad_request", error)
                return
            }
            throw error
        }

        onStatusChange?.("starting_app", "", app?.data?.app_id)
        try {
            const {promise} = await waitForAppToStart({appId: app?.data?.app_id, timeout})
            await promise
        } catch (error: any) {
            if (error.message === "timeout") {
                onStatusChange?.("timeout", "", app?.data?.app_id)
                return
            }
            throw error
        }

        onStatusChange?.("success", "", app?.data?.app_id)
    } catch (error) {
        onStatusChange?.("error", error)
    }
}
