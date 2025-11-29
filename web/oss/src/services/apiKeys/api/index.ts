import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllListApiKeys = (workspaceId: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    return axios.get(
        `${getAgentaApiUrl()}/keys/?workspace_id=${workspaceId}&project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
}

export const createApiKey = (
    workspaceId: string,
    ignoreAxiosError = false,
    projectId?: string | null,
) => {
    const {projectId: storeProjectId} = getProjectValues()
    const finalProjectId = projectId ?? storeProjectId

    return axios.post(
        `${getAgentaApiUrl()}/keys?workspace_id=${workspaceId}&project_id=${finalProjectId}`,
        undefined,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
}

export const deleteApiKey = (prefix: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    return axios.delete(`${getAgentaApiUrl()}/keys/${prefix}?project_id=${projectId}`, {
        _ignoreError: ignoreAxiosError,
    } as any)
}
