import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {_AgentaRootsResponse} from "../types"
import axios from "@/lib/helpers/axiosConfig"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTraces = async (params = {}) => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/observability/v1/traces`, {params})
    return response.data
}

export const deleteTrace = async (nodeId: string) => {
    return axios.delete(`${getAgentaApiUrl()}/api/observability/v1/traces?node_id=${nodeId}`)
}
