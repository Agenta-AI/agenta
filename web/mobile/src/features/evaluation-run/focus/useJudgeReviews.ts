import {useCallback, useMemo, useState} from "react"

import {
    createAnnotation,
    queryAnnotations,
    updateAnnotation,
    type Annotation,
} from "@agenta/entities/annotation"
import {
    buildJudgeReview,
    JUDGE_REVIEW_LINK_KEY,
    readJudgeReview,
    type JudgeVerdict,
} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
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
    /** The judge's outputs on this test case, by output field. */
    outputs: Record<string, unknown>
}

/** One saved review of a judge's result. */
export interface JudgeReview {
    judgeId: string
    verdict: JudgeVerdict
    note: string | null
    authorId: string | null
    at: string | null
    annotation: Annotation
}

/** The judges of a test case: the results that are not human, with their step's references. */
export function scenarioJudges(
    row: ScenarioRow,
    groups: readonly RunColumnGroup[],
    judgeResults: readonly ScenarioEvaluatorResult[],
): ScenarioJudge[] {
    const refsOf = new Map(groups.map(({group}) => [group.key, group.refs]))
    return judgeResults.map((result) => {
        const refs = refsOf.get(result.id) ?? null
        return {
            id: result.id,
            name: result.name,
            slug: refs?.evaluator?.slug ?? refs?.evaluator_variant?.slug ?? null,
            evaluatorId: refs?.evaluator?.id ?? null,
            variantId: refs?.evaluator_variant?.id ?? null,
            revisionId: refs?.evaluator_revision?.id ?? null,
            traceId: result.step?.traceId ?? null,
            spanId: result.step?.spanId ?? null,
            failed: result.summary.failed,
            outputs: Object.fromEntries(
                (row.cells[result.id] ?? []).flatMap((cell) => {
                    const value = scenarioMetricValue(cell.value)
                    return value === undefined ? [] : [[cell.name, value]]
                }),
            ),
        }
    })
}

export const judgeReviewsQueryKey = (projectId: string, traceIds: readonly string[]) => [
    "evaluationRun",
    "judgeReviews",
    projectId,
    ...traceIds,
]

/**
 * The saved reviews of the judges of one test case, read by the judges' result traces. A review
 * belongs to its author: `own` holds the current user's review of each judge.
 */
export function useJudgeReviews(judges: readonly ScenarioJudge[]) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // The profile `id`, which an annotation stores as its author (not the login uid).
    const userId = useAtomValue(userAtom)?.id ?? null
    const traceIds = useMemo(() => judges.flatMap((judge) => judge.traceId ?? []).sort(), [judges])
    const query = useQuery({
        queryKey: judgeReviewsQueryKey(projectId, traceIds),
        enabled: Boolean(projectId) && traceIds.length > 0,
        queryFn: async () =>
            (
                await queryAnnotations({
                    projectId,
                    annotationLinks: traceIds.map((trace_id) => ({trace_id})),
                })
            ).annotations,
    })
    const {byJudge, own} = useMemo(() => {
        const judgeOfTrace = new Map(
            judges.flatMap((judge) => (judge.traceId ? [[judge.traceId, judge.id]] : [])),
        )
        const all = new Map<string, JudgeReview[]>()
        const mine = new Map<string, JudgeReview>()
        for (const annotation of query.data ?? []) {
            const review = readJudgeReview(annotation)
            const traceId = annotation.links?.[JUDGE_REVIEW_LINK_KEY]?.trace_id
            const judgeId = traceId ? judgeOfTrace.get(traceId) : undefined
            if (!review || !judgeId) continue
            const item: JudgeReview = {
                judgeId,
                ...review,
                authorId: annotation.created_by_id ?? null,
                at: annotation.updated_at ?? annotation.created_at ?? null,
                annotation,
            }
            all.set(judgeId, [...(all.get(judgeId) ?? []), item])
            if (userId && item.authorId === userId) mine.set(judgeId, item)
        }
        return {byJudge: all, own: mine}
    }, [query.data, judges, userId])
    return {byJudge, own, isError: query.isError, refetch: query.refetch}
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
    const [edits, setEdits] = useState<Record<string, ReviewDraft>>({})

    const draftFor = useCallback(
        (judgeId: string): ReviewDraft | null => edits[judgeId] ?? draftOf(own.get(judgeId)),
        [edits, own],
    )
    const changed = judges.filter(
        (judge) => edits[judge.id] && !sameDraft(edits[judge.id], draftOf(own.get(judge.id))),
    )
    const setDraft = useCallback(
        (judgeId: string, next: ReviewDraft) => setEdits((prev) => ({...prev, [judgeId]: next})),
        [],
    )

    const saveOne = async (judge: ScenarioJudge) => {
        const draft = edits[judge.id]
        if (!judge.evaluatorId || !judge.traceId || !judge.spanId) {
            throw new Error(`The result of ${judge.name} has no trace to review`)
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
        setEdits((prev) => {
            const {[judge.id]: _saved, ...rest} = prev
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
            await queryClient.invalidateQueries({queryKey: ["evaluationRun", "judgeReviews"]})
        }
    }

    return {draftFor, setDraft, changedCount: changed.length, save, reset: () => setEdits({})}
}
