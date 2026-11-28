import {
    annotationStepSlug,
    evaluationRunQueryAtomFamily,
    isHumanOrigin,
    queryEvaluationResults,
    type JudgeVerdict,
} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {fetchJudgeReviews, JUDGE_REVIEWS_QUERY_KEY} from "./useJudgeReviews"

/** One saved review of a run's judge on one scenario. */
export interface RunReview {
    scenarioId: string
    /** The judge's slug. */
    judge: string
    verdict: JudgeVerdict
}

/**
 * Every saved review of the run's judges: the judges' results give their traces, and the reviews
 * are the annotations that link those traces. The overview's "Evaluator agreement" tile and the
 * Scenarios "Reviews" column count them.
 */
export function useRunReviews(runId: string) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const steps = useAtomValue(evaluationRunQueryAtomFamily(runId)).data?.data?.steps ?? []
    const judgeOf = new Map(
        steps
            .filter((step) => step.type === "annotation" && !isHumanOrigin(step.origin))
            .map((step) => [step.key, annotationStepSlug(step) ?? step.key]),
    )
    const stepKeys = [...judgeOf.keys()].sort()

    const query = useQuery({
        queryKey: [...JUDGE_REVIEWS_QUERY_KEY, "run", projectId, runId, ...stepKeys],
        enabled: Boolean(projectId) && stepKeys.length > 0,
        queryFn: async (): Promise<RunReview[]> => {
            const results = await queryEvaluationResults({projectId, runId, stepKeys})
            const byTrace = new Map(
                results.flatMap((result) =>
                    result.trace_id && result.span_id
                        ? [[result.trace_id, {result, spanId: result.span_id}]]
                        : [],
                ),
            )
            const reviews = await fetchJudgeReviews(
                projectId,
                [...byTrace].map(([traceId, {spanId}]) => ({traceId, spanId})),
            )
            return reviews.flatMap((review) => {
                const result = byTrace.get(review.judgeTraceId)?.result
                const judge = result ? judgeOf.get(result.step_key) : undefined
                return result && judge
                    ? [{scenarioId: result.scenario_id, judge, verdict: review.verdict}]
                    : []
            })
        },
    })
    return {reviews: query.data ?? []}
}
