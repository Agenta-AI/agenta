/**
 * The caller's own secrets (`scope=user` on the `/secrets/` routes).
 *
 * They belong to the person in the whole organization, so every project lists the same rows.
 * With personal accounts turned off for the deployment, the route answers 403
 * `personal_accounts_disabled`, which is how the screens learn the switch.
 */
import {transformSecret} from "../core/transforms"
import type {ProviderVaultRow} from "../core/types"

import {getSecretsClient, projectScopedRequest} from "./client"

export const fetchPersonalSecrets = async ({
    projectId,
}: {
    projectId: string
}): Promise<ProviderVaultRow[]> => {
    const result = await getSecretsClient().listSecrets(
        {scope: "user"},
        projectScopedRequest(projectId),
    )
    return transformSecret(result)
}
