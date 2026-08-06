import {describe, expect, it} from "vitest"

import {annotationSchema} from "../../src/annotation/core/schema"

// Regression for AGE-3761 follow-up: the FE annotation enums drifted from the
// backend `SimpleTrace*` enums. A trace with `kind: "play"` or
// `channel: "otlp"` failed the strict zod enum, which made `queryAnnotations`
// silently return zero annotations — so testset sync from the annotation queue
// produced no exportable rows and never created a revision.
describe("annotationSchema classification enums", () => {
    const base = {
        trace_id: "t-1",
        span_id: "s-1",
        data: {outputs: {score: 5}},
        references: {evaluator: {id: "ev-1"}},
    }

    it("accepts the backend `play` kind and `otlp` channel", () => {
        const result = annotationSchema.safeParse({
            ...base,
            kind: "play",
            channel: "otlp",
        })
        expect(result.success).toBe(true)
        expect(result.data?.kind).toBe("play")
        expect(result.data?.channel).toBe("otlp")
    })

    it("still accepts the previously-known values", () => {
        for (const kind of ["adhoc", "eval"] as const) {
            expect(annotationSchema.safeParse({...base, kind}).success).toBe(true)
        }
        for (const channel of ["web", "sdk", "api"] as const) {
            expect(annotationSchema.safeParse({...base, channel}).success).toBe(true)
        }
    })

    it("degrades an unknown classification to undefined instead of dropping the annotation", () => {
        const result = annotationSchema.safeParse({
            ...base,
            kind: "some_future_kind",
            channel: "some_future_channel",
            origin: "some_future_origin",
        })
        expect(result.success).toBe(true)
        expect(result.data?.kind).toBeUndefined()
        expect(result.data?.channel).toBeUndefined()
        expect(result.data?.origin).toBeUndefined()
    })
})
