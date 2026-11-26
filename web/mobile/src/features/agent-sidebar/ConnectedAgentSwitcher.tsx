import {useCallback, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Router, {useRouter} from "next/router"

import {startBlankSession} from "../chat/useStartBlankSession"

import {orderAgentsLikeMainSidebar, useMainSidebarAgentOrder} from "./agentOrder"
import {agentSessionsQuery} from "./agentSessionsQuery"
import {AgentSidebarSwitcher, type SwitcherCurrent} from "./AgentSidebarSwitcher"
import {currentSidebar, openAgentSidebar, useSelectedSidebar} from "./selectedSidebar"
import {switchTarget} from "./switchAgent"

/**
 * The switcher, connected: the agents the person can see, in the main sidebar's order, and a
 * pick that keeps the same kind of page (see `switchTarget`) and shows the picked agent's
 * sidebar. "Builder" opens the builder page. The agent sidebar and the builder sidebar both use
 * it.
 */
export const ConnectedAgentSwitcher = ({
    projectURL,
    projectId,
    current,
    collapsed,
}: {
    projectURL: string
    projectId: string
    current: SwitcherCurrent
    collapsed: boolean
}) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const selected = useSelectedSidebar()
    const catalog = useAtomValue(agentWorkflowsListQueryStateAtom).data
    const {chatCounts, manualOrder} = useMainSidebarAgentOrder()
    const agents = useMemo(
        () => orderAgentsLikeMainSidebar(catalog, chatCounts, manualOrder),
        [catalog, chatCounts, manualOrder],
    )
    const onPick = useCallback(
        async (pickedAgentId: string) => {
            const fromPath = router.asPath
            const choice = openAgentSidebar(
                pickedAgentId,
                selected.kind === "agent" ? selected.from : "main",
            )
            let href: string | null
            try {
                href = await switchTarget({
                    projectURL,
                    pathname: router.pathname,
                    query: router.query,
                    pickedAgentId,
                    latestSessionId: async (id) => {
                        const page = await queryClient.fetchQuery(
                            agentSessionsQuery(projectId, id, 1),
                        )
                        return page.sessions[0]?.session_id ?? null
                    },
                })
            } catch {
                // The lookup failed: the agent sidebar shows, and the page stays.
                return
            }
            // Any later sidebar choice (a pick, Fold, Back, an open button) or a move to another
            // page replaced this one.
            if (currentSidebar() !== choice || Router.asPath !== fromPath) return
            if (href) void router.push(href)
            else startBlankSession(projectURL, pickedAgentId)
        },
        [projectId, projectURL, queryClient, router, selected],
    )
    return (
        <AgentSidebarSwitcher
            agents={agents}
            current={current}
            collapsed={collapsed}
            onPick={(id) => void onPick(id)}
            onPickBuilder={() => void router.push(`${projectURL}/builder`)}
        />
    )
}
