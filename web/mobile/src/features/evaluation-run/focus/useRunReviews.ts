import {queryAnnotations, type Annotation} from "@agenta/entities/annotation"
import {
    annotationStepSlug,
    evaluationRunQueryAtomFamily,
    isHumanOrigin,
    queryEvaluationResults,
    readJudgeReview,
    type JudgeVerdict,
} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/** One saved review of a judge's result. */
export interface JudgeReview {
    /** The judge's result trace on its test case: what the review links. */
    judgeTraceId: string
    verdict: JudgeVerdict
    note: string | null
    authorId: string | null
    at: string | null
    annotation: Annotation
}

/** The first part of every judge review query key: a save reads them all again. */
// Kept apart from the drawer's files: the overview and the Scenarios table load this module.
export const JUDGE_REVIEWS_QUERY_KEY = ["evaluationRun", "judgeReviews"] as const

/**
 * Judge results per request, the page each request asks for (the API's largest), and the
 * requests in flight at once: 10 results hold up to 100 reviewers each before a page is full.
 */
const LINKS_PER_QUERY = 10
const REVIEWS_PER_QUERY = 1000
const QUERIES_AT_ONCE = 4

/**
 * The saved reviews of judge results: the annotations whose inbound `invocation` link names one
 * of the results (`trace.links`; top-level `links` would match the reviews' own ids).
 */
export async function fetchJudgeReviews(
    projectId: string,
    results: readonly {traceId: string; spanId: string}[],
): Promise<JudgeReview[]> {
    const batches: (typeof results)[] = []
    for (let start = 0; start < results.length; start += LINKS_PER_QUERY) {
        batches.push(results.slice(start, start + LINKS_PER_QUERY))
    }
    // A few requests at a time: a large run has many batches.
    const pages: Awaited<ReturnType<typeof queryAnnotations>>[] = []
    for (let start = 0; start < batches.length; start += QUERIES_AT_ONCE) {
        pages.push(
            ...(await Promise.all(
                batches.slice(start, start + QUERIES_AT_ONCE).map((batch) =>
                    queryAnnotations({
                        projectId,
                        windowing: {limit: REVIEWS_PER_QUERY},
                        annotation: {
                            links: batch.map(({traceId, spanId}) => ({
                                trace_id: traceId,
                                span_id: spanId,
                            })),
                        },
                    }),
                ),
            )),
        )
    }
    return pages.flatMap(({annotations}) =>
        annotations.flatMap((annotation) => {
            const review = readJudgeReview(annotation)
            return review?.judgeTraceId
                ? [
                      {
                          judgeTraceId: review.judgeTraceId,
                          verdict: review.verdict,
                          note: review.note,
                          authorId: annotation.created_by_id ?? null,
                          at: annotation.updated_at ?? annotation.created_at ?? null,
                          annotation,
                      },
                  ]
                : []
        }),
    )
}

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
