import {Parameter} from "@/lib/Types"
import axios from "@/lib/helpers/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export function restartAppVariantContainer(variantId: string) {
    return axios.post(`${getAgentaApiUrl()}/api/containers/restart_container/`, {
        variant_id: variantId,
    })
}

export async function deleteSingleVariant(variantId: string) {
    await axios.delete(`${getAgentaApiUrl()}/api/variants/${variantId}/`)
}

export async function updateVariantParams(variantId: string, parameters: Parameter[]) {
    await axios.put(`${getAgentaApiUrl()}/api/variants/${variantId}/parameters/`, {
        parameters: parameters.reduce((acc, param) => {
            return {...acc, [param.name]: param.default}
        }, {}),
    })
}

/**
 * Saves a new variant to the database based on previous
 */
export async function createNewVariant(
    baseId: string,
    newVariantName: string,
    newConfigName: string,
    parameters: Parameter[],
) {
    await axios.post(`${getAgentaApiUrl()}/api/variants/from-base/`, {
        base_id: baseId,
        new_variant_name: newVariantName,
        new_config_name: newConfigName,
        parameters: parameters.reduce((acc, param) => {
            return {...acc, [param.name]: param.default}
        }, {}),
    })
}

export const fetchVariantLogs = async (variantId: string, ignoreAxiosError: boolean = false) => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/variants/${variantId}/logs`, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data
}
