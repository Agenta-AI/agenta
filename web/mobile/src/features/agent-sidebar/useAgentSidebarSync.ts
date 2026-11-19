import {useEffect, useRef} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {sessionAgentId} from "@agenta/sessions/row"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useSessionHeader} from "../chat/useSessionHeader"

import {routeAgentId, routeSessionId, sidebarAfterRoute} from "./agentSidebarRoute"
import {setSelectedSidebar, showMainSidebar, useSelectedSidebar} from "./selectedSidebar"

const NO_AGENTS = atom({data: [], isPending: true, isError: false} as {
    data: {id: string}[]
    isPending: boolean
    isError: boolean
})

/**
 * Keeps the selected sidebar in step with the page while an agent sidebar shows.
 *
 * - Opening a page that is not an agent page (Home, Settings, the Agents list) shows the main
 *   sidebar. Only a page CHANGE does this: the open button of an agent section shows the agent
 *   sidebar on the page the person is on, whatever that page is.
 * - Opening a page of another agent switches the agent sidebar to that agent. Only a change of
 *   the page's agent does this, so the open button on a session of one agent can show another
 *   agent's sidebar.
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

    const lastPath = useRef(router.asPath)
    useEffect(() => {
        if (lastPath.current === router.asPath) return
        lastPath.current = router.asPath
        const next = sidebarAfterRoute(selectedRef.current, router.pathname, null)
        if (next) setSelectedSidebar(next)
    }, [router.asPath, router.pathname])

    useEffect(() => {
        const next = sidebarAfterRoute(selectedRef.current, router.pathname, pageAgentId)
        if (next) setSelectedSidebar(next)
        // The page's agent only: a new selection on the same page is the person's own choice.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageAgentId])

    const agentShown = selected.kind === "agent"
    const agents = useAtomValue(agentShown ? agentWorkflowsListQueryStateAtom : NO_AGENTS)
    const shownAgentId = agentShown ? selected.agentId : null
    useEffect(() => {
        if (!shownAgentId || agents.isPending || agents.isError) return
        if (!agents.data.some((agent) => agent.id === shownAgentId)) showMainSidebar()
    }, [agents, shownAgentId])
}
