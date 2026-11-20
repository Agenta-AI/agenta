import {useCallback, useMemo} from "react"

import {sessionListQueryOptions} from "@agenta/entities/session"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Router, {useRouter} from "next/router"

import {startBlankSession} from "../chat/useStartBlankSession"

import {orderAgentsLikeMainSidebar, useMainSidebarChatCounts} from "./agentOrder"
import {AgentSidebarSwitcher, type SwitcherCurrent} from "./AgentSidebarSwitcher"
import {currentSidebar, openAgentSidebar, useSelectedSidebar} from "./selectedSidebar"
import {switchTarget} from "./switchAgent"

/** The first page of one agent's session list, with the total. Under the list's own key prefix,
 * so renames, archives and new turns refresh it too. */
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

/**
 * The switcher, connected: the agents the person can see, in the main sidebar's order, and a
 * pick that keeps the same kind of page (see `switchTarget`) and shows the picked agent's
 * sidebar. The agent sidebar and the builder sidebar both use it.
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
    const chatCounts = useMainSidebarChatCounts()
    const agents = useMemo(
        () => orderAgentsLikeMainSidebar(catalog, chatCounts),
        [catalog, chatCounts],
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
        />
    )
}
