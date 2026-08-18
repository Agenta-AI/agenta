import {AgentCard as AgentCardView} from "@agenta/entity-ui/agent"

import AgentActivityCell from "@/oss/components/pages/agent-home/components/YourAgentsTable/AgentActivityCell"
import type {AgentColumnActions} from "@/oss/components/pages/agent-home/components/YourAgentsTable/columns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import UserReference from "@/oss/components/References/UserReference"

/**
 * App adapter over the package card: maps the roster row and shared action set onto the neutral
 * props, and fills the data-connected slots (last activity, creator) the package deliberately
 * doesn't own.
 */
const AgentCard = ({
    record,
    waiting,
    actions,
    variant = "rail",
}: {
    record: AppWorkflowRow
    waiting: number
    actions: AgentColumnActions
    /** `grid` is the Agents page (a wider cell); `rail` is the home column. */
    variant?: "rail" | "grid"
}) => (
    <AgentCardView
        agent={{
            id: record.workflowId,
            name: record.name,
            description: record.description,
            updatedAt: record.updatedAt,
        }}
        waiting={waiting}
        variant={variant}
        activity={<AgentActivityCell agentId={record.workflowId} />}
        owner={
            record.createdById ? (
                <UserReference userId={record.createdById} className="truncate" />
            ) : null
        }
        onOpenOverview={() => actions.onOpen(record)}
        onOpenPlayground={() => actions.onOpenPlayground(record)}
        onRename={() => actions.onRename(record)}
        onArchive={() => actions.onArchive(record)}
    />
)

export default AgentCard
