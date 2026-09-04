/** Trigger list invalidation, in one place — the drawers mutate through it, and so does the
 * playground when an agent's server-side platform op settles. Prefix-matches the detail family.
 *
 * Resolved per call through `getHostQueryClient()`, never the `queryClient` singleton: `/m`
 * installs its own client, so a package-layer write on the singleton lands in an orphan cache and
 * silently does nothing. */

import {getHostQueryClient} from "@agenta/shared/api"

import {invalidateSessionListQueries} from "../../session/state/invalidate"

export function invalidateTriggerSchedules(): void {
    getHostQueryClient().invalidateQueries({queryKey: ["triggers", "schedules"]})
    // A rename/delete changes what an automation-mode session row shows (name, or the
    // historical-name fallback) — the list must refetch, not just the trigger's own cache.
    invalidateSessionListQueries()
}

export function invalidateTriggerSubscriptions(): void {
    getHostQueryClient().invalidateQueries({queryKey: ["triggers", "subscriptions"]})
    invalidateSessionListQueries()
}
