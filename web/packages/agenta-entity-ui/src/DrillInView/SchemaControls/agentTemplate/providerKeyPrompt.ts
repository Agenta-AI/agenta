import {hasStoredKey} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"

import type {ConnectionMode} from "../connectionUtils"

/**
 * Whether the Model section should prompt for the selected model's standard provider key.
 *
 * Presence comes from `hasStoredKey`, never the row's value: a write-only record returns no value
 * and reports presence through `hasKey`, so `!row.key` called a connected project keyless (#6660).
 *
 * Answers `false` wherever it cannot judge: a `self_managed` connection signs itself in, a named
 * `agenta` connection points at a vault record this rule never looks up, and an unresolved vault
 * reads as keyless for every provider.
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
