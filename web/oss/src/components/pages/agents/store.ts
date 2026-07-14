import {
    fetchAndClassifyWorkflows,
    filterAgentWorkflows,
    queryWorkflows,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
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

const agentsWorkflowsQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(agentsSearchTermAtom).trim() || undefined

    return {
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
    }
})

export const agentsWorkflowsAtom = atom((get) => get(agentsWorkflowsQueryAtom).data ?? [])

export const agentsWorkflowsLoadingAtom = atom((get) => get(agentsWorkflowsQueryAtom).isPending)

export async function invalidateAgentsWorkflowQueries() {
    await queryClient.invalidateQueries({queryKey: AGENTS_WORKFLOWS_QUERY_KEY, exact: false})
}

export const refetchAgentsWorkflowsAtom = atom(null, async () => {
    await invalidateAgentsWorkflowQueries()
})
