/**
 * New Apps API Layer
 *
 * Optimized API functions for app management with:
 * - Consistent error handling
 * - Type safety with proper interfaces
 * - Project-scoped operations
 * - API endpoints: /apps and /apps/{appId}
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson, getBaseUrl} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {ListAppsItem} from "@/oss/lib/Types"

import {getProjectId} from "../../utils/projectUtils"

/**
 * Fetch all apps for the current project
 * Used by: App table, app selector
 */
export const fetchProjectApps = async (projectId?: string): Promise<ListAppsItem[]> => {
    const project = projectId || getProjectId()
    if (!project) {
        throw new Error("Project ID is required to fetch apps")
    }

    // Support test mode
    const isTestMode = typeof process !== "undefined" && process.env.VITEST_TEST_API_URL
    const testApiUrl = process.env.VITEST_TEST_API_URL
    const testProjectId = process.env.VITEST_TEST_PROJECT_ID

    console.log("🧪 Apps fetcher debug:", {
        base: isTestMode ? testApiUrl : getBaseUrl(),
        project: isTestMode ? testProjectId : project,
        isTestMode,
    })

    const base = isTestMode ? testApiUrl : getBaseUrl()
    const finalProjectId = isTestMode ? testProjectId : project
    const urlString = `${base}/apps?project_id=${finalProjectId}`
    const url = new URL(urlString)

    console.log("🚀 Calling fetchJson with URL:", url.toString())

    const data = await fetchJson(url)
    console.log("✅ Apps fetcher success:", {count: data?.length || 0})
    return data || []
}

/**
 * Fetch a single app by ID
 * Used by: App selector, app details
 */
export const fetchAppById = async (
    appId: string,
    projectId?: string,
): Promise<ListAppsItem | null> => {
    const project = projectId || getProjectId()
    if (!project) {
        throw new Error("Project ID is required to fetch app")
    }

    const response = await fetch(`${getAgentaApiUrl()}/apps/${appId}?project_id=${project}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
    })

    if (!response.ok) {
        if (response.status === 404) {
            return null // App not found
        }
        throw new Error(`Failed to fetch app: ${response.status} ${response.statusText}`)
    }

    return response.json()
}

/**
 * Create a new app
 * Used by: Create app modal, template creation
 */
export interface CreateAppRequest {
    app_name: string
    app_type?: string
    project_id?: string
}

export const createApp = async (request: CreateAppRequest): Promise<ListAppsItem> => {
    const project = request.project_id || getProjectId()
    if (!project) {
        throw new Error("Project ID is required to create app")
    }

    const payload = {
        ...request,
        project_id: project,
    }

    const response = await axios.post(`${getAgentaApiUrl()}/apps`, payload)

    return response.data
}

/**
 * Delete an app
 * Used by: Delete app modal
 */
export const deleteApp = async (appId: string, projectId?: string): Promise<void> => {
    const project = projectId || getProjectId()
    if (!project) {
        throw new Error("Project ID is required to delete app")
    }

    const response = await fetch(`${getAgentaApiUrl()}/apps/${appId}?project_id=${project}`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
        },
    })

    if (!response.ok) {
        throw new Error(`Failed to delete app: ${response.status} ${response.statusText}`)
    }
}

/**
 * Update an app
 * Used by: Edit app modal
 */
export interface UpdateAppRequest {
    app_name?: string
    app_type?: string
}

export const updateApp = async (
    appId: string,
    request: UpdateAppRequest,
    projectId?: string,
): Promise<ListAppsItem> => {
    const project = projectId || getProjectId()
    if (!project) {
        throw new Error("Project ID is required to update app")
    }

    const response = await fetch(`${getAgentaApiUrl()}/apps/${appId}?project_id=${project}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
    })

    if (!response.ok) {
        throw new Error(`Failed to update app: ${response.status} ${response.statusText}`)
    }

    return response.json()
}
