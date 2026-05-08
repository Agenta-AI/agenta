/**
 * Secret API Functions
 *
 * HTTP functions for the `/vault/v1/secrets/` endpoint family.
 * Ported verbatim from the legacy `web/oss/src/services/vault/api/index.ts`,
 * substituting only the imports (axios + getAgentaApiUrl from
 * `@agenta/shared/api`) and the secret-domain types from `../core`.
 *
 * Naming convention:
 *   - fetch / fetchAll : GET single / GET all
 *   - create           : POST
 *   - update           : PUT
 *   - delete           : DELETE
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import type {LlmProvider} from "@agenta/shared/types"

import {transformSecret} from "../core/transforms"
import type {CustomSecretDTO, StandardSecretDTO} from "../core/types"

export const fetchVaultSecret = async ({
    projectId,
}: {
    projectId: string
}): Promise<LlmProvider[]> => {
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
}): Promise<T> => {
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
}): Promise<T> => {
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
