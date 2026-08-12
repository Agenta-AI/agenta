/**
 * The Active-models column of the AI-providers table.
 *
 * A connection either saved a model list or did not. A saved list is a count against what the
 * provider family offers; a missing list means the connection is still on Agenta's defaults, and
 * saying "3 of 38" for it would claim a choice the user never made.
 */

import {
    providerModelCatalog,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "./connections"
import {secretKindForProviderKind} from "./providerCatalog"
import {SecretKind} from "./types"

/**
 * "2 of 38 active", or "Defaults" when the connection saved no list.
 *
 * Only standard providers can be counted against a catalog: a credential-set connection carries
 * whatever its endpoint serves, so its saved list is counted against itself.
 */
export const activeModelsSummary = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
): string => {
    if (!connection.models) return "Defaults"

    const isStandard = secretKindForProviderKind(connection.kind) === SecretKind.ProviderKey
    const total = isStandard
        ? providerModelCatalog(capabilities, connection.kind).models.length
        : connection.models.length

    return `${connection.models.length} of ${Math.max(total, connection.models.length)} active`
}
