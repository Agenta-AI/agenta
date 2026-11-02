/**
 * The Active-models column of the AI-providers table.
 *
 * A connection either saved a model list or did not. A saved list is a count against what the
 * provider family offers; a missing list means the connection is still on Agenta's defaults, and
 * saying "3 of 38" for it would claim a choice the user never made.
 */

import {
    defaultModelsFor,
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

/**
 * How many models this connection actually offers — its saved list when it has one (including an
 * empty one, which means "offer none"), otherwise Agenta's defaults for the family.
 *
 * Literally the rule the picker builds its rows from — both call `defaultModelsFor` — so the
 * drawer's "3 models" cannot claim a number the menu will not produce. It used to be a second
 * spelling of the same rule, which is how the two came to disagree.
 */
export const connectionModelCount = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
): number =>
    connection.models
        ? connection.models.filter(Boolean).length
        : defaultModelsFor(connection, capabilities).length

/**
 * The connected row's ONE subtitle: `sk-••••AAA · 3 models · Pi, Claude Code`.
 *
 * Everything the row knows folds into this line — the credential, the model count, the harnesses —
 * so the row needs no pills and no second status text beside its dot. A part with nothing to say
 * (no credential, no harness policy) drops out rather than rendering an empty segment.
 */
export const connectedRowSubtitle = ({
    credential,
    modelCount,
    harnessLabels,
}: {
    credential: string
    modelCount: number
    harnessLabels: string[]
}): string =>
    [
        credential && credential !== "—" ? credential : "",
        `${modelCount} ${modelCount === 1 ? "model" : "models"}`,
        harnessLabels.join(", "),
    ]
        .filter(Boolean)
        .join(" · ")
