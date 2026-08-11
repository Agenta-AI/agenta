/** Trigger list invalidation, in one place — the drawers mutate through it, and so does the
 * playground when an agent's server-side platform op settles. Prefix-matches the detail family. */

import {queryClient} from "@agenta/shared/api"

/**
 * Every session-list query (desktop's `useSessionList`, the sidebar, mobile's infinite list and
 * head) is built from the same `sessionListQueryOptions()` in `@agenta/entities/session`, whose
 * key starts `["session-list", projectId, ...]`. The sidebar and mobile nest that array behind
 * their own prefix (`["sidebar", ...]`, `["mobile", ...]`, `["mobile", "head", ...]`), so a plain
 * prefix match on `["session-list"]` only catches desktop. A `session-list` token match anywhere
 * in the key catches all of them without enumerating each nesting or over-invalidating unrelated
 * mobile/sidebar queries (session-stream, liveness, pins, ...) that don't carry that token.
 */
function invalidateSessionLists(): void {
    queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("session-list"),
    })
}

export function invalidateTriggerSchedules(): void {
    queryClient.invalidateQueries({queryKey: ["triggers", "schedules"]})
    // A rename/delete changes what an automation-mode session row shows (name, or the
    // historical-name fallback) — the list must refetch, not just the trigger's own cache.
    invalidateSessionLists()
}

export function invalidateTriggerSubscriptions(): void {
    queryClient.invalidateQueries({queryKey: ["triggers", "subscriptions"]})
    invalidateSessionLists()
}
