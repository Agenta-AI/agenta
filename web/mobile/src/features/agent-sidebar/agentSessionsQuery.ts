import {sessionListQueryOptions, type SessionListFilters} from "@agenta/entities/session"
import {
    MAX_SESSION_IDS_PER_QUERY,
    sidebarSessionRequestFilters,
    type SidebarSessionFilters,
} from "@agenta/navigation"

/** What the agent sidebar's filter menu narrows the list by: server predicates only. */
export type AgentSessionsNarrowing = Pick<
    SessionListFilters,
    "flags" | "origins" | "excludeOrigins" | "activityFloor" | "sessionIds"
>

/**
 * The agent sidebar's filters (Type, Status, Last activity) as the session list's server
 * predicates, from the main sidebar's own mapping (`sidebarSessionRequestFilters`). "Waiting" is
 * the sessions with a pending interaction (`waitingIds`); null while that list loads.
 */
export const agentSessionsNarrowing = (
    filters: SidebarSessionFilters,
    waitingIds: string[] | null,
): AgentSessionsNarrowing | null => {
    if (filters.status === "waiting" && waitingIds === null) return null
    const request = sidebarSessionRequestFilters(filters)
    return {
        flags: request.flags,
        // Capped as the main sidebar caps it: a longer list is a 422 from the server.
        sessionIds:
            filters.status === "waiting"
                ? [...(waitingIds ?? [])].sort().slice(0, MAX_SESSION_IDS_PER_QUERY)
                : undefined,
        origins: request.origin ? [request.origin] : undefined,
        excludeOrigins: request.excludeOrigin ? [request.excludeOrigin] : undefined,
        activityFloor: request.oldest,
    }
}

/** The first page of one agent's session list, with the total. Under the list's own key prefix,
 * so renames, archives and new turns refresh it too. The agent sidebar lists it (narrowed by its
 * filters); the switcher reads it at limit 1 for the latest session. */
export const agentSessionsQuery = (
    projectId: string,
    agentId: string,
    limit: number,
    narrowing: AgentSessionsNarrowing = {},
) => {
    const options = sessionListQueryOptions({
        projectId,
        agentId,
        includeTotal: true,
        limit,
        ...narrowing,
    })
    return {
        queryKey: [...options.queryKey, "first-page"],
        queryFn: async ({signal}: {signal?: AbortSignal}) => {
            const page = await options.queryFn({pageParam: null, signal})
            // An error, not an empty list: a failed refresh keeps the rows it had.
            if (!page) throw new Error("The session list did not load")
            return page
        },
        staleTime: 30_000,
    }
}
