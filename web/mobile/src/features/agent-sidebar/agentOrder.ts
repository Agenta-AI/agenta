import {
    applyManualOrder,
    SIDEBAR_AGENT_GROUP_ZONE,
    sidebarAgentCountsAtomFamily,
    sidebarManualOrderAtomFamily,
} from "@agenta/navigation"
import {useAtomValue} from "jotai"

import {MOBILE_NAV_SCOPE_ID} from "../nav/useMobileNavItems"

interface NamedAgent {
    id: string
    name?: string | null
}

/** The heading label the main sidebar sorts ties on. */
const headingLabel = (agent: NamedAgent) => agent.name?.trim() || "Agent"

/**
 * The agents in the main sidebar's order: agents with chats first, the most chats first and the
 * heading label on a tie (the main sidebar's default order for its agent headings), then the
 * agents with no chat in catalog order. The person's hand arrangement of the agent headings
 * (`manualOrder`, `agent:<id>` keys) goes over that, as in the main sidebar.
 */
export const orderAgentsLikeMainSidebar = <T extends NamedAgent>(
    agents: readonly T[],
    chatCounts: ReadonlyMap<string, number>,
    manualOrder: readonly string[] = [],
): T[] => {
    const count = (agent: T) => chatCounts.get(agent.id) ?? 0
    const ranked = agents
        .filter((agent) => count(agent) > 0)
        .sort((a, b) => count(b) - count(a) || headingLabel(a).localeCompare(headingLabel(b)))
    const rest = agents.filter((agent) => count(agent) === 0)
    return applyManualOrder(
        [...ranked, ...rest],
        (agent) => `agent:${agent.id}`,
        manualOrder,
        "trail",
    )
}

/**
 * What the main sidebar orders its agent headings by: the chat counts, from the query it already
 * loads, and the hand arrangement, kept in the browser. The counts query is gated on the main
 * sidebar's Sessions group, so this read sends no request of its own: until the main sidebar
 * loads the counts, the agents keep catalog order under the hand arrangement.
 */
export const useMainSidebarAgentOrder = () => ({
    chatCounts: useAtomValue(sidebarAgentCountsAtomFamily(MOBILE_NAV_SCOPE_ID)),
    manualOrder: useAtomValue(sidebarManualOrderAtomFamily(SIDEBAR_AGENT_GROUP_ZONE)),
})
