import {describe, expect, it} from "vitest"

import {tracesResponseSchema} from "../../src/trace/core/schema"

// Regression for AGE-3761 follow-up: an empty `/tracing/spans/query` result
// omits `traces` (and sometimes `count`). The schema previously required both,
// so an empty result failed validation and logged
// "[fetchAllPreviewTraces] expected record, received undefined", returning null
// to the trace store/prefetch.
describe("tracesResponseSchema empty handling", () => {
    it("parses an empty result with no traces/count as empty", () => {
        const result = tracesResponseSchema.safeParse({})
        expect(result.success).toBe(true)
        expect(result.data?.count).toBe(0)
        expect(result.data?.traces).toEqual({})
    })

    it("parses a count-only empty response", () => {
        const result = tracesResponseSchema.safeParse({count: 0})
        expect(result.success).toBe(true)
        expect(result.data?.traces).toEqual({})
    })

    it("still parses a populated traces response", () => {
        const result = tracesResponseSchema.safeParse({
            count: 1,
            traces: {
                abc123: {
                    spans: {
                        root: {
                            trace_id: "abc123",
                            span_id: "s-1",
                            span_name: "completion",
                            start_time: "2026-05-20T16:00:12.236957Z",
                            end_time: "2026-05-20T16:00:15.513562Z",
                        },
                    },
                },
            },
        })
        expect(result.success).toBe(true)
        expect(Object.keys(result.data?.traces ?? {})).toEqual(["abc123"])
    })
})
