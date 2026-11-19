import type {SelectedSidebar} from "./selectedSidebar"

type Query = Record<string, string | string[] | undefined>

const SESSION_ROUTE = /\/sessions\/\[session_id\]$/
const AGENT_ROUTE = /\/agents\/\[agent_id\]$/

/** The agent pages: a session, and the agent route with its views (Configuration, Channels, ...). */
export const isAgentPage = (pathname: string): boolean =>
    SESSION_ROUTE.test(pathname) || AGENT_ROUTE.test(pathname)

/** The session id of a session page, else null. */
export const routeSessionId = (pathname: string, query: Query): string | null =>
    SESSION_ROUTE.test(pathname) && typeof query.session_id === "string" ? query.session_id : null

/**
 * The agent a page belongs to, when the route names it: the agent route, or a session link that
 * carries `?agent=`. Null when the route does not say (a session page reads its row instead).
 */
export const routeAgentId = (pathname: string, query: Query): string | null => {
    if (AGENT_ROUTE.test(pathname) && typeof query.agent_id === "string") return query.agent_id
    if (SESSION_ROUTE.test(pathname) && typeof query.agent === "string" && query.agent)
        return query.agent
    return null
}

/**
 * The sidebar after a route change, or null to keep the current one.
 *
 * - A page that is not an agent page (Home, Settings, the Agents list) shows the main sidebar.
 * - A page of another agent, opened while an agent sidebar shows, switches it to that agent.
 * - The main sidebar stays the main sidebar: a click on a session there keeps it.
 */
export const sidebarAfterRoute = (
    current: SelectedSidebar,
    pathname: string,
    pageAgentId: string | null,
): SelectedSidebar | null => {
    if (current.kind === "main") return null
    if (!isAgentPage(pathname)) return {kind: "main"}
    if (pageAgentId && pageAgentId !== current.agentId)
        return {kind: "agent", agentId: pageAgentId, from: current.from}
    return null
}
