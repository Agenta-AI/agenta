import {AgentCardGrid} from "@agenta/entity-ui/agent"

import AgentCard from "@/oss/components/AgentCard"
import type {AgentColumnActions} from "@/oss/components/pages/agent-home/components/YourAgentsTable/columns"
import {useWaitingByAgent} from "@/oss/components/pages/agent-home/components/YourAgentsTable/useAgentActivity"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

/**
 * The agents roster — the SHARED card grid shell (`@agenta/entity-ui/agent`) with the app's
 * mapped cards: the roster rows, the waiting badge, and the shared action set.
 */
const AgentsGrid = ({
    rows,
    isLoading,
    actions,
    onCreate,
}: {
    rows: AppWorkflowRow[]
    isLoading: boolean
    actions: AgentColumnActions
    onCreate: () => void
}) => {
    const waitingByAgent = useWaitingByAgent()

    return (
        <AgentCardGrid isLoading={isLoading} count={rows.length} onCreate={onCreate}>
            {rows.map((record) => (
                <AgentCard
                    key={record.key}
                    variant="grid"
                    record={record}
                    waiting={waitingByAgent.get(record.workflowId) ?? 0}
                    actions={actions}
                />
            ))}
        </AgentCardGrid>
    )
}

export default AgentsGrid
