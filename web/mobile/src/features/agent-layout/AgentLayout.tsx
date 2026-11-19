import {useMemo} from "react"

import {AgentLayoutBody, type AgentLayoutProps} from "./AgentLayoutBody"
import {LeaveGuardProvider} from "./leaveGuard"

/** True when a route leaves the agent on screen (another agent, or a page that is not an agent's). */
const leavesAgentFor = (agentId: string | null, sessionId: string) => (url: string) => {
    const path = url.split("?")[0]
    if (path.includes(`/sessions/${sessionId}`)) return false
    return !(agentId && path.includes(`/agents/${agentId}`))
}

/**
 * The agent layout host: the leave guard, the session header and the one right panel beside the
 * conversation. The panel shows Files, Configuration or Builder, one at a time.
 */
export const AgentLayout = (props: AgentLayoutProps) => {
    const {agentId, sessionId} = props
    // Another session of the same agent keeps the panel; the session route decides the rest.
    const leavesAgent = useMemo(() => leavesAgentFor(agentId, sessionId), [agentId, sessionId])
    return (
        <LeaveGuardProvider leavesAgent={leavesAgent}>
            <AgentLayoutBody {...props} />
        </LeaveGuardProvider>
    )
}
