import {
    fetchWorkflowsBatch,
    queryWorkflows,
    selectEvaluators,
    type EvaluatorCategory,
    type EvaluatorEntry,
    type EvaluatorListMode,
} from "@agenta/entities/workflow"
import {keepPreviousData, useQuery} from "@tanstack/react-query"

/** Under `workflows`, so an archive or a restore refreshes the lists. */
export const EVALUATORS_QUERY_KEY = (
    mode: EvaluatorListMode,
    projectId: string,
    category: EvaluatorCategory,
    search: string,
) => ["workflows", "evaluators", "m", mode, projectId, category, search] as const

/** Stable, so a screen memoising on `entries` does not recompute on every render without data. */
const NONE: EvaluatorEntry[] = []

/**
 * Two requests: the evaluator workflows, then their latest revisions. The kind of an evaluator
 * (human or automatic) and whether the platform manages it live on the revision, so the list
 * cannot be cut before the second request.
 */
const fetchEvaluatorEntries = async (
    projectId: string,
    category: EvaluatorCategory,
    search: string,
    mode: EvaluatorListMode,
): Promise<EvaluatorEntry[]> => {
    const response = await queryWorkflows({
        projectId,
        flags: {is_evaluator: true},
        name: search || undefined,
        includeArchived: mode === "archived",
    })
    const workflows = response.workflows ?? []
    if (workflows.length === 0) return []
    const latestRevisions = await fetchWorkflowsBatch(
        projectId,
        workflows.map((workflow) => workflow.id),
    )
    return selectEvaluators(workflows, latestRevisions, {category, mode})
}

export const useEvaluatorEntries = ({
    mode,
    projectId,
    category,
    search,
}: {
    mode: EvaluatorListMode
    projectId: string
    category: EvaluatorCategory
    search: string
}) => {
    const query = useQuery({
        queryKey: EVALUATORS_QUERY_KEY(mode, projectId, category, search),
        queryFn: () => fetchEvaluatorEntries(projectId, category, search, mode),
        enabled: Boolean(projectId),
        // Keep the last rows on screen while a new search loads, so typing does not blank the list.
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    })

    return {
        entries: query.data ?? NONE,
        isPending: query.isPending,
        isError: query.isError,
        refetch: query.refetch,
    }
}

/** The live evaluators of one category. */
export const useEvaluators = (args: {
    projectId: string
    category: EvaluatorCategory
    search: string
}) => useEvaluatorEntries({...args, mode: "active"})
