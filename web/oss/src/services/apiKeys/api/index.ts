import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllListApiKeys = (workspaceId: string, ignoreAxiosError = false) => {
    const {projectId} = getCurrentProject()

    return axios.get(
        `${getAgentaApiUrl()}/api/keys/?workspace_id=${workspaceId}&project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
}

export const createApiKey = (workspaceId: string, ignoreAxiosError = false) => {
    const {projectId} = getCurrentProject()

    return axios.post(
        `${getAgentaApiUrl()}/api/keys?workspace_id=${workspaceId}&project_id=${projectId}`,
        undefined,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
}

export const deleteApiKey = (prefix: string, ignoreAxiosError = false) => {
    const {projectId} = getCurrentProject()

    return axios.delete(`${getAgentaApiUrl()}/api/keys/${prefix}?project_id=${projectId}`, {
        _ignoreError: ignoreAxiosError,
    } as any)
}
