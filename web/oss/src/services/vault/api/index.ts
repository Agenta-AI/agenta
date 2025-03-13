import axios from "@/oss/lib/api/assets/axiosConfig"
import {transformSecret} from "@/oss/lib/helpers/llmProviders"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {HeaderDTO, SecretDTO, VaultSecretDTO} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

type VaultPayload = {
    header: HeaderDTO
    secret: SecretDTO
}

export const fetchVaultSecret = async () => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/vault/v1/secrets`)
    return transformSecret(response.data as VaultSecretDTO[])
}

export const createVaultSecret = async ({payload}: {payload: VaultPayload}) => {
    const response = await axios.post(`${getAgentaApiUrl()}/api/vault/v1/secrets`, payload)
    return response.data as VaultSecretDTO
}

export const updateVaultSecret = async ({
    secret_id,
    payload,
}: {
    secret_id: string
    payload: VaultPayload
}) => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/api/vault/v1/secrets/${secret_id}`,
        payload,
    )
    return response.data as VaultSecretDTO
}

export const deleteVaultSecret = async ({secret_id}: {secret_id: string}) => {
    return await axios.delete(`${getAgentaApiUrl()}/api/vault/v1/secrets/${secret_id}`)
}
