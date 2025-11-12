import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

// versioning
export const fetchAllPromptVersioning = async (variantId: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const {data} = await axios.get(
        `${getAgentaApiUrl()}/variants/${variantId}/revisions?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )

    return data
}

export const fetchPromptRevision = async (
    variantId: string,
    revisionNumber: number,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const {data} = await axios.get(
        `${getAgentaApiUrl()}/variants/${variantId}/revisions/${revisionNumber}?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )

    return data
}
