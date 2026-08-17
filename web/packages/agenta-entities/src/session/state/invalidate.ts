import {getHostQueryClient} from "@agenta/shared/api"

/**
 * Refetch every session-list query, wherever it is nested.
 *
 * All of them are built from the same `sessionListQueryOptions()`, whose key starts
 * `["session-list", projectId, ...]` — but the sidebar and mobile nest that array behind their own
 * prefix (`["sidebar", ...]`, `["mobile", ...]`, `["mobile", "head", ...]`), and TanStack matches
 * prefixes positionally from index 0, so `["session-list"]` reaches desktop ONLY. A token match
 * catches all of them without enumerating each nesting, and without touching the sibling
 * sidebar/mobile queries (session-stream, liveness, pins, …) that don't carry the token.
 */
export function invalidateSessionListQueries(): void {
    void getHostQueryClient().invalidateQueries({
        predicate: (query) => query.queryKey.includes("session-list"),
    })
}
