import {queryWorkflowRevisionsByWorkflows, type Workflow} from "@agenta/entities/workflow"
import {useQueries} from "@tanstack/react-query"

/** One evaluator's history is short; this covers it in one request. */
const LIMIT = 100

/**
 * The revisions of each expanded evaluator, fetched on first expand and cached per evaluator.
 * Managed revisions only, as the list is.
 */
export const useOlderRevisions = ({
    projectId,
    workflowIds,
}: {
    projectId: string
    workflowIds: readonly string[]
}) => {
    const queries = useQueries({
        queries: workflowIds.map((workflowId) => ({
            queryKey: ["workflows", "evaluators", "m", "older", projectId, workflowId],
            queryFn: async () =>
                (
                    await queryWorkflowRevisionsByWorkflows(
                        [workflowId],
                        projectId,
                        {is_evaluator: true, is_managed: true},
                        {limit: LIMIT, order: "descending"},
                    )
                ).workflow_revisions,
            enabled: Boolean(projectId),
            staleTime: 30_000,
        })),
    })

    const byWorkflow = new Map<string, Workflow[]>()
    const loading = new Set<string>()
    workflowIds.forEach((workflowId, index) => {
        const query = queries[index]
        if (query?.data) byWorkflow.set(workflowId, query.data)
        if (query?.isPending) loading.add(workflowId)
    })
    return {byWorkflow, loading}
}
