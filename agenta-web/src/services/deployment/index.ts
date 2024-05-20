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
    const {data} = await axios(`${getAgentaApiUrl()}/api/apps/${appId}/environments/`)

    return data
}

export const createPublishVariant = async (variantId: string, environmentName: string) => {
    await axios.post(`${getAgentaApiUrl()}/api/environments/deploy/`, {
        environment_name: environmentName,
        variant_id: variantId,
    })
}
