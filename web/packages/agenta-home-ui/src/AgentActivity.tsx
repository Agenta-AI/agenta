import {timeAgo} from "@agenta/shared/utils"
import {SimpleTooltip, Skeleton} from "@agenta/ui/ui"

import {useAgentLastSession} from "./useAgentActivity"

/**
 * When this agent last ran — the roster's only operational column.
 *
 * "Last modified" says when someone edited the agent's configuration, which is a different
 * question from whether the agent is doing anything, and the roster used to answer only the
 * first one (twice, next to "Created at").
 */
export const AgentActivity = ({agentId}: {agentId: string}) => {
    const {session, isPending} = useAgentLastSession(agentId)

    if (isPending) return <Skeleton className="h-4 w-16" />

    // Nothing at all: an agent that has never run has no activity to report, and a placeholder
    // dash reads as a value that failed to load rather than as an absence.
    if (!session) return null

    const activity = session.updated_at ?? session.created_at
    const label = session.name?.trim() || "Untitled session"

    return (
        <SimpleTooltip title={label}>
            <span className="text-xs text-colorText">
                {activity ? timeAgo(Date.parse(activity)) : "—"}
            </span>
        </SimpleTooltip>
    )
}
