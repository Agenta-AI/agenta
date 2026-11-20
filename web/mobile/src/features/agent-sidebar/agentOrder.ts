import {sidebarAgentCountsAtomFamily} from "@agenta/navigation"
import {useAtomValue} from "jotai"

import {MOBILE_NAV_SCOPE_ID} from "../nav/useMobileNavItems"

interface NamedAgent {
    id: string
    name?: string | null
    slug?: string | null
}

const agentLabel = (agent: NamedAgent) => agent.name || agent.slug || ""

/**
 * The agents in the main sidebar's order: agents with chats first, the most chats first and the
 * name on a tie (as the main sidebar sorts its agent headings), then the agents with no chat in
 * catalog order.
 */
export const orderAgentsLikeMainSidebar = <T extends NamedAgent>(
    agents: readonly T[],
    chatCounts: ReadonlyMap<string, number>,
): T[] => {
    const ranked = agents
        .filter((agent) => (chatCounts.get(agent.id) ?? 0) > 0)
        .sort(
            (a, b) =>
                (chatCounts.get(b.id) ?? 0) - (chatCounts.get(a.id) ?? 0) ||
                agentLabel(a).localeCompare(agentLabel(b)),
        )
    const rest = agents.filter((agent) => (chatCounts.get(agent.id) ?? 0) === 0)
    return [...ranked, ...rest]
}

/**
 * The main sidebar's chat counts, from the query it already loads. The query is gated on the
 * main sidebar's Sessions group, so this read sends no request of its own: until the main
 * sidebar loads the counts, the agents keep catalog order.
 */
export const useMainSidebarChatCounts = (): ReadonlyMap<string, number> =>
    useAtomValue(sidebarAgentCountsAtomFamily(MOBILE_NAV_SCOPE_ID))
