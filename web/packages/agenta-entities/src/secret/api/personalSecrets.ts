/**
 * The caller's own secrets (`scope=user` on the `/secrets/` routes).
 *
 * They belong to the person in the whole organization, so every project lists the same rows.
 * With personal accounts turned off for the deployment, the route answers 403
 * `personal_accounts_disabled`, which is how the screens learn the switch.
 */
import {transformSecret} from "../core/transforms"
import type {ProviderVaultRow, SecretResponseDto} from "../core/types"

import {getSecretsClient, projectScopedRequest} from "./client"

/** `user` is not in the generated request type until the client is regenerated. */
const USER_SCOPE = "user" as unknown as "organization"

export const fetchPersonalSecrets = async ({
    projectId,
}: {
    projectId: string
}): Promise<ProviderVaultRow[]> => {
    const result = await getSecretsClient().listSecrets(
        {scope: USER_SCOPE},
        projectScopedRequest(projectId),
    )
    return transformSecret(result as SecretResponseDto[])
}

export {USER_SCOPE}
