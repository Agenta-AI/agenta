import {sessionListQueryOptions, type SessionListFilters} from "@agenta/entities/session"
import {ACTIVITY_WINDOW_HOURS, type SidebarSessionFilters} from "@agenta/navigation"

/** What the agent sidebar's filter menu narrows the list by: server predicates only. */
export type AgentSessionsNarrowing = Pick<
    SessionListFilters,
    "flags" | "origins" | "excludeOrigins" | "activityFloor" | "sessionIds"
>

/**
 * The agent sidebar's filters (Type, Status, Last activity) as the session list's server
 * predicates, the same ones the main sidebar sends. "Waiting" is the sessions with a pending
 * interaction (`waitingIds`); null while that list loads. `now` is the floor's clock.
 */
export const agentSessionsNarrowing = (
    filters: Pick<SidebarSessionFilters, "status" | "type" | "activity">,
    waitingIds: string[] | null,
    now: number,
): AgentSessionsNarrowing | null => {
    if (filters.status === "waiting" && waitingIds === null) return null
    const hours = ACTIVITY_WINDOW_HOURS[filters.activity]
    return {
        flags:
            filters.status === "running"
                ? {is_running: true}
                : filters.status === "idle"
                  ? {is_alive: false}
                  : undefined,
        sessionIds: filters.status === "waiting" ? (waitingIds ?? []) : undefined,
        origins: filters.type === "automation" ? ["trigger"] : undefined,
        excludeOrigins: filters.type === "chat" ? ["trigger"] : undefined,
        activityFloor: hours ? new Date(now - hours * 3_600_000).toISOString() : undefined,
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
