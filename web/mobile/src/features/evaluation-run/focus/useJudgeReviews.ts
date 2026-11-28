import {useCallback, useMemo, useState} from "react"

import {
    createAnnotation,
    queryAnnotations,
    updateAnnotation,
    type Annotation,
} from "@agenta/entities/annotation"
import {
    annotationStepSlug,
    buildJudgeReview,
    readJudgeReview,
    type JudgeVerdict,
} from "@agenta/entities/evaluationRun"
import {
    computeColumnGroup,
    type RunColumnGroup,
    type RunMapping,
    type RunStep,
} from "@agenta/entities/evaluationRun/etl"
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import {scenarioMetricValue, type ScenarioEvaluatorResult} from "./ScenarioFocusResultsTab"

/** One automatic evaluator (a judge) on one test case: what a review of its result names. */
export interface ScenarioJudge {
    /** The key of the group that shows the judge. */
    id: string
    name: string
    slug: string | null
    evaluatorId: string | null
    variantId: string | null
    revisionId: string | null
    traceId: string | null
    spanId: string | null
    failed: boolean
    /** A review can link this result: it has a trace, a span and an evaluator. */
    reviewable: boolean
    /** The judge's outputs on this test case, by output field. */
    outputs: Record<string, unknown>
}

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
export const JUDGE_REVIEWS_QUERY_KEY = ["evaluationRun", "judgeReviews"] as const

/**
 * Judge results per request, and the page each request asks for (the API's largest): 50 results
 * hold up to 20 reviewers each before a page is full.
 */
const LINKS_PER_QUERY = 50
const REVIEWS_PER_QUERY = 1000

/**
 * The saved reviews of judge results: the annotations whose inbound `invocation` link names one
 * of the results (`trace.links`; top-level `links` would match the reviews' own ids).
 */
