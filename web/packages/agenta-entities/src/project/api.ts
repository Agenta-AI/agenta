import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {ProjectsResponse} from "./types"

/**
 * Projects, in one place.
 *
 * All five calls go through the shared axios instance, which carries auth via its interceptor —
 * the desktop previously split GETs onto a separate fetch client for no behavioural reason, and
 * a package cannot reach that client anyway.
 */

/**
 * Throws like every other call here. It used to answer `[]` for any failure, which hid the 401
 * the auth middleware raises for a `workspace_id` that does not exist — leaving callers unable
 * to tell a missing workspace from an empty one.
 */
export const fetchAllProjects = async (workspaceId?: string): Promise<ProjectsResponse[]> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/projects`, {
        params: workspaceId ? {workspace_id: workspaceId} : undefined,
    })
    // A non-array body is a broken contract, not an empty account. Coercing it to `[]` would read
    // as "this workspace holds no project" and paint a 404 over a workspace that is fine.
    if (!Array.isArray(data)) {
        throw new Error("Malformed /projects response: expected an array")
    }
    return data
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
