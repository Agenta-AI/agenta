/** The agent pages that are views of the agent route (`agents/[agent_id]?view=`). */
export type AgentPageView = "configuration" | "channels" | "analytics" | "sessions"

/**
 * The address of an agent page. The Configuration page opens on its Agent tab. The pages
 * themselves belong to the agent route; this only builds the link.
 */
export const agentPageHref = (projectURL: string, agentId: string, view: AgentPageView): string =>
    view === "configuration"
        ? `${projectURL}/agents/${agentId}?view=configuration&tab=agent`
        : `${projectURL}/agents/${agentId}?view=${view}`
