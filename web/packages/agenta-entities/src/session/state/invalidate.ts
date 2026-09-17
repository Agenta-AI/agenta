import {getHostQueryClient} from "@agenta/shared/api"

/** The tokens a session change reaches: every list, plus `/m`'s one-session `session-stream`
 * query that feeds the browser title. That one is not a list, but it carries the NAME — and the
 * agent names a session after its first turn, so a title read once at open never caught up. */
const SESSION_CHANGE_TOKENS = ["session-list", "session-stream"]

/**
 * Refetch every session-list query, wherever it is nested — and the per-session record beside it.
 *
 * All the lists are built from the same `sessionListQueryOptions()`, whose key starts
 * `["session-list", projectId, ...]` — but the sidebar and mobile nest that array behind their own
 * prefix (`["sidebar", ...]`, `["mobile", ...]`, `["mobile", "head", ...]`), and TanStack matches
 * prefixes positionally from index 0, so `["session-list"]` reaches desktop ONLY. A token match
 * catches all of them without enumerating each nesting, and without touching the sibling
 * sidebar/mobile queries (liveness, pins, …) that don't carry a token.
 */
export function invalidateSessionListQueries(): void {
    void getHostQueryClient().invalidateQueries({
        predicate: (query) => SESSION_CHANGE_TOKENS.some((token) => query.queryKey.includes(token)),
    })
}

/**
 * Refetch every session-liveness query, wherever it is nested.
 *
 * Same nesting problem as the lists: the desktop keys `["session-liveness", "alive", projectId]`
 * and `/m` keys `["mobile", "session-liveness", projectId]`, so a prefix match on
 * `["session-liveness"]` reaches the desktop ONLY. A token match reaches both.
 */
export function invalidateSessionLivenessQueries(): void {
    void getHostQueryClient().invalidateQueries({
        predicate: (query) => query.queryKey.includes("session-liveness"),
    })
}
