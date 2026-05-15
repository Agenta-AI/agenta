/**
 * Secret API Functions
 *
 * HTTP functions for the `/secrets/` endpoint family, backed by the
 * Fern-generated `@agentaai/api-client` via `@agenta/sdk`. The backend
 * still exposes the deprecated `/vault/v1/secrets/` mount for backwards
 * compatibility, but new callers go through the canonical path.
 *
 * The function signatures match the legacy axios wrappers exactly so
 * `state/atoms.ts` can keep its existing call sites unchanged.
 *
 * Naming convention:
 *   - fetch / fetchAll : GET single / GET all
 *   - create           : POST
 *   - update           : PUT
 *   - delete           : DELETE
 */

import type {LlmProvider} from "@agenta/shared/types"

import {transformSecret} from "../core/transforms"
import type {CustomSecretDTO, StandardSecretDTO} from "../core/types"

import {getSecretsClient, projectScopedRequest} from "./client"

type CreateSecretRequest = Parameters<ReturnType<typeof getSecretsClient>["createSecret"]>[0]
type UpdateSecretRequest = Parameters<ReturnType<typeof getSecretsClient>["updateSecret"]>[0]

export const fetchVaultSecret = async ({
    projectId,
}: {
    projectId: string
}): Promise<LlmProvider[]> => {
    const result = await getSecretsClient().listSecrets(projectScopedRequest(projectId))
    return transformSecret(result as unknown as StandardSecretDTO[] | CustomSecretDTO[])
}

export const createVaultSecret = async <T>({
    projectId,
    payload,
}: {
    projectId: string
    payload: T
}): Promise<T> => {
    const result = await getSecretsClient().createSecret(
        payload as unknown as CreateSecretRequest,
        projectScopedRequest(projectId),
    )
    return result as unknown as T
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
    const result = await getSecretsClient().updateSecret(
        {secret_id, ...(payload as Record<string, unknown>)} as UpdateSecretRequest,
        projectScopedRequest(projectId),
    )
    return result as unknown as T
}

export const deleteVaultSecret = async ({
    projectId,
    secret_id,
}: {
    projectId: string
    secret_id: string
}) => {
    return await getSecretsClient().deleteSecret({secret_id}, projectScopedRequest(projectId))
}
