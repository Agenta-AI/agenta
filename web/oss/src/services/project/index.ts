import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson, getAuthToken, getBaseUrl} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {ProjectsResponse} from "./types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PATCH data on server
//  - delete: DELETE data from server

export const fetchAllProjects = async (workspaceId?: string): Promise<ProjectsResponse[]> => {
    const token = await getAuthToken()
    if (!token) return []

    const base = getBaseUrl()
    const url = new URL("api/projects", base)
    if (workspaceId) {
        url.searchParams.set("workspace_id", workspaceId)
    }

    try {
        const data = await fetchJson(url)
        return Array.isArray(data) ? data : []
    } catch (error) {
        if ((error as any)?.status === 401) return []
        console.error("Failed to fetch projects", error)
        return []
    }
}

export const fetchProject = async (projectId: string): Promise<ProjectsResponse> => {
    const base = getBaseUrl()
    const url = new URL(`api/projects/${projectId}`, base)
    return await fetchJson(url)
}

export const createProject = async (
    data: {name: string; make_default?: boolean},
    workspaceId?: string,
): Promise<ProjectsResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/projects`, data, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
    return response.data
}

export const patchProject = async (
    projectId: string,
    data: {name?: string; make_default?: boolean},
    workspaceId?: string,
): Promise<ProjectsResponse> => {
    const response = await axios.patch(`${getAgentaApiUrl()}/projects/${projectId}`, data, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
    return response.data
}

export const deleteProject = async (projectId: string, workspaceId?: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/projects/${projectId}`, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
}
