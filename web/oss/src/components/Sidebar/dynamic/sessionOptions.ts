import {sessionListQueryOptions, type SessionListFilters} from "@agenta/entities/session"
import {
    sessionListIdGroupLimit,
    sessionListRequestFilters,
    type SessionListRequestPolicy,
} from "@agenta/sessions/state"
import {sessionListPolicies} from "@agenta/sessions/state"

/**
 * One request, deliberately much wider than the {@link SIDEBAR_SESSION_VISIBLE_LIMIT} rows the
 * sidebar shows. Unstarted sessions (a beat-only stream row, see `isStartedSession`) are the
 * NEWEST, are dropped before render, and a burst of them would otherwise eat the whole window and
 * leave the group empty. Rows are small here — this policy requests no expansions — and the server
 * caps a window at 200.
 */
export const SIDEBAR_SESSION_LIMIT = 100

/** Rows the Sessions group renders before it collapses the rest behind "Show all". */
export const SIDEBAR_SESSION_VISIBLE_LIMIT = 14

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
