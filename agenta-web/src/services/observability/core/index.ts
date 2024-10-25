import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {_AgentaRootsResponse} from "../types"
import axios from "@/lib/helpers/axiosConfig"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

const PROJECT_ID = "019233b0-2967-76c0-bde2-f5b78b3a9a04"

export const fetchAllTraces = async () => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/observability/v1/traces/search?project_id=${PROJECT_ID}`,
    )
    return response.data
}
