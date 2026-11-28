/**
 * A person's review of an automatic evaluator's (a judge's) result on one test case: "agree" or
 * "disagree", a corrected value in the judge's own output fields, and a note. A review is one
 * annotation with origin `human` on the judge; the answer and the note live in its free `meta`
 * (`meta.verdict`, `meta.note`). It links the judge's result trace, so a judge step result never
 * changes. Pure: no request.
 *
 * @packageDocumentation
 */

import type {AnnotationMetaPayload, CreateAnnotationPayload} from "../../annotation/core"

export type JudgeVerdict = "agree" | "disagree"

/** The link key a review uses for the judge's result trace. */
export const JUDGE_REVIEW_LINK_KEY = "invocation"

export interface JudgeReviewInput {
    /** The judge evaluator and the variant and revision the run used. */
    judge: {
        evaluatorId: string
        slug?: string | null
        variantId?: string | null
        revisionId?: string | null
        name?: string | null
    }
    /** The run's test set revision and the test case; null for a run on traces. */
    testset?: {testsetId: string; revisionId?: string | null} | null
    testcaseId?: string | null
    /** The root span of the judge's result trace on this test case. */
    judgeTrace: {traceId: string; spanId: string}
    /** The judge's outputs on this test case, by output field. */
    judgeOutputs: Record<string, unknown>
    verdict: JudgeVerdict
    /** On "disagree", the fields the person changed; every other field keeps the judge's value. */
    corrected?: Record<string, unknown>
    note?: string
}

const ref = (id: string | null | undefined) => (id ? {id} : undefined)

/**
 * The body of `POST /simple/traces/` for a review. "agree" stores the judge's outputs as they are;
 * "disagree" stores them with the corrected fields over them, so a required field the person left
 * alone keeps the judge's value. An empty note is left out.
 */
export function buildJudgeReview(input: JudgeReviewInput): CreateAnnotationPayload {
    const {judge, testset, testcaseId, judgeTrace, judgeOutputs, verdict, corrected, note} = input
    const outputs =
        verdict === "disagree" ? {...judgeOutputs, ...(corrected ?? {})} : {...judgeOutputs}
    const trimmed = note?.trim()
    const meta: AnnotationMetaPayload = {
        name: judge.name ?? judge.slug ?? "",
        verdict,
        ...(trimmed ? {note: trimmed} : {}),
    }
    const testsetRevision = ref(testset?.revisionId)
    const testsetRef = ref(testset?.testsetId)
    const testcase = ref(testcaseId)
    return {
        data: {outputs},
        references: {
            evaluator: {id: judge.evaluatorId, ...(judge.slug ? {slug: judge.slug} : {})},
            ...(judge.variantId ? {evaluator_variant: {id: judge.variantId}} : {}),
            ...(judge.revisionId ? {evaluator_revision: {id: judge.revisionId}} : {}),
            ...(testsetRef ? {testset: testsetRef} : {}),
            ...(testsetRevision ? {testset_revision: testsetRevision} : {}),
            ...(testcase ? {testcase} : {}),
        },
        links: {
            [JUDGE_REVIEW_LINK_KEY]: {trace_id: judgeTrace.traceId, span_id: judgeTrace.spanId},
        },
        origin: "human",
        kind: "adhoc",
        channel: "web",
        meta,
    }
}

/**
 * A review as an annotation holds it: the answer, the note, and the judge result trace it links.
 * Null for an annotation that is not a review.
 */
export function readJudgeReview(annotation: {
    meta?: {verdict?: JudgeVerdict | null; note?: string | null} | null
    links?: Record<string, {trace_id?: string | null} | undefined> | null
}): {verdict: JudgeVerdict; note: string | null; judgeTraceId: string | null} | null {
    const verdict = annotation.meta?.verdict
    if (verdict !== "agree" && verdict !== "disagree") return null
    return {
        verdict,
        note: annotation.meta?.note || null,
        judgeTraceId: annotation.links?.[JUDGE_REVIEW_LINK_KEY]?.trace_id ?? null,
    }
}
