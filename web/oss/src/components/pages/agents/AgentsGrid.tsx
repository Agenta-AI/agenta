import {AgentRosterGrid, type AgentRosterEntry} from "@agenta/entity-ui/agent"
import {useWaitingByAgent} from "@agenta/sessions/state"

import AgentActivityCell from "@/oss/components/pages/agent-home/components/YourAgentsTable/AgentActivityCell"
import type {AgentColumnActions} from "@/oss/components/pages/agent-home/components/YourAgentsTable/columns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import UserReference from "@/oss/components/References/UserReference"

/**
 * The agents roster — the SHARED roster grid (`@agenta/entity-ui/agent`) with this app's row
 * mapping, its verbs, and the two data-connected cells the package deliberately does not own.
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
    // The card's neutral shape; `record` is recovered by id for the action callbacks.
    const agents: AgentRosterEntry[] = rows.map((record) => ({
        id: record.workflowId,
        name: record.name,
        description: record.description,
        updatedAt: record.updatedAt,
    }))
    const rowById = new Map(rows.map((record) => [record.workflowId, record] as const))
    const withRow = (fn: (record: AppWorkflowRow) => void) => (agent: AgentRosterEntry) => {
        const record = rowById.get(agent.id)
        if (record) fn(record)
    }

    return (
        <AgentRosterGrid
            agents={agents}
            isLoading={isLoading}
            waitingByAgent={waitingByAgent}
            onCreate={onCreate}
            onOpenOverview={withRow((record) => actions.onOpen(record))}
            onOpenPlayground={withRow((record) => actions.onOpenPlayground(record))}
            onRename={withRow((record) => actions.onRename(record))}
            onArchive={withRow((record) => actions.onArchive(record))}
            renderActivity={(agent) => <AgentActivityCell agentId={agent.id} />}
            renderOwner={(agent) => {
                const record = rowById.get(agent.id)
                return record?.createdById ? (
                    <UserReference userId={record.createdById} className="truncate" />
                ) : null
            }}
        />
    )
}

export default AgentsGrid
