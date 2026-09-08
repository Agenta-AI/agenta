import {hasStoredKey} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"

/**
 * Whether the Model section must still ask for the selected model's provider key.
 *
 * Presence is decided by `hasStoredKey`, the ONE vault presence rule, never by reading the value
 * off the row. A write-only record never returns its value — it reports presence through `hasKey`
 * instead — so `!row.key` reads a connected project as keyless and leaves the "Connect key" badge
 * and its tooltip standing over a key that works. That is issue #6660: the playground kept asking
 * for a provider key while the agent ran on the very key it was asking for.
 *
 * The two exemptions come first because they say the vault is not the credential source at all:
 * a `self_managed` connection signs itself in through the harness, and a named `agenta` connection
 * (one with a slug) carries its own credentials, so a missing STANDARD key for the family is not
 * that connection's problem.
 *
 * `vaultLoaded` gates the whole rule: the vault answers "no key" for every provider until it
 * resolves, and asserting on that would flash the badge on every load.
 */
export const agentProviderNeedsKey = ({
    connectionMode,
    connectionSlug,
    vaultLoaded,
    providerEntry,
}: {
    /** The config's `agent.llm.connection.mode` (`agenta` or `self_managed`). */
    connectionMode: string | null | undefined
    /** The named connection's slug, when the config points at one. */
    connectionSlug: string | null | undefined
    /** Whether the project vault query has resolved. */
    vaultLoaded: boolean
    /** The vault catalog row for the selected model's provider family, or `null`. */
    providerEntry: LlmProvider | null | undefined
}): boolean => {
    if (connectionMode === "self_managed") return false
    if (connectionMode === "agenta" && !!connectionSlug) return false
    if (!vaultLoaded || !providerEntry) return false
    return !hasStoredKey(providerEntry)
}
