import {
    fetchAndClassifyWorkflows,
    filterAgentWorkflows,
    queryWorkflows,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {atom, useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

export const agentsSearchTermAtom = atom("")
const AGENTS_WORKFLOWS_QUERY_KEY = ["agents-workflows"] as const

const mapWorkflowToRow = (workflow: Workflow): AppWorkflowRow => ({
    key: workflow.id,
    workflowId: workflow.id,
    name: workflow.name ?? workflow.slug ?? workflow.id,
    appType: "agent",
    isEvaluator: false,
    updatedAt: workflow.updated_at ?? workflow.created_at ?? null,
    createdAt: workflow.created_at ?? null,
    createdById: workflow.created_by_id ?? null,
})

/** One definition of the agents list query, shared by the atom and the hook below. */
const agentsWorkflowsQueryOptions = (projectId: string | null, searchTerm?: string) => ({
    queryKey: [...AGENTS_WORKFLOWS_QUERY_KEY, projectId, searchTerm ?? null],
    queryFn: async (): Promise<AppWorkflowRow[]> => {
        if (!projectId) return []

        const response = await queryWorkflows({
            projectId,
            name: searchTerm,
            flags: {is_evaluator: false},
            includeArchived: false,
            windowing: {order: "descending"},
        })

        const workflows = await fetchAndClassifyWorkflows(
            projectId,
            response.workflows,
            filterAgentWorkflows,
        )

        return workflows.map(mapWorkflowToRow)
    },
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
})

const agentsWorkflowsQueryAtom = atomWithQuery((get) =>
    agentsWorkflowsQueryOptions(get(projectIdAtom), get(agentsSearchTermAtom).trim() || undefined),
)

export const agentsWorkflowsAtom = atom((get) => get(agentsWorkflowsQueryAtom).data ?? [])

export const agentsWorkflowsLoadingAtom = atom((get) => get(agentsWorkflowsQueryAtom).isPending)

/**
 * Is this project's agent list empty, and do we KNOW it? For the first-run redirect, which must
 * decide on mount. `agentsWorkflowsAtom` can't serve that: jotai replays an unmounted atom's last
 * value — data and freshness flags alike — until a dependency changes, so a remount would see the
 * previous visit's snapshot. A `useQuery` observer attaches during the mount render instead.
 */
export const useAgentsFirstRun = () => {
    const projectId = useAtomValue(projectIdAtom)
    // Deliberately unfiltered: existence is not a question about the agents table's search box.
    const query = useQuery(agentsWorkflowsQueryOptions(projectId))
    const isEmpty = (query.data ?? []).length === 0
    // An empty list only counts once confirmed; an error counts too, so a failing fetch can't strand us.
    const settled = query.isError || (query.isSuccess && !query.isFetching && !query.isStale)

    return {isEmpty, firstRun: isEmpty && settled}
}

export async function invalidateAgentsWorkflowQueries() {
    await queryClient.invalidateQueries({queryKey: AGENTS_WORKFLOWS_QUERY_KEY, exact: false})
}

interface CreatedAgentSeed {
    workflowId: string
    name: string
    createdAt?: string | null
    createdById?: string | null
}

/** Unfiltered lists only — a new agent may not match whatever the agents table last searched for. */
const unfilteredList = (query: {queryKey: readonly unknown[]}) =>
    query.queryKey[query.queryKey.length - 1] === null

function seedCreatedAgentRow(agent: CreatedAgentSeed) {
    queryClient.setQueriesData<AppWorkflowRow[]>(
        {
            queryKey: AGENTS_WORKFLOWS_QUERY_KEY,
            exact: false,
            predicate: unfilteredList,
        },
        (rows) => {
            if (!rows || rows.some((row) => row.workflowId === agent.workflowId)) return rows
            const row: AppWorkflowRow = {
                key: agent.workflowId,
                workflowId: agent.workflowId,
                name: agent.name,
                appType: "agent",
                isEvaluator: false,
                updatedAt: agent.createdAt ?? null,
                createdAt: agent.createdAt ?? null,
                createdById: agent.createdById ?? null,
            }
            // The query sorts newest-first.
            return [row, ...rows]
        },
    )
}

/**
 * Publish a just-created agent to the list Home decides on. Seeded twice around the refetch: the
 * commit leaves nothing subscribed (so `refetchType: "all"`), and the response can land before the
 * backend classifies the new revision, which would cache an empty list as fresh for the staleTime.
 */
export async function registerCreatedAgent(agent: CreatedAgentSeed) {
    seedCreatedAgentRow(agent)
    await queryClient.invalidateQueries({
        queryKey: AGENTS_WORKFLOWS_QUERY_KEY,
        exact: false,
        predicate: unfilteredList,
        refetchType: "all",
    })
    seedCreatedAgentRow(agent)
}

export const refetchAgentsWorkflowsAtom = atom(null, async () => {
    await invalidateAgentsWorkflowQueries()
})
