import {sessionListQueryOptions, type SessionListFilters} from "@agenta/entities/session"
import {sessionListIdGroupLimit, sessionListRequestFilters} from "@agenta/sessions/state"

import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"

export const SIDEBAR_SESSION_LIMIT = 20

export const sidebarSessionFilters = ({
    projectId,
    sessionIds,
    excludeSessionIds,
}: {
    projectId: string
    sessionIds?: string[]
    excludeSessionIds?: string[]
}): SessionListFilters => ({
    projectId,
    includeArchived: false,
    sessionIds,
    excludeSessionIds,
    limit: sessionListIdGroupLimit(sessionIds, SIDEBAR_SESSION_LIMIT),
    lowPriority: true,
    ...sessionListRequestFilters(sessionListPolicies.sidebar),
})

export const sidebarSessionOptions = (args: Parameters<typeof sidebarSessionFilters>[0]) =>
    sessionListQueryOptions(sidebarSessionFilters(args))
