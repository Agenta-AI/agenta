import {
    agentWorkflowsListQueryStateAtom,
    ensureAgentFlags,
    promptWorkflowsListQueryStateAtom,
    queryWorkflows,
    selectNonAgentWorkflows,
    type Workflow,
} from "@agenta/entities/workflow"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

export type OverviewApp =
    | {status: "loading"}
    | {status: "error"}
    | {status: "missing"}
    | {status: "agent"}
    | {status: "app"; app: Workflow; archived: boolean}

/**
 * The app behind an id that is in none of the active lists: its archived entry, or null when
 * there is none. An archived agent or evaluator is no app here, so it comes back null too.
 */
const fetchArchivedApp = async (projectId: string, appId: string): Promise<Workflow | null> => {
    const response = await queryWorkflows({
        projectId,
        workflowRefs: [{id: appId}],
        flags: {is_evaluator: false},
        includeArchived: true,
    })
    const archived = (response.workflows ?? []).filter(
        (workflow) => workflow.id === appId && workflow.deleted_at,
    )
    if (archived.length === 0) return null
    const agentFlags = await ensureAgentFlags(projectId)
    return selectNonAgentWorkflows(archived, agentFlags)[0] ?? null
}

/**
 * What an app id on the overview URL is. The answer waits for both lists: until the agent flags
 * load, an agent can sit in the prompts list, and the page would flash prompt sections for it.
 *
 * An id in neither list may be an archived app. Only then does a second request look for it, so
 * an active app costs nothing extra.
 */
export const useOverviewApp = (projectId: string, appId: string): OverviewApp => {
    const prompts = useAtomValue(promptWorkflowsListQueryStateAtom)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const listsSettled =
        !prompts.isError && !agents.isError && !prompts.isPending && !agents.isPending
    const isAgent = listsSettled && agents.data.some((entry) => entry.id === appId)
    const active = listsSettled ? prompts.data.find((entry) => entry.id === appId) : undefined
    const archived = useQuery({
        queryKey: ["workflows", "archived-app-overview", projectId, appId],
        queryFn: () => fetchArchivedApp(projectId, appId),
        enabled: listsSettled && !isAgent && !active && Boolean(projectId && appId),
    })

    if (prompts.isError || agents.isError) return {status: "error"}
    if (prompts.isPending || agents.isPending) return {status: "loading"}
    if (isAgent) return {status: "agent"}
    if (active) return {status: "app", app: active, archived: false}
    if (archived.isPending) return {status: "loading"}
    if (archived.isError) return {status: "error"}
    return archived.data ? {status: "app", app: archived.data, archived: true} : {status: "missing"}
}
