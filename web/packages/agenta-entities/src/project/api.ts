import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {ProjectsResponse} from "./types"

/**
 * Projects, in one place.
 *
 * All five calls go through the shared axios instance, which carries auth via its interceptor —
 * the desktop previously split GETs onto a separate fetch client for no behavioural reason, and
 * a package cannot reach that client anyway. `fetchAllProjects` still answers `[]` rather than
 * throwing when the caller is not signed in, which is what its consumers expect.
 */
export const fetchAllProjects = async (workspaceId?: string): Promise<ProjectsResponse[]> => {
    try {
        const {data} = await axios.get(`${getAgentaApiUrl()}/projects`, {
            params: workspaceId ? {workspace_id: workspaceId} : undefined,
        })
        return Array.isArray(data) ? data : []
    } catch (error) {
        if ((error as {response?: {status?: number}})?.response?.status === 401) return []
        console.error("Failed to fetch projects", error)
        return []
    }
}

export const fetchProject = async (projectId: string): Promise<ProjectsResponse> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/projects/${projectId}`)
    return data
}

export const createProject = async (
    payload: {name: string; make_default?: boolean},
    workspaceId?: string,
): Promise<ProjectsResponse> => {
    const {data} = await axios.post(`${getAgentaApiUrl()}/projects`, payload, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
    return data
}

export const patchProject = async (
    projectId: string,
    payload: {name?: string; make_default?: boolean},
    workspaceId?: string,
): Promise<ProjectsResponse> => {
    const {data} = await axios.patch(`${getAgentaApiUrl()}/projects/${projectId}`, payload, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
    return data
}

export const deleteProject = async (projectId: string, workspaceId?: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/projects/${projectId}`, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
}
