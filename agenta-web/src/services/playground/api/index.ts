import {getCurrentProject} from "@/contexts/project.context"
import {Parameter} from "@/lib/Types"
import axios from "@/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export function restartAppVariantContainer(variantId: string) {
    const {projectId} = getCurrentProject()

    return axios.post(
        `${getAgentaApiUrl()}/api/containers/restart_container?project_id=${projectId}`,
        {
            variant_id: variantId,
        },
    )
}

export async function deleteSingleVariant(variantId: string) {
    const {projectId} = getCurrentProject()

    await axios.delete(`${getAgentaApiUrl()}/api/variants/${variantId}?project_id=${projectId}`)
}

export async function updateVariantParams(variantId: string, parameters: Parameter[]) {
    const {projectId} = getCurrentProject()

    await axios.put(
        `${getAgentaApiUrl()}/api/variants/${variantId}/parameters?project_id=${projectId}`,
        {
            parameters: parameters.reduce((acc, param) => {
                return {...acc, [param.name]: param.default}
            }, {}),
        },
    )
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
    const {projectId} = getCurrentProject()

    await axios.post(`${getAgentaApiUrl()}/api/variants/from-base?project_id=${projectId}`, {
        base_id: baseId,
        new_variant_name: newVariantName,
        new_config_name: newConfigName,
        parameters: parameters.reduce((acc, param) => {
            return {...acc, [param.name]: param.default}
        }, {}),
    })
}

export const fetchVariantLogs = async (variantId: string, ignoreAxiosError: boolean = false) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/variants/${variantId}/logs?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}
