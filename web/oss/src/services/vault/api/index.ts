import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {transformSecret} from "@/oss/lib/helpers/llmProviders"
import {CustomSecretDTO, StandardSecretDTO} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchVaultSecret = async ({projectId}: {projectId: string}) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/vault/v1/secrets/?project_id=${projectId}`,
    )
    return transformSecret(response.data as StandardSecretDTO[] | CustomSecretDTO[])
}

export const createVaultSecret = async <T>({
    projectId,
    payload,
}: {
    projectId: string
    payload: T
}) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/vault/v1/secrets/?project_id=${projectId}`,
        payload,
    )
    return response.data as T
}

export const updateVaultSecret = async <T>({
    projectId,
    secret_id,
    payload,
}: {
    projectId: string
    secret_id: string
    payload: T
}) => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/vault/v1/secrets/${secret_id}?project_id=${projectId}`,
        payload,
    )
    return response.data as T
}

export const deleteVaultSecret = async ({
    projectId,
    secret_id,
}: {
    projectId: string
    secret_id: string
}) => {
    return await axios.delete(
        `${getAgentaApiUrl()}/vault/v1/secrets/${secret_id}?project_id=${projectId}`,
    )
}
