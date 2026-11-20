import {sessionListQueryOptions} from "@agenta/entities/session"

/** The first page of one agent's session list, with the total. Under the list's own key prefix,
 * so renames, archives and new turns refresh it too. The agent sidebar lists it; the switcher
 * reads it at limit 1 for the latest session. */
export const agentSessionsQuery = (projectId: string, agentId: string, limit: number) => {
    const options = sessionListQueryOptions({projectId, agentId, includeTotal: true, limit})
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
