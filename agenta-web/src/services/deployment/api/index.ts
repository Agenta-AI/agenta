import {Environment} from "@/lib/Types"
import axios from "@/lib/helpers/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchEnvironments = async (appId: string): Promise<Environment[]> => {
    try {
        const response = await axios.get(`${getAgentaApiUrl()}/api/apps/${appId}/environments/`)
        return response.data
    } catch (error) {
        throw new Error("Failed to fetch environments")
    }
}

export const createPublishVariant = async (variantId: string, environmentName: string) => {
    await axios.post(`${getAgentaApiUrl()}/api/environments/deploy/`, {
        environment_name: environmentName,
        variant_id: variantId,
    })
}
