import {queryAnnotations} from "@agenta/entities/annotation"
import {
    evaluationRunQueryAtomFamily,
    isHumanOrigin,
    JUDGE_REVIEW_LINK_KEY,
    queryEvaluationResults,
    readJudgeReview,
    type JudgeVerdict,
} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/** One saved review of a run's judge on one scenario. */
export interface RunReview {
    scenarioId: string
    /** The judge's slug, else the last part of its step key. */
    judge: string
    verdict: JudgeVerdict
}

/** Links per annotation query: one request reads the reviews of this many judge results. */
const LINKS_PER_QUERY = 100

/**
 * Every saved review of the run's judges: the judges' results give their traces, and the
 * annotations linked to those traces with a `meta.verdict` are the reviews. The overview's
 * "Evaluator agreement" tile and the Scenarios "Reviews" column count them.
 */
export function useRunReviews(runId: string) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const steps = useAtomValue(evaluationRunQueryAtomFamily(runId)).data?.data?.steps ?? []
    const judges = steps.filter((step) => step.type === "annotation" && !isHumanOrigin(step.origin))
    const judgeOf = new Map(
        judges.map((step) => [
            step.key,
            step.references?.evaluator?.slug ?? step.key.split(".").at(-1) ?? step.key,
        ]),
    )
    const stepKeys = [...judgeOf.keys()].sort()

    const query = useQuery({
        queryKey: ["evaluationRun", "judgeReviews", "run", projectId, runId, ...stepKeys],
        enabled: Boolean(projectId) && stepKeys.length > 0,
        queryFn: async (): Promise<RunReview[]> => {
            const results = await queryEvaluationResults({projectId, runId, stepKeys})
            const byTrace = new Map(
                results.flatMap((result) =>
                    result.trace_id && result.scenario_id
                        ? [
                              [
                                  result.trace_id,
                                  {scenarioId: result.scenario_id, step: result.step_key},
                              ],
                          ]
                        : [],
                ),
            )
            const traceIds = [...byTrace.keys()]
            const pages = await Promise.all(
                Array.from({length: Math.ceil(traceIds.length / LINKS_PER_QUERY)}, (_, page) =>
                    queryAnnotations({
                        projectId,
                        annotationLinks: traceIds
                            .slice(page * LINKS_PER_QUERY, (page + 1) * LINKS_PER_QUERY)
                            .map((trace_id) => ({trace_id})),
                    }),
                ),
            )
            return pages.flatMap(({annotations}) =>
                annotations.flatMap((annotation) => {
                    const review = readJudgeReview(annotation)
                    const traceId = annotation.links?.[JUDGE_REVIEW_LINK_KEY]?.trace_id
                    const target = traceId ? byTrace.get(traceId) : undefined
                    const judge = target ? judgeOf.get(target.step) : undefined
                    return review && target && judge
                        ? [{scenarioId: target.scenarioId, judge, verdict: review.verdict}]
                        : []
                }),
            )
        },
    })
    return {reviews: query.data ?? [], isPending: query.isPending && stepKeys.length > 0}
}
