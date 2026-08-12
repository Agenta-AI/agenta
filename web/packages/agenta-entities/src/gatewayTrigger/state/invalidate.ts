/** Trigger list invalidation, in one place — the drawers mutate through it, and so does the
 * playground when an agent's server-side platform op settles. Prefix-matches the detail family. */

import {queryClient} from "@agenta/shared/api"

import {invalidateSessionListQueries} from "../../session/state/invalidate"

export function invalidateTriggerSchedules(): void {
    queryClient.invalidateQueries({queryKey: ["triggers", "schedules"]})
    // A rename/delete changes what an automation-mode session row shows (name, or the
    // historical-name fallback) — the list must refetch, not just the trigger's own cache.
    invalidateSessionListQueries()
}

export function invalidateTriggerSubscriptions(): void {
    queryClient.invalidateQueries({queryKey: ["triggers", "subscriptions"]})
    invalidateSessionListQueries()
}
