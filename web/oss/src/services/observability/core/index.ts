import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTraces = async (params = {}, appId?: string) => {
    const {projectId} = getCurrentProject()

    const url = new URL(`${getAgentaApiUrl()}/observability/v1/traces`)
    url.searchParams.set("project_id", projectId)

    if (appId) {
        url.searchParams.set("application_id", appId)
    }

    const response = await axios.get(url.toString(), {params})
    return response.data
}

export const deleteTrace = async (nodeId: string) => {
    const {projectId} = getCurrentProject()

    return axios.delete(
        `${getAgentaApiUrl()}/observability/v1/traces?project_id=${projectId}&node_id=${nodeId}`,
    )
}
