import {useEffect, useState, type ReactNode} from "react"

import {applySessionScopeAtom, type SessionScope} from "@agenta/sessions/state"
import {useSetAtom} from "jotai"

import {sessionScopeFromRouteQuery} from "@/oss/components/pages/sessions/assets/sessionRouteScope"
import SessionsPage from "@/oss/components/pages/sessions/SessionsPage"
import RequireWorkflowKind from "@/oss/components/RequireWorkflowKind"
import {useAppId} from "@/oss/hooks/useAppId"
import {useAppQuery} from "@/oss/state/appState"

interface SessionScopeInitializerProps {
    scope: SessionScope | undefined
    children: ReactNode
}

const SessionScopeInitializer = ({scope, children}: SessionScopeInitializerProps) => {
    const applyScope = useSetAtom(applySessionScopeAtom)
    const [ready, setReady] = useState(!scope)

    useEffect(() => {
        if (scope) applyScope(scope)
        setReady(true)
    }, [applyScope, scope])

    return ready ? children : null
}

/**
 * One agent's sessions, on the agent's own rail — the same page as `/sessions`, scoped by the
 * route rather than by a filter, so it survives a reload and a pasted link.
 *
 * Evaluators are redirected by the guard (`sessions` is disabled for them); the rail only offers
 * this item for agents.
 */
const AgentSessionsRoute = () => {
    const appId = useAppId()
    const query = useAppQuery()
    const scope = sessionScopeFromRouteQuery(query)

    return (
        <RequireWorkflowKind allowed={["app"]} currentRoute="sessions">
            {appId ? (
                <SessionScopeInitializer scope={scope}>
                    <SessionsPage scopedAgentId={appId} />
                </SessionScopeInitializer>
            ) : null}
        </RequireWorkflowKind>
    )
}

export default AgentSessionsRoute
