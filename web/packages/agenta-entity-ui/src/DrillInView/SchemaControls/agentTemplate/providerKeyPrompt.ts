import {hasStoredKey} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"

import type {ConnectionMode} from "../connectionUtils"

/**
 * Whether the Model section should prompt for the selected model's standard provider key.
 *
 * It drives a prompt, not an enforcement: the `Connect key` badge, the section's
 * "Connect the model's provider key to run this agent." tooltip, and the section auto-opening.
 * It answers one narrow question, whether the vault holds a STANDARD key for the selected model's
 * provider family, and it deliberately answers `false` wherever it cannot say.
 *
 * Presence comes from `hasStoredKey`, the one vault presence rule, and never from reading the
 * value off the row. A write-only record never returns its value; it reports presence through
 * `hasKey`. Reading `!row.key` therefore called a connected project keyless and left the badge and
 * its tooltip standing over a key the agent was already running on. That is issue #6660.
 *
 * The two exemptions come first, and both mean this function is not the right judge:
 *
 * - A `self_managed` connection signs itself in through the harness, so no vault key applies.
 * - A named `agenta` connection points at one vault record by slug. That record IS its credential
 *   source, but this function never looks it up, so a missing standard key for the family says
 *   nothing about it.
 *
 * `vaultLoaded` gates the rest: the vault answers "no key" for every provider until it resolves,
 * and prompting on that would flash the badge on every load.
 */
export const shouldPromptForProviderKey = ({
    connectionMode,
    connectionSlug,
    vaultLoaded,
    standardProviderEntry,
}: {
    /** The config's `agent.llm.connection.mode`, normalized by `connectionFromConfig`. */
    connectionMode: ConnectionMode | null | undefined
    /** The named connection's slug, when the config points at one. */
    connectionSlug: string | null | undefined
    /** Whether the project vault query has resolved. */
    vaultLoaded: boolean
    /** The standard vault catalog row for the selected model's provider family, or `null`. */
    standardProviderEntry: LlmProvider | null | undefined
}): boolean => {
    if (connectionMode === "self_managed") return false
    if (connectionMode === "agenta" && !!connectionSlug) return false
    if (!vaultLoaded || !standardProviderEntry) return false
    return !hasStoredKey(standardProviderEntry)
}
