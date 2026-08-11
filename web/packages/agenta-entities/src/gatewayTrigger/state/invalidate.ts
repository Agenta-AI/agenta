/** Trigger list invalidation, in one place — the drawers mutate through it, and so does the
 * playground when an agent's server-side platform op settles. Prefix-matches the detail family. */

import {queryClient} from "@agenta/shared/api"

export function invalidateTriggerSchedules(): void {
    queryClient.invalidateQueries({queryKey: ["triggers", "schedules"]})
}

export function invalidateTriggerSubscriptions(): void {
    queryClient.invalidateQueries({queryKey: ["triggers", "subscriptions"]})
}
