import {AgentChip} from "@agenta/entity-ui/agent"
import {projectIdAtom} from "@agenta/shared/state"
import {querySkillReferencedBy} from "@agenta/skills"
import {skillUsageQueryKey} from "@agenta/skills-ui"
import {IconTile} from "@agenta/ui/composed"
import {Robot} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {usedByLabel} from "./skillListView"

/** One agent: its Mark and name. Several: the general agent Mark and the count. None: "No agents". */
export const SkillUsedByCell = ({workflowId, count}: {workflowId: string; count: number}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // Only a single user is named, so only that row asks who it is (the skill view's own query).
    const usage = useQuery({
        queryKey: skillUsageQueryKey(projectId, workflowId),
        queryFn: () => querySkillReferencedBy({projectId, workflowId}),
        enabled: count === 1 && Boolean(projectId && workflowId),
        staleTime: 15_000,
    })
    if (count === 0) {
        return (
            <span className="block truncate text-body-sm text-muted-foreground">
                {usedByLabel(0)}
            </span>
        )
    }
    const agent = count === 1 ? usage.data?.referenced_by?.[0] : undefined
    const name = agent ? (agent.agent_name ?? agent.agent_slug ?? "") : ""
    return (
        <span className="flex min-w-0 items-center gap-2">
            {agent ? (
                <AgentChip workflowId={agent.agent_workflow_id ?? null} size={20} />
            ) : (
                <IconTile size={20} aria-hidden>
                    <Robot />
                </IconTile>
            )}
            <span className="truncate text-body-sm text-foreground" title={name || undefined}>
                {name || usedByLabel(count)}
            </span>
        </span>
    )
}
