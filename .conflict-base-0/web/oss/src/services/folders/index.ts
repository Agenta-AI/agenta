import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

import type {
    FolderCreateRequest,
    FolderEditRequest,
    FolderIdResponse,
    FolderQueryRequest,
    FolderResponse,
    FoldersResponse,
} from "./types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export async function createFolder(payload: FolderCreateRequest): Promise<FolderResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.post(
        `${getAgentaApiUrl()}/folders/?project_id=${projectId}`,
        payload,
    )
    return data as FolderResponse
}

export async function fetchFolder(folderId: string): Promise<FolderResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.get(
        `${getAgentaApiUrl()}/folders/${folderId}?project_id=${projectId}`,
    )
    return data as FolderResponse
}

export async function editFolder(
    folderId: string,
    payload: FolderEditRequest,
): Promise<FolderResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.put(
        `${getAgentaApiUrl()}/folders/${folderId}?project_id=${projectId}`,
        payload,
    )
    return data as FolderResponse
}

export async function deleteFolder(folderId: string): Promise<FolderIdResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.delete(
        `${getAgentaApiUrl()}/folders/${folderId}?project_id=${projectId}`,
    )
    return data as FolderIdResponse
}

export async function queryFolders(
    payload: FolderQueryRequest = {},
    projectIdOverride?: string | null,
): Promise<FoldersResponse> {
    const {projectId} = getProjectValues()
    const effectiveProjectId = projectIdOverride ?? projectId
    if (!effectiveProjectId) {
        throw new Error("[folders] Missing projectId for queryFolders")
    }
    const {data} = await axios.post(
        `${getAgentaApiUrl()}/folders/query?project_id=${effectiveProjectId}`,
        payload,
    )
    return data as FoldersResponse
}
