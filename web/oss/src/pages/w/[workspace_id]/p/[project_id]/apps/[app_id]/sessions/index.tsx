import SessionsPage from "@/oss/components/pages/sessions/SessionsPage"
import RequireWorkflowKind from "@/oss/components/RequireWorkflowKind"
import {useAppId} from "@/oss/hooks/useAppId"

/**
 * One agent's sessions, on the agent's own rail — the same page as `/sessions`, scoped by the
 * route rather than by a filter, so it survives a reload and a pasted link.
 *
 * Evaluators are redirected by the guard (`sessions` is disabled for them); the rail only offers
 * this item for agents.
 */
const AgentSessionsRoute = () => {
    const appId = useAppId()

    return (
        <RequireWorkflowKind allowed={["app"]} currentRoute="sessions">
            {appId ? <SessionsPage scopedAgentId={appId} /> : null}
        </RequireWorkflowKind>
    )
}

export default AgentSessionsRoute
