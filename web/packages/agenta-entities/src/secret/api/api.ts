/**
 * Secret API Functions
 *
 * HTTP functions for the `/secrets/` endpoint family, backed by the
 * Fern-generated `@agentaai/api-client` via `@agenta/sdk`. The backend
 * still exposes the deprecated `/vault/v1/secrets/` mount for backwards
 * compatibility, but new callers go through the canonical path.
 */

import type {LlmProvider} from "@agenta/shared/types"

import {transformSecret} from "../core/transforms"

import {getSecretsClient, projectScopedRequest} from "./client"

type SecretsClient = ReturnType<typeof getSecretsClient>

type CreateSecretRequest = Parameters<SecretsClient["createSecret"]>[0]
type UpdateSecretRequest = Parameters<SecretsClient["updateSecret"]>[0]
type DeleteSecretRequest = Parameters<SecretsClient["deleteSecret"]>[0]

type CreateSecretResponse = Awaited<ReturnType<SecretsClient["createSecret"]>>
type UpdateSecretResponse = Awaited<ReturnType<SecretsClient["updateSecret"]>>
type DeleteSecretResponse = Awaited<ReturnType<SecretsClient["deleteSecret"]>>

/** Payload portion of an update — `secret_id` is supplied alongside. */
type UpdateSecretPayload = Omit<UpdateSecretRequest, "secret_id">

export const fetchVaultSecret = async ({
    projectId,
}: {
    projectId: string
}): Promise<LlmProvider[]> => {
    const result = await getSecretsClient().listSecrets(projectScopedRequest(projectId))
    return transformSecret(result)
}

export const createVaultSecret = async ({
    projectId,
    payload,
}: {
    projectId: string
    payload: CreateSecretRequest
}): Promise<CreateSecretResponse> => {
    return getSecretsClient().createSecret(payload, projectScopedRequest(projectId))
}

export const updateVaultSecret = async ({
    projectId,
    secret_id,
    payload,
}: {
    projectId: string
    secret_id: string
    payload: UpdateSecretPayload
}): Promise<UpdateSecretResponse> => {
    return getSecretsClient().updateSecret({secret_id, ...payload}, projectScopedRequest(projectId))
}

export const deleteVaultSecret = async ({
    projectId,
    secret_id,
}: {
    projectId: string
    secret_id: string
}): Promise<DeleteSecretResponse> => {
    const request: DeleteSecretRequest = {secret_id}
    return getSecretsClient().deleteSecret(request, projectScopedRequest(projectId))
}
