import axios from "@/oss/lib/api/assets/axiosConfig"
import {transformSecret} from "@/oss/lib/helpers/llmProviders"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {StandardSecretDTO, CustomSecretDTO} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchVaultSecret = async () => {
    const response = await axios.get(`${getAgentaApiUrl()}/vault/v1/secrets`)
    return transformSecret(response.data as StandardSecretDTO[] | CustomSecretDTO[])
}

export const createVaultSecret = async <T>({payload}: {payload: T}) => {
    const response = await axios.post(`${getAgentaApiUrl()}/vault/v1/secrets`, payload)
    return response.data as T
}

export const updateVaultSecret = async <T>({
    secret_id,
    payload,
}: {
    secret_id: string
    payload: T
}) => {
    const response = await axios.put(`${getAgentaApiUrl()}/vault/v1/secrets/${secret_id}`, payload)
    return response.data as T
}

export const deleteVaultSecret = async ({secret_id}: {secret_id: string}) => {
    return await axios.delete(`${getAgentaApiUrl()}/vault/v1/secrets/${secret_id}`)
}
