/**
 * Secret API Functions
 *
 * HTTP functions for the `/secrets/` endpoint family, backed by the
 * Fern-generated `@agentaai/api-client` via `@agenta/sdk`. The backend
 * still exposes the deprecated `/secrets/` mount for backwards
 * compatibility, but new callers go through the canonical path.
 */

import type {LlmProvider, OwnerKind} from "@agenta/shared/types"

import {transformSecret} from "../core/transforms"
import type {SecretOwnerScope} from "../core/types"

import {getSecretsClient, projectScopedRequest} from "./client"

type SecretsClient = ReturnType<typeof getSecretsClient>

type CreateSecretRequest = Parameters<SecretsClient["createSecret"]>[0]
type UpdateSecretRequest = Parameters<SecretsClient["updateSecret"]>[0]
type DeleteSecretRequest = Parameters<SecretsClient["deleteSecret"]>[0]

type CreateSecretResponse = Awaited<ReturnType<SecretsClient["createSecret"]>>
type UpdateSecretResponse = Awaited<ReturnType<SecretsClient["updateSecret"]>>
type DeleteSecretResponse = Awaited<ReturnType<SecretsClient["deleteSecret"]>>

/** Payload portion of an update — `secret_id` is supplied alongside. */
type UpdateSecretPayload = Omit<UpdateSecretRequest, "secret_id" | "scope">

/** The owner a by-id route acts for; omitted, the project's row as before. */
const ownerScope = (scope?: OwnerKind | null) =>
    scope === "organization" || scope === "user" ? {scope} : {}

export const fetchVaultSecret = async ({
    projectId,
}: {
    projectId: string
}): Promise<LlmProvider[]> => {
    // The organization connections this project may use ride along (no values, no previews):
    // agent surfaces name them, and every other reader keeps the project's rows only.
    const result = await getSecretsClient().listSecrets(
        {include_organization: true},
        projectScopedRequest(projectId),
    )
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
    scope,
}: {
    projectId: string
    secret_id: string
    payload: UpdateSecretPayload
    scope?: OwnerKind | null
}): Promise<UpdateSecretResponse> => {
    return getSecretsClient().updateSecret(
        {secret_id, ...payload, ...ownerScope(scope)},
        projectScopedRequest(projectId),
    )
}

export const deleteVaultSecret = async ({
    projectId,
    secret_id,
    scope,
}: {
    projectId: string
    secret_id: string
    scope?: OwnerKind | null
}): Promise<DeleteSecretResponse> => {
    const request: DeleteSecretRequest = {secret_id, ...ownerScope(scope)}
    return getSecretsClient().deleteSecret(request, projectScopedRequest(projectId))
}

/** Check a pasted subscription token with its provider and store it on the connection. */
export const setSubscriptionToken = async ({
    projectId,
    secretId,
    token,
    scope,
}: {
    projectId: string
    secretId: string
    token: string
    scope?: SecretOwnerScope | null
}) =>
    getSecretsClient().setSubscriptionToken(
        // A login token is set on the project's or the organization's row only.
        {secret_id: secretId, token, ...(scope === "organization" ? {scope} : {})},
        projectScopedRequest(projectId),
    )
