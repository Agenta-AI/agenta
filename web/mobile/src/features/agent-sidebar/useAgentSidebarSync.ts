import {useEffect, useRef} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {sessionAgentId} from "@agenta/sessions/row"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useSessionHeader} from "../chat/useSessionHeader"

import {routeAgentId, routeSessionId, sidebarAfterRoute} from "./agentSidebarRoute"
import {
    currentSidebar,
    openMainSidebar,
    setSelectedSidebar,
    useSelectedSidebar,
    type SelectedSidebar,
} from "./selectedSidebar"

/** The last path the sync saw in this tab; null until the first page (a load or a reload). */
let lastSeenPath: string | null = null

/**
 * Keeps the selected sidebar in step with the page while an agent sidebar shows. The app shell
 * of each screen runs it.
 *
 * - A page change to a page that does not belong to an agent (Home, Settings, the Agents list)
 *   shows the main sidebar; a page change to a page of another agent switches the agent sidebar
 *   to that agent. Without a page change nothing moves: the open button of an agent section
 *   shows that agent's sidebar on the page the person is on, and a reload keeps it.
 * - A session's agent may arrive after the page change (its row loads). When it arrives and it
 *   is another agent, the agent sidebar switches to it.
 * - An agent the person can no longer see (archived, deleted, made private) gives the main
 *   sidebar back.
 *
 * A session page names its agent in `?agent=` only when it was just started; otherwise the
 * agent comes from the session's row, the same query the chat screen reads (no extra request).
 */
export const useAgentSidebarSync = (projectId: string) => {
    const router = useRouter()
    const selected = useSelectedSidebar()
    const selectedRef = useRef(selected)
    selectedRef.current = selected

    const fromRoute = routeAgentId(router.pathname, router.query)
    const sessionId = fromRoute ? null : routeSessionId(router.pathname, router.query)
    const header = useSessionHeader(projectId, sessionId ?? "")
    const pageAgentId = fromRoute ?? (sessionId && header.data ? sessionAgentId(header.data) : null)
    const pageAgentRef = useRef(pageAgentId)
    pageAgentRef.current = pageAgentId

    // A page change, with the page's agent if it is already known. If it is not, the effect
    // below applies it when it arrives. Each screen mounts its own app shell, so the last path
    // lives outside the component: a new screen's first run still sees the page change.
    const awaitingAgent = useRef<SelectedSidebar | null>(null)
    useEffect(() => {
        if (lastSeenPath === null) {
            lastSeenPath = router.asPath
            return
        }
        if (lastSeenPath === router.asPath) return
        lastSeenPath = router.asPath
        const next = sidebarAfterRoute(selectedRef.current, router.pathname, pageAgentRef.current)
        if (next) setSelectedSidebar(next)
        // Wait for the agent only while the choice stays the one this page change left.
        awaitingAgent.current = pageAgentRef.current === null ? currentSidebar() : null
    }, [router.asPath, router.pathname])

    useEffect(() => {
        if (!pageAgentId || !awaitingAgent.current) return
        const waitingFor = awaitingAgent.current
        awaitingAgent.current = null
        // A choice the person made meanwhile (an open button, a switcher pick) wins.
        if (currentSidebar() !== waitingFor) return
        const next = sidebarAfterRoute(selectedRef.current, router.pathname, pageAgentId)
        if (next) setSelectedSidebar(next)
    }, [pageAgentId, router.pathname])

    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const shownAgentId = selected.kind === "agent" ? selected.agentId : null
    useEffect(() => {
        if (!shownAgentId || agents.isPending || agents.isError) return
        if (!agents.data.some((agent) => agent.id === shownAgentId)) openMainSidebar()
    }, [agents, shownAgentId])
}
