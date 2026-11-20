import {sessionListQueryOptions} from "@agenta/entities/session"
import type {QueryClient} from "@tanstack/react-query"
import Router from "next/router"

import {currentSidebar, openAgentSidebar} from "../agent-sidebar/selectedSidebar"
import {startBlankSession} from "../chat/useStartBlankSession"

/**
 * The agent's latest session id, or null when it has none. The same request and cache entry as
 * the agent switcher's lookup (`agentSessionsQuery` in the agent sidebar, at limit 1). Rejects
 * when the list fails.
 */
export const latestAgentSessionId = async (
    queryClient: QueryClient,
    projectId: string,
    agentId: string,
): Promise<string | null> => {
    const options = sessionListQueryOptions({projectId, agentId, includeTotal: true, limit: 1})
    const page = await queryClient.fetchQuery({
        queryKey: [...options.queryKey, "first-page"],
        queryFn: async ({signal}) => {
            const result = await options.queryFn({pageParam: null, signal})
            if (!result) throw new Error("The session list did not load")
            return result
        },
        staleTime: 30_000,
    })
    return page.sessions[0]?.session_id ?? null
}

/**
 * A click on an agent in the Agents list: the agent sidebar shows ("Back" returns to the Agents
 * list), and the agent's latest session opens (the agent switcher's rule), or a new empty
 * session when it has none. Archived sessions are not listed, so an archived last session opens
 * a new one. Unlike the switcher, a failed lookup still opens the agent: the click asked for it,
 * and the Agents list has nothing else to show.
 */
export const openAgentFromList = async ({
    queryClient,
    base,
    projectId,
    agentId,
}: {
    queryClient: QueryClient
    base: string
    projectId: string
    agentId: string
}): Promise<void> => {
    const fromPath = Router.asPath
    const choice = openAgentSidebar(agentId, "agents")
    let sessionId: string | null = null
    try {
        sessionId = await latestAgentSessionId(queryClient, projectId, agentId)
    } catch {
        // The lookup failed: a new session still opens the agent.
    }
    // Another click or a move to another page while the lookup ran wins.
    if (currentSidebar() !== choice || Router.asPath !== fromPath) return
    if (sessionId) void Router.push(`${base}/sessions/${sessionId}`)
    else startBlankSession(base, agentId)
}
