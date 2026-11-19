import {agentPageHref, type AgentPageView} from "./agentPages"

type Query = Record<string, string | string[] | undefined>

const VIEWS: readonly AgentPageView[] = ["configuration", "channels", "analytics", "sessions"]

/**
 * Where an agent switcher pick goes: the same kind of page for the picked agent. An agent page
 * (Configuration with its tab, Channels, Analytics, Sessions) goes to the same page of the
 * picked agent. Anything else, a session included, goes to the picked agent's latest session,
 * or to a new empty session when it has none (`null`).
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
    /** The picked agent's latest session id, or null when it has none. */
    latestSessionId: (agentId: string) => Promise<string | null>
}): Promise<string | null> => {
    const view = typeof query.view === "string" ? (query.view as AgentPageView) : null
    if (/\/agents\/\[agent_id\]$/.test(pathname) && view && VIEWS.includes(view)) {
        const href = agentPageHref(projectURL, pickedAgentId, view)
        return view === "configuration" && typeof query.tab === "string"
            ? href.replace(/tab=[^&]*/, `tab=${encodeURIComponent(query.tab)}`)
            : href
    }
    const sessionId = await latestSessionId(pickedAgentId).catch(() => null)
    return sessionId ? `${projectURL}/sessions/${sessionId}` : null
}
