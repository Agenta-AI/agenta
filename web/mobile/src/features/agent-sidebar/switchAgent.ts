import {AGENT_ROUTE, agentPageHref, isAgentPageView} from "./agentPages"

type Query = Record<string, string | string[] | undefined>

/**
 * Where an agent switcher pick goes: the same kind of page for the picked agent. An agent page
 * (Configuration with its tab, Channels, Analytics, Sessions) goes to the same page of the
 * picked agent. Anything else, a session included, goes to the picked agent's latest session,
 * or to a new empty session when it has none (`null`). A failed lookup rejects.
 */
export const switchTarget = async ({
    projectURL,
    pathname,
    query,
    pickedAgentId,
    latestSessionId,
}: {
    projectURL: string
    pathname: string
    query: Query
    pickedAgentId: string
    /** The picked agent's latest session id, or null when it has none. Rejects on failure. */
    latestSessionId: (agentId: string) => Promise<string | null>
}): Promise<string | null> => {
    if (AGENT_ROUTE.test(pathname) && isAgentPageView(query.view)) {
        const tab = typeof query.tab === "string" ? query.tab : undefined
        return agentPageHref(projectURL, pickedAgentId, query.view, tab)
    }
    const sessionId = await latestSessionId(pickedAgentId)
    return sessionId ? `${projectURL}/sessions/${sessionId}` : null
}
