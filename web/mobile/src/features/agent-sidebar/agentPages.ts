/** The agent pages that are views of the agent route (`agents/[agent_id]?view=`). */
export const AGENT_PAGE_VIEWS = ["configuration", "channels", "analytics", "sessions"] as const
export type AgentPageView = (typeof AGENT_PAGE_VIEWS)[number]

export const isAgentPageView = (value: unknown): value is AgentPageView =>
    AGENT_PAGE_VIEWS.includes(value as AgentPageView)

/** The agent route's page pattern (Next's `pathname`). */
export const AGENT_ROUTE = /\/agents\/\[agent_id\]$/

/**
 * The address of an agent page. The Configuration page opens on `tab`, the Agent tab by default.
 * The pages themselves belong to the agent route; this only builds the link.
 */
export const agentPageHref = (
    projectURL: string,
    agentId: string,
    view: AgentPageView,
    tab = "agent",
): string =>
    view === "configuration"
        ? `${projectURL}/agents/${agentId}?view=configuration&tab=${encodeURIComponent(tab)}`
        : `${projectURL}/agents/${agentId}?view=${view}`
