import {sessionListQueryOptions, type SessionListFilters} from "@agenta/entities/session"
import {
    sessionListIdGroupLimit,
    sessionListRequestFilters,
    type SessionListRequestPolicy,
} from "@agenta/sessions/state"

import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"

export const SIDEBAR_SESSION_LIMIT = 20

export const sidebarSessionFilters = ({
    projectId,
    sessionIds,
    excludeSessionIds,
    policy = sessionListPolicies.sidebar,
}: {
    projectId: string
    sessionIds?: string[]
    excludeSessionIds?: string[]
    /** The pinned query overrides this to `sidebarPinned` (origin: "all") — see P2-8. */
    policy?: SessionListRequestPolicy
}): SessionListFilters => ({
    projectId,
    includeArchived: false,
    sessionIds,
    excludeSessionIds,
    limit: sessionListIdGroupLimit(sessionIds, SIDEBAR_SESSION_LIMIT),
    lowPriority: true,
    ...sessionListRequestFilters(policy),
})

export const sidebarSessionOptions = (args: Parameters<typeof sidebarSessionFilters>[0]) =>
    sessionListQueryOptions(sidebarSessionFilters(args))
