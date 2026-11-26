import {queryWorkflowRevisionsByWorkflows, type Workflow} from "@agenta/entities/workflow"
import {keepPreviousData, useInfiniteQuery} from "@tanstack/react-query"

const PAGE_SIZE = 50

const NONE: Workflow[] = []

/**
 * The revisions of the given evaluators, a page of 50 at a time across all of them, newest
 * first. Managed revisions only. The New evaluation sheet uses it; the Evaluators list loads
 * revisions per evaluator on expand (`useOlderRevisions`).
 */
export const useEvaluatorRevisions = ({
    projectId,
    workflowIds,
}: {
    projectId: string
    workflowIds: readonly string[]
}) => {
    const query = useInfiniteQuery({
        queryKey: ["workflows", "evaluators", "m", "revisions", projectId, [...workflowIds]],
        queryFn: ({pageParam}) =>
            queryWorkflowRevisionsByWorkflows(
                [...workflowIds],
                projectId,
                {is_evaluator: true, is_managed: true},
                {next: pageParam, limit: PAGE_SIZE, order: "descending"},
            ),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.windowing?.next ?? undefined,
        enabled: Boolean(projectId) && workflowIds.length > 0,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    })

    return {
        revisions: query.data?.pages.flatMap((page) => page.workflow_revisions) ?? NONE,
        isPending: query.isPending && query.fetchStatus !== "idle",
        isError: query.isError,
        hasMore: query.hasNextPage,
        isLoadingMore: query.isFetchingNextPage,
        loadMore: () => void query.fetchNextPage(),
        refetch: query.refetch,
    }
}
