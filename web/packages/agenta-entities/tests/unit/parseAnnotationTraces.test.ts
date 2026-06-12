import {describe, expect, it} from "vitest"

import {parseAnnotationTraces} from "../../src/annotation/api/api"

// Regression for AGE-3761: `/simple/traces/query` filtered by a testcase id
// returns the application *invocation* trace alongside the annotations. The
// invocation isn't annotation-shaped (`data.outputs` is a string,
// `references.evaluator` is absent), so a strict `z.array(annotationSchema)`
// failed the whole array and `queryAnnotations` returned zero annotations —
// the testset-sync export then had no rows and created no revision.
describe("parseAnnotationTraces", () => {
    const exactMatchAnnotation = {
        trace_id: "t-annotation-1",
        span_id: "s-1",
        origin: "custom",
        kind: "adhoc",
        channel: "api",
        data: {inputs: {outputs: "model output text"}},
        references: {evaluator: {slug: "exact-match", id: "ev-1"}, testcase: {id: "tc-1"}},
    }

    const llmJudgeAnnotation = {
        trace_id: "t-annotation-2",
        span_id: "s-2",
        origin: "custom",
        kind: "adhoc",
        channel: "api",
        data: {inputs: {}, outputs: {score: true}},
        references: {evaluator: {slug: "llm-as-a-judge", id: "ev-2"}, testcase: {id: "tc-1"}},
    }

    // Not an annotation: data.outputs is a string and there is no evaluator ref.
    const invocationTrace = {
        trace_id: "t-invocation",
        span_id: "s-3",
        origin: "custom",
        kind: "adhoc",
        channel: "api",
        data: {inputs: {inputs: {id: "tc-1"}}, outputs: "model output text"},
        references: {application: {id: "app-1"}, testcase: {id: "tc-1"}},
    }

    it("keeps valid annotations and drops the non-annotation invocation trace", () => {
        const result = parseAnnotationTraces([
            exactMatchAnnotation,
            llmJudgeAnnotation,
            invocationTrace,
        ])

        expect(result).toHaveLength(2)
        expect(result.map((a) => a.references?.evaluator?.slug)).toEqual([
            "exact-match",
            "llm-as-a-judge",
        ])
        // The annotation with structured outputs survives with its data intact.
        expect(result[1]?.data.outputs).toEqual({score: true})
    })

    it("returns an empty array for non-array input", () => {
        expect(parseAnnotationTraces(undefined)).toEqual([])
        expect(parseAnnotationTraces(null)).toEqual([])
        expect(parseAnnotationTraces("nope")).toEqual([])
    })

    it("returns an empty array when no element is a valid annotation", () => {
        expect(parseAnnotationTraces([invocationTrace])).toEqual([])
    })
})
