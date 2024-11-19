import axios from "@/lib/helpers/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetcAllProjects = async () => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/projects`)
    return response.data
}
