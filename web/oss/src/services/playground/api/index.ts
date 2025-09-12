import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {Parameter} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export function restartAppVariantContainer(variantId: string) {
    const {projectId} = getProjectValues()

    return axios.post(`${getAgentaApiUrl()}/containers/restart_container?project_id=${projectId}`, {
        variant_id: variantId,
    })
}

export async function deleteSingleVariant(variantId: string) {
    const {projectId} = getProjectValues()

    await axios.delete(`${getAgentaApiUrl()}/variants/${variantId}?project_id=${projectId}`)
}

export async function deleteSingleVariantRevision(variantId: string, revisionId: string) {
    const {projectId} = getProjectValues()

    await axios.delete(
        `${getAgentaApiUrl()}/variants/${variantId}/revisions/${revisionId}/?project_id=${projectId}`,
    )
}

export async function updateVariantParams(variantId: string, parameters: Parameter[]) {
    const {projectId} = getProjectValues()

    console.log("updateVariantParams", getAgentaApiUrl())
    await axios.put(
        `${getAgentaApiUrl()}/variants/${variantId}/parameters?project_id=${projectId}`,
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
    const {projectId} = getProjectValues()

    await axios.post(`${getAgentaApiUrl()}/variants/from-base?project_id=${projectId}`, {
        base_id: baseId,
        new_variant_name: newVariantName,
        new_config_name: newConfigName,
        parameters: parameters.reduce((acc, param) => {
            return {...acc, [param.name]: param.default}
        }, {}),
    })
}

export const fetchVariantLogs = async (variantId: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/variants/${variantId}/logs?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}
