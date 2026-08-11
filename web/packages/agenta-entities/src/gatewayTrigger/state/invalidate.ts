/** Trigger list invalidation, in one place — the drawers mutate through it, and so does the
 * playground when an agent's server-side platform op settles. Prefix-matches the detail family.
 *
 * Resolved per call through `getHostQueryClient()`, never the `queryClient` singleton: `/m`
 * installs its own client, so a package-layer write on the singleton lands in an orphan cache and
 * silently does nothing. */

import {getHostQueryClient} from "@agenta/shared/api"

export function invalidateTriggerSchedules(): void {
    getHostQueryClient().invalidateQueries({queryKey: ["triggers", "schedules"]})
}

export function invalidateTriggerSubscriptions(): void {
    getHostQueryClient().invalidateQueries({queryKey: ["triggers", "subscriptions"]})
}
