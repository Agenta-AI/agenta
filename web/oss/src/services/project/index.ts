import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"

import {ProjectsResponse} from "./types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllProjects = async (): Promise<ProjectsResponse[]> => {
    const response = await axios.get(`${getAgentaApiUrl()}/projects`)
    return response.data
}
