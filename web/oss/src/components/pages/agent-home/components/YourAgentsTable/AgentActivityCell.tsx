import {timeAgo} from "@agenta/shared/utils"
import {Skeleton, Tooltip} from "antd"

import {useAgentLastSession} from "./useAgentActivity"

/**
 * When this agent last ran — the roster's only operational column.
 *
 * "Last modified" says when someone edited the agent's configuration, which is a different
 * question from whether the agent is doing anything, and the table used to answer only the
 * first one (twice, next to "Created at").
 */
const AgentActivityCell = ({agentId}: {agentId: string}) => {
    const {session, isPending} = useAgentLastSession(agentId)

    if (isPending) return <Skeleton.Input active size="small" className="!h-4 !min-w-16" />

    // Nothing at all: an agent that has never run has no activity to report, and a placeholder
    // dash reads as a value that failed to load rather than as an absence.
    if (!session) return null

    const activity = session.updated_at ?? session.created_at
    const label = session.name?.trim() || "Untitled session"

    return (
        <Tooltip title={label}>
            <span className="text-xs text-colorText">
                {activity ? timeAgo(Date.parse(activity)) : "—"}
            </span>
        </Tooltip>
    )
}

export default AgentActivityCell
