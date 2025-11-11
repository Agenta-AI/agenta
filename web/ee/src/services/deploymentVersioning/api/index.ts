import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {DeploymentRevisionConfig, DeploymentRevisions} from "@/oss/lib/types_ee"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllDeploymentRevisionConfig = async (
    deploymentRevisionId: string,
    signal?: AbortSignal,
    ignoreAxiosError = true,
): Promise<DeploymentRevisionConfig> => {
    const {projectId} = getCurrentProject()

    const {data} = await axios(
        `${getAgentaApiUrl()}/configs/deployment/${deploymentRevisionId}?project_id=${projectId}`,
        {signal, _ignoreError: ignoreAxiosError} as any,
    )

    return data
}

export const fetchAllDeploymentRevisions = async (
    appId: string,
    environmentName: string,
    ignoreAxiosError = false,
): Promise<DeploymentRevisions> => {
    const {projectId} = getCurrentProject()

    const {data} = await axios.get(
        `${getAgentaApiUrl()}/apps/${appId}/revisions/${environmentName}?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return data
}

export const createRevertDeploymentRevision = async (
    deploymentRevisionId: string,
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/configs/deployment/${deploymentRevisionId}/revert?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}
