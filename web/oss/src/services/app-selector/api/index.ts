import {
    createAppFromTemplate,
    AppServiceType,
    type CreateAppFromTemplateResult,
    seedCreatedWorkflowCache,
} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"
import Router from "next/router"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {recentAppIdAtom} from "@/oss/state/app"
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
 * Re-export AppServiceType as ServiceType for backward compatibility.
 * New code should import AppServiceType from @agenta/entities/workflow.
 */
export {AppServiceType as ServiceType}

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

export type AppCreationStatusType =
    | "creating_app"
    | "configuring_app"
    | "success"
    | "bad_request"
    | "timeout"
    | "error"

/**
 * Create a workflow app from a template and navigate to the playground.
 *
 * This is the OSS orchestration wrapper around the entity-layer
 * `createAppFromTemplate`. It handles:
 * - Resolving project/org context
 * - Emitting status callbacks for the progress modal
 * - Navigating to the playground on success
 * - Classifying errors for the UI
 */
export const createAppWithTemplate = async ({
    appName,
    providerKey: _providerKey,
    templateKey,
    serviceUrl,
    folderId,
    isCustomWorkflow = false,
    onStatusChange,
}: {
    appName: string
    templateKey: string
    serviceUrl?: string
    providerKey: LlmProvider[]
    folderId?: string | null
    isCustomWorkflow?: boolean
    onStatusChange?: (status: AppCreationStatusType, details?: any, appId?: string) => void
}) => {
    let result: CreateAppFromTemplateResult | undefined

    try {
        const store = getDefaultStore()
        const {projectId} = getProjectValues()
        const {selectedOrg} = getOrgValues()

        onStatusChange?.("creating_app")

        result = await createAppFromTemplate({
            projectId,
            organizationId: selectedOrg?.id,
            workspaceId: selectedOrg?.default_workspace.id,
            appName,
            templateKey,
            serviceUrl,
            folderId,
            isCustomWorkflow,
            onConfiguring: () => onStatusChange?.("configuring_app"),
        })

        if (result.workflow && result.appId) {
            seedCreatedWorkflowCache({
                appId: result.appId,
                revision: result.workflow,
            })
        }

        if (result.appId) {
            store.set(recentAppIdAtom, result.appId)
        }

        await Promise.resolve(onStatusChange?.("success", undefined, result.appId)).catch(
            (error) => {
                console.error("App creation success callback failed:", error)
            },
        )

        const baseAppURL = (await waitForValidURL({requireProject: true}))?.baseAppURL

        if (result.appId) {
            const query: Record<string, string> = {}
            if (result.revisionId) {
                const revisionsParam = buildRevisionsQueryParam([result.revisionId])
                if (revisionsParam) query.revisions = revisionsParam
            }

            await Router.push({
                pathname: `${baseAppURL}/${result.appId}/playground`,
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
