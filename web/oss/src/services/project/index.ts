import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson, getBaseUrl} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {ProjectsResponse} from "./types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PATCH data on server
//  - delete: DELETE data from server

export const fetchAllProjects = async (): Promise<ProjectsResponse[]> => {
    const base = getBaseUrl()
    const url = new URL("api/projects", base)

    try {
        const data = await fetchJson(url)
        return Array.isArray(data) ? data : []
    } catch (error) {
        console.error("Failed to fetch projects", error)
        return []
    }
}

export const fetchProject = async (projectId: string): Promise<ProjectsResponse> => {
    const base = getBaseUrl()
    const url = new URL(`api/projects/${projectId}`, base)
    return await fetchJson(url)
}

export const createProject = async (data: {
    name: string
    make_default?: boolean
}): Promise<ProjectsResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/projects`, data)
    return response.data
}

export const patchProject = async (
    projectId: string,
    data: {
        name?: string
        make_default?: boolean
    },
): Promise<ProjectsResponse> => {
    const response = await axios.patch(`${getAgentaApiUrl()}/projects/${projectId}`, data)
    return response.data
}

export const deleteProject = async (projectId: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/projects/${projectId}`)
}
