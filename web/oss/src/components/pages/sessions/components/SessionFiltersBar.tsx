import {useSessionFilters} from "@agenta/sessions/state"
import {
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusControl,
} from "@agenta/sessions-ui"
import {Select} from "antd"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "../../agents/store"

interface Props {
    waitingCount: number | undefined
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
}

/**
 * The session filters as a toolbar above the list — the SHELL. The controls themselves come from
 * `@agenta/sessions-ui` and bind to the shared filter atoms, so this file owns only the row and
 * the agent picker (antd `Select`, which stays app-injected until the EntityPicker migrates off
 * antd).
 */
const SessionFiltersBar = ({waitingCount, hideAgentFilter}: Props) => {
    const {agentId, setAgentId} = useSessionFilters()
    const agents = useAtomValue(agentsWorkflowsAtom)

    return (
        <div className="flex flex-wrap items-center gap-3 pb-3">
            <SessionSearchControl className="w-64" />

            {hideAgentFilter ? null : (
                <Select
                    allowClear
                    value={agentId}
                    onChange={(value) => setAgentId(value ?? null)}
                    placeholder="All agents"
                    className="w-48"
                    options={agents.map((agent) => ({
                        value: agent.workflowId,
                        label: agent.name,
                    }))}
                />
            )}

            <SessionStatusControl waitingCount={waitingCount} />

            {/* Two different kinds of switch: one picks WHICH sessions, the other widens the set.
                The tooltips carry that distinction now that no group headings do. */}
            <SessionModeControl />
            <SessionArchivedControl />
        </div>
    )
}

export default SessionFiltersBar
