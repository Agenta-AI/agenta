import {useMemo} from "react"

import {
    compareCandidates,
    queryEvaluationRunsPage,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {useQuery} from "@tanstack/react-query"

import {RUNS_LIST_KEY} from "../../evaluations/list/runsListKey"

/** The newest runs of the project that the picker checks. */
export const COMPARE_CANDIDATE_WINDOW = 100

/**
 * The runs `base` can be compared with: finished runs among the newest 100 of the project that
 * share a test set and an evaluator with it (`compareCandidates`). The picker mounts this when it
 * opens, so the page itself sends no request for it.
 */
export const useCompareCandidates = ({
    projectId,
    base,
}: {
    projectId: string
    base: EvaluationRun
}) => {
    const query = useQuery({
        queryKey: [...RUNS_LIST_KEY, "compare-candidates", projectId],
        queryFn: () => queryEvaluationRunsPage({projectId, limit: COMPARE_CANDIDATE_WINDOW}),
    })
    const runs = query.data?.runs
    const candidates = useMemo(() => (runs ? compareCandidates(base, runs) : []), [base, runs])

    return {
        candidates,
        isPending: query.isPending,
        isError: query.isError,
        refetch: query.refetch,
    }
}
