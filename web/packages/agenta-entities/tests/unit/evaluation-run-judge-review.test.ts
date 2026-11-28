import {describe, expect, it} from "vitest"

import {
    buildJudgeReview,
    readJudgeReview,
    reviewAgreement,
    type JudgeReviewInput,
} from "../../src/evaluationRun"

const base: JudgeReviewInput = {
    judge: {
        evaluatorId: "ev-1",
        slug: "low-effort",
        variantId: "evv-1",
        revisionId: "evr-1",
        name: "Bench check: low-effort",
    },
    testset: {testsetId: "ts-1", revisionId: "tsr-7"},
    testcaseId: "tc-1",
    judgeTrace: {traceId: "trace-1", spanId: "span-1"},
    judgeOutputs: {success: false, score: 0, reason: "5 user messages (limit 4)."},
    verdict: "agree",
}

describe("buildJudgeReview", () => {
    it("An agree stores the judge's outputs and no note", () => {
        const review = buildJudgeReview(base)
        expect(review).toEqual({
            data: {outputs: {success: false, score: 0, reason: "5 user messages (limit 4)."}},
            references: {
                evaluator: {id: "ev-1", slug: "low-effort"},
                evaluator_variant: {id: "evv-1"},
                evaluator_revision: {id: "evr-1"},
                testset: {id: "ts-1"},
                testset_revision: {id: "tsr-7"},
                testcase: {id: "tc-1"},
            },
            links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
            origin: "human",
            kind: "adhoc",
            channel: "web",
            meta: {name: "Bench check: low-effort", verdict: "agree"},
        })
    })

    it("A disagree stores the corrected value and the note", () => {
        const review = buildJudgeReview({
            ...base,
            verdict: "disagree",
            corrected: {success: true},
            note: " Five messages is fine here. ",
        })
        expect(review.data.outputs).toEqual({
            success: true,
            score: 0,
            reason: "5 user messages (limit 4).",
        })
        expect(review.meta).toEqual({
            name: "Bench check: low-effort",
            verdict: "disagree",
            note: "Five messages is fine here.",
        })
    })

    it("A required field the person left alone keeps the judge's value", () => {
        const review = buildJudgeReview({...base, verdict: "disagree", corrected: {score: 1}})
        expect(review.data.outputs).toEqual({
            success: false,
            score: 1,
            reason: "5 user messages (limit 4).",
        })
    })

    it("A run on traces names no test set or test case", () => {
        const review = buildJudgeReview({...base, testset: null, testcaseId: null})
        expect(review.references).toEqual({
            evaluator: {id: "ev-1", slug: "low-effort"},
            evaluator_variant: {id: "evv-1"},
            evaluator_revision: {id: "evr-1"},
        })
    })
})

describe("readJudgeReview", () => {
    it("Reads the answer and the note, and skips other annotations", () => {
        expect(readJudgeReview({meta: {verdict: "disagree", note: "Too strict"}})).toEqual({
            verdict: "disagree",
            note: "Too strict",
        })
        expect(readJudgeReview({meta: {verdict: "agree"}})).toEqual({
            verdict: "agree",
            note: null,
        })
        expect(readJudgeReview({meta: {}})).toBeNull()
        expect(readJudgeReview({})).toBeNull()
    })
})

describe("reviewAgreement", () => {
    it("No review counts nothing", () => {
        expect(reviewAgreement([])).toEqual({agreed: 0, total: 0, disagreementsByJudge: []})
    })

    it("All agree", () => {
        expect(
            reviewAgreement([
                {judge: "low-effort", verdict: "agree"},
                {judge: "short-to-read", verdict: "agree"},
            ]),
        ).toEqual({agreed: 2, total: 2, disagreementsByJudge: []})
    })

    it("Mixed over two judges lists the judge with most disagreements first", () => {
        expect(
            reviewAgreement([
                {judge: "short-to-read", verdict: "disagree"},
                {judge: "low-effort", verdict: "disagree"},
                {judge: "low-effort", verdict: "disagree"},
                {judge: "low-effort", verdict: "agree"},
                {judge: "short-to-read", verdict: "agree"},
            ]),
        ).toEqual({
            agreed: 2,
            total: 5,
            disagreementsByJudge: [
                {judge: "low-effort", count: 2},
                {judge: "short-to-read", count: 1},
            ],
        })
    })
})
