import {
    agentWorkflowsListQueryStateAtom,
    ensureAgentFlags,
    promptWorkflowsListQueryStateAtom,
    queryWorkflows,
    selectNonAgentWorkflows,
    workflowDetailQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {atom, useAtomValue} from "jotai"

export type OverviewApp =
    | {status: "loading"}
    | {status: "error"}
    | {status: "missing"}
    | {status: "agent"}
    | {status: "app"; app: Workflow; archived: boolean}
    | {status: "evaluator"; app: Workflow}

const NO_DETAIL = atom({
    data: null as Workflow | null | undefined,
    isPending: false,
    isError: false,
})

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
 * an active app costs nothing extra. In beta developer mode an id that is no app at all may be an
 * evaluator, which has an overview as in the old app; its detail loads only then.
 */
export const useOverviewApp = (projectId: string, appId: string): OverviewApp => {
    const prompts = useAtomValue(promptWorkflowsListQueryStateAtom)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const listsSettled =
        !prompts.isError && !agents.isError && !prompts.isPending && !agents.isPending
    const isAgent = listsSettled && agents.data.some((entry) => entry.id === appId)
    const active = listsSettled ? prompts.data.find((entry) => entry.id === appId) : undefined
    const archived = useQuery({
        queryKey: ["workflows", "archived-app-overview", projectId, appId],
        queryFn: () => fetchArchivedApp(projectId, appId),
        enabled: listsSettled && !isAgent && !active && Boolean(projectId && appId),
    })
    const notAnApp =
        listsSettled && !isAgent && !active && archived.isSuccess && archived.data === null
    const detail = useAtomValue(beta && notAnApp ? workflowDetailQueryAtomFamily(appId) : NO_DETAIL)

    if (prompts.isError || agents.isError) return {status: "error"}
    if (prompts.isPending || agents.isPending) return {status: "loading"}
    if (isAgent) return {status: "agent"}
    if (active) return {status: "app", app: active, archived: false}
    if (archived.isPending) return {status: "loading"}
    if (archived.isError) return {status: "error"}
    if (archived.data) return {status: "app", app: archived.data, archived: true}
    if (!beta) return {status: "missing"}
    if (detail.isPending) return {status: "loading"}
    if (detail.isError) return {status: "error"}
    const workflow = detail.data
    return workflow?.flags?.is_evaluator && !workflow.deleted_at
        ? {status: "evaluator", app: workflow}
        : {status: "missing"}
}
