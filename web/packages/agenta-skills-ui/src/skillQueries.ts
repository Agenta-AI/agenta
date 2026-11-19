import {
    querySkillReferencedBy,
    unarchiveSkill,
    type SkillReferencedByResponse,
} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {useQuery} from "@tanstack/react-query"

export const skillRevisionsQueryKey = (projectId: string, workflowId: string) =>
    ["skills", "revisions", projectId, workflowId] as const

export const skillUsageQueryKey = (projectId: string, workflowId: string) =>
    ["skills", "usage", projectId, workflowId] as const

export const skillUsageQuery = (projectId: string, workflowId: string) => ({
    queryKey: skillUsageQueryKey(projectId, workflowId),
    queryFn: () => querySkillReferencedBy({projectId, workflowId}),
})

export interface SkillUsageAgent {
    /** The agent's workflow id; empty when the API omits it. */
    id: string
    name: string
}

export const usageAgents = (data?: SkillReferencedByResponse): SkillUsageAgent[] =>
    (data?.referenced_by ?? []).map((entry) => ({
        id: entry.agent_workflow_id ?? "",
        name: entry.agent_name ?? entry.agent_slug ?? "Unnamed agent",
    }))

/** The agents that use one skill. */
export const useSkillUsage = (projectId: string, workflowId: string, enabled = true) => {
    const query = useQuery({
        ...skillUsageQuery(projectId, workflowId),
        enabled: Boolean(projectId && workflowId) && enabled,
        staleTime: 15_000,
    })
    return {...query, agents: usageAgents(query.data)}
}

/** Unarchives skills and says how it went; `title` names a single skill in the toast. */
export const restoreSkills = async (projectId: string, workflowIds: string[], title?: string) => {
    const results = await Promise.allSettled(
        workflowIds.map((workflowId) => unarchiveSkill({projectId, workflowId})),
    )
    invalidateSkillsListCache()
    const done = results.filter((result) => result.status === "fulfilled").length
    if (done < workflowIds.length)
        message.error(
            workflowIds.length === 1
                ? "Could not restore this skill"
                : "Could not restore every skill",
        )
    else if (done === 1)
        message.success(`${title ?? "The skill"} is restored. Agents can use it again.`)
    else message.success(`${done} skills are restored. Agents can use them again.`)
}
