import {useMemo} from "react"

import {
    evaluationRunsListQueryKey,
    isRunInProgress,
    queryEvaluationRunsPage,
    seedEvaluationRunCache,
    type EvaluationRun,
    type EvaluationRunReferenceFilter,
} from "@agenta/entities/evaluationRun"
import {resolveRangePreset} from "@agenta/observability"
import {useInfiniteQuery, useQueryClient} from "@tanstack/react-query"

import type {EvaluationKindTab, RunFilterValues} from "./useEvaluationRunsFilters"

export const EVALUATION_RUNS_PAGE_SIZE = 30
export const EVALUATION_RUNS_POLL_MS = 5_000

const NONE: EvaluationRun[] = []

/** The panel's ids as the references a run must have. */
const runReferences = (
    references: RunFilterValues["references"],
): EvaluationRunReferenceFilter[] => [
    ...references.evaluator.map((id) => ({evaluator: {id}})),
    ...references.testset.map((id) => ({testset: {id}})),
    ...references.query.map((id) => ({query: {id}})),
    ...references.variant.map((id) => ({application_variant: {id}})),
]

/**
 * Runs that come from traces or test cases belong to Annotation queues, not to the evaluations
 * list. The server drops them, so a page stays full. Live runs read from a query, so they stay.
 */
const NOT_DIRECT_QUEUE = {has_testcases: false, has_traces: false}

/**
 * The runs list, 30 at a time. Search, status, app, the queue exclusion, the references (evaluators, test sets, queries,
 * variants) and the date range go to the server; the kind tab, or the Type filter on the All tab,
 * is applied by the package, which fills a page that it would leave short. The list refreshes every five seconds
 * while a run is in progress.
 */
export const useEvaluationRunsList = ({
    projectId,
    kind,
    appId,
    search,
    panel,
}: {
    projectId: string
    kind: EvaluationKindTab
    appId: string | null
    search: string
    panel: RunFilterValues
}) => {
    const queryClient = useQueryClient()
    const name = search.trim() || undefined
    const references = runReferences(panel.references)
    const kinds = kind === "all" ? panel.types : [kind]
    // Resolved once per pick, so the window and the query key stay put while the list polls.
    const createdAfter = useMemo(
        () => (panel.range ? resolveRangePreset(panel.range).sorted : undefined),
        [panel.range],
    )
    const filters = {
        name,
        statuses: panel.statuses.length > 0 ? [...panel.statuses] : undefined,
        appId: appId ?? undefined,
        kinds: kinds.length > 0 ? kinds : undefined,
        references: references.length > 0 ? references : undefined,
        createdAfter,
        flags: NOT_DIRECT_QUEUE,
    }

    const query = useInfiniteQuery({
        queryKey: evaluationRunsListQueryKey(projectId, filters),
        initialPageParam: null as string | null,
        queryFn: async ({pageParam}) => {
            const page = await queryEvaluationRunsPage({
                projectId,
                limit: EVALUATION_RUNS_PAGE_SIZE,
                cursor: pageParam,
                ...filters,
            })
            seedEvaluationRunCache(queryClient, page.runs)
            return page
        },
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        enabled: Boolean(projectId),
        refetchInterval: (current) =>
            current.state.data?.pages.some((page) => page.runs.some(isRunInProgress))
                ? EVALUATION_RUNS_POLL_MS
                : false,
    })

    const runs = query.data ? query.data.pages.flatMap((page) => page.runs) : NONE

    return {
        runs,
        isPending: query.isPending,
        // A failed refresh or "Load more" keeps the rows. Only a list with nothing to show errors.
        isError: query.isError && query.data === undefined,
        refetch: query.refetch,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        fetchNextPage: query.fetchNextPage,
    }
}
