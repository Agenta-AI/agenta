import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {_AgentaRootsResponse} from "../types"
import axios from "@/lib/helpers/axiosConfig"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTraces = async ({appId, queries}: {appId: string; queries?: string}) => {
    const filterByAppId = appId
        ? `filtering={"conditions":[{"key":"refs.application.id","operator":"is","value":"${appId}"}]}&`
        : ""

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/observability/v1/traces?${filterByAppId}${queries}`,
    )
    return response.data
}