export async function fetchJudgeReviews(
    projectId: string,
    results: readonly {traceId: string; spanId: string}[],
): Promise<JudgeReview[]> {
    // One request after the other: a large run has many batches.
    const pages = []
    for (let start = 0; start < results.length; start += LINKS_PER_QUERY) {
        pages.push(
            await queryAnnotations({
                projectId,
                windowing: {limit: REVIEWS_PER_QUERY},
                annotation: {
                    links: results
                        .slice(start, start + LINKS_PER_QUERY)
                        .map(({traceId, spanId}) => ({trace_id: traceId, span_id: spanId})),
                },
            }),
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

/** The output field path a mapping reads (`attributes.ag.data.outputs.a.b` -> `a`, `b`). */
const outputPath = (path: string | null | undefined, name: string): string[] => {
    const at = path?.indexOf("outputs.") ?? -1
    return path && at >= 0 ? path.slice(at + "outputs.".length).split(".") : [name]
}

/** `outputs` with `value` at `path`, nested objects made on the way. */
const setAtPath = (
    outputs: Record<string, unknown>,
    path: readonly string[],
    value: unknown,
): Record<string, unknown> => {
    const [head, ...rest] = path
    if (rest.length === 0) return {...outputs, [head]: value}
    const inner = outputs[head]
    return {
        ...outputs,
        [head]: setAtPath(
            inner && typeof inner === "object" && !Array.isArray(inner)
                ? (inner as Record<string, unknown>)
                : {},
            rest,
            value,
        ),
    }
}

/** The judges of a test case: the results that are not human, with their step's references. */
export function scenarioJudges(
    row: ScenarioRow,
    groups: readonly RunColumnGroup[],
    judgeResults: readonly ScenarioEvaluatorResult[],
    run: {steps: readonly RunStep[]; mappings: readonly RunMapping[]},
): ScenarioJudge[] {
    const refsOf = new Map(groups.map(({group}) => [group.key, group.refs]))
    // The output path of each mapped column, by group and column name: a review stores the
    // judge's outputs in their own shape, not under the columns' (dotted) names.
    const groupOfStep = new Map(
        run.steps.map((step) => [step.key, computeColumnGroup(step, "").key]),
    )
    const pathOf = new Map(
        run.mappings.flatMap((mapping) => {
            const group = mapping.step?.key ? groupOfStep.get(mapping.step.key) : undefined
            const name = mapping.column?.name
            return group && name ? [[`${group}|${name}`, outputPath(mapping.step?.path, name)]] : []
        }),
    )
    return judgeResults.map((result) => {
        const refs = refsOf.get(result.id) ?? null
        const traceId = result.step?.traceId ?? null
        const spanId = result.step?.spanId ?? null
        const evaluatorId = refs?.evaluator?.id ?? null
        return {
            id: result.id,
            name: result.name,
            slug: refs ? annotationStepSlug({references: refs}) : null,
            evaluatorId,
            variantId: refs?.evaluator_variant?.id ?? null,
            revisionId: refs?.evaluator_revision?.id ?? null,
            traceId,
            spanId,
            failed: result.summary.failed,
            reviewable: Boolean(traceId && spanId && evaluatorId),
            outputs: (row.cells[result.id] ?? []).reduce<Record<string, unknown>>(
                (outputs, cell) => {
                    const value = scenarioMetricValue(cell.value)
                    if (value === undefined) return outputs
                    const path = pathOf.get(`${result.id}|${cell.name}`) ?? [cell.name]
                    return setAtPath(outputs, path, value)
                },
                {},
            ),
        }
    })
}

/** The judge results a review can link. */
const reviewable = (judges: readonly ScenarioJudge[]) =>
    judges.flatMap((judge) =>
        judge.reviewable && judge.traceId && judge.spanId
            ? [{traceId: judge.traceId, spanId: judge.spanId}]
            : [],
    )

/**
 * The saved reviews of the judges of one test case, by judge. A review belongs to its author:
 * `own` holds the current user's review of each judge.
 */
export function useJudgeReviews(judges: readonly ScenarioJudge[]) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // The profile `id`, which an annotation stores as its author (not the login uid).
    const userId = useAtomValue(userAtom)?.id ?? null
    const results = useMemo(() => reviewable(judges), [judges])
    const query = useQuery({
        queryKey: [...JUDGE_REVIEWS_QUERY_KEY, projectId, ...results.map((r) => r.traceId).sort()],
        enabled: Boolean(projectId) && results.length > 0,
        queryFn: () => fetchJudgeReviews(projectId, results),
    })
    const {byJudge, own} = useMemo(() => {
        const judgeOfTrace = new Map(
            judges.flatMap((judge) => (judge.traceId ? [[judge.traceId, judge.id]] : [])),
        )
        const all = new Map<string, JudgeReview[]>()
        const mine = new Map<string, JudgeReview>()
        for (const review of query.data ?? []) {
            const judgeId = judgeOfTrace.get(review.judgeTraceId)
            if (!judgeId) continue
            all.set(judgeId, [...(all.get(judgeId) ?? []), review])
            if (userId && review.authorId === userId) mine.set(judgeId, review)
        }
        return {byJudge: all, own: mine}
    }, [query.data, judges, userId])
    // Until the saved reviews are known, a save could not tell an update from a new review.
    return {
        byJudge,
        own,
        ready: results.length === 0 || query.isSuccess,
        isError: query.isError,
        refetch: query.refetch,
    }
}

/** What the user set for one judge in the panel, not saved yet. */
export interface ReviewDraft {
    verdict: JudgeVerdict
    /** On "disagree": the output fields the user changed. */
    corrected: Record<string, unknown>
    note: string
}

const draftOf = (review: JudgeReview | undefined): ReviewDraft | null =>
    review
        ? {
              verdict: review.verdict,
              corrected:
                  review.verdict === "disagree" ? (review.annotation.data.outputs ?? {}) : {},
              note: review.note ?? "",
          }
        : null

const sameDraft = (a: ReviewDraft | null, b: ReviewDraft | null) =>
    JSON.stringify(a) === JSON.stringify(b)

/**
 * The panel's reviews of one test case's judges: the user's answers, corrected values and notes,
 * starting from their saved reviews, and a save that creates or updates one annotation per
 * changed judge. Never writes a judge's step result.
 */
export function useJudgeReviewDrafts({
    judges,
    own,
    testset,
    testcaseId,
}: {
    judges: readonly ScenarioJudge[]
    own: ReadonlyMap<string, JudgeReview>
    testset: {testsetId: string; revisionId: string | null} | null
    testcaseId: string | null
}) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()
    // Drafts by judge result (its trace), not by judge: the judge is the same on every test case,
    // so a draft made on one test case never shows or saves on the next.
    const [edits, setEdits] = useState<Record<string, ReviewDraft>>({})
    const keyOf = useCallback(
        (judgeId: string) => {
            const judge = judges.find((item) => item.id === judgeId)
            return judge?.traceId ?? null
        },
        [judges],
    )

    const draftFor = useCallback(
        (judgeId: string): ReviewDraft | null => {
            const key = keyOf(judgeId)
            return (key ? edits[key] : undefined) ?? draftOf(own.get(judgeId))
        },
        [edits, own, keyOf],
    )
    const changed = judges.filter(
        (judge) =>
            judge.traceId &&
            edits[judge.traceId] &&
            !sameDraft(edits[judge.traceId], draftOf(own.get(judge.id))),
    )
    const setDraft = useCallback(
        (judgeId: string, next: ReviewDraft) => {
            const key = keyOf(judgeId)
            if (key) setEdits((prev) => ({...prev, [key]: next}))
        },
        [keyOf],
    )

    const saveOne = async (judge: ScenarioJudge) => {
        const draft = judge.traceId ? edits[judge.traceId] : undefined
        if (!draft || !judge.reviewable || !judge.evaluatorId || !judge.traceId || !judge.spanId) {
            throw new Error(`The result of ${judge.name} cannot be reviewed`)
        }
        const payload = buildJudgeReview({
            judge: {
                evaluatorId: judge.evaluatorId,
                slug: judge.slug,
                variantId: judge.variantId,
                revisionId: judge.revisionId,
                name: judge.name,
            },
            testset,
            testcaseId,
            judgeTrace: {traceId: judge.traceId, spanId: judge.spanId},
            judgeOutputs: judge.outputs,
            verdict: draft.verdict,
            corrected: draft.corrected,
            note: draft.note,
        })
        const mine = own.get(judge.id)
        const saved = mine
            ? await updateAnnotation(projectId, mine.annotation.trace_id, mine.annotation.span_id, {
                  annotation: {
                      data: payload.data,
                      meta: payload.meta,
                      references: payload.references,
                      links: payload.links,
                  },
              })
            : await createAnnotation(projectId, payload)
        if (!saved) throw new Error(`The review of ${judge.name} was not saved`)
        const key = judge.traceId
        setEdits((prev) => {
            const {[key]: _saved, ...rest} = prev
            return rest
        })
    }

    /**
     * Saves each changed review; throws when one fails. A saved review leaves the drafts at once,
     * so a retry after a partly failed save does not create it twice.
     */
    const save = async () => {
        try {
            for (const judge of changed) await saveOne(judge)
        } finally {
            await queryClient.invalidateQueries({queryKey: JUDGE_REVIEWS_QUERY_KEY})
        }
    }

    return {draftFor, setDraft, changedCount: changed.length, save}
}
