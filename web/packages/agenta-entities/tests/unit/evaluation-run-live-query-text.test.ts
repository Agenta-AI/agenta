import {describe, expect, it} from "vitest"

import {formatQueryFiltering, formatQuerySampleRate} from "../../src/evaluationRun/core/liveQuery"

describe("a live run's query as text", () => {
    it("joins the conditions with the group operator, groups in parentheses", () => {
        expect(
            formatQueryFiltering({
                operator: "and",
                conditions: [
                    {field: "trace_type", operator: "is", value: "invocation"},
                    {
                        operator: "or",
                        conditions: [
                            {
                                field: "attributes",
                                key: "ag.meta.user",
                                operator: "is",
                                value: "Sam",
                            },
                            {field: "status", operator: "is", value: "error"},
                        ],
                    },
                ],
            }),
        ).toBe("trace_type is invocation AND (attributes is Sam OR status is error)")
    })

    it("prints a list value as JSON and a missing filter as a dash", () => {
        expect(
            formatQueryFiltering({
                conditions: [{field: "references", operator: "in", value: [{id: "app-1"}]}],
            }),
        ).toBe('references in [{"id":"app-1"}]')
        expect(formatQueryFiltering(null)).toBe("—")
    })

    it("prints the sampling rate as a percent", () => {
        expect(formatQuerySampleRate(1)).toBe("100%")
        expect(formatQuerySampleRate(0.255)).toBe("25.5%")
        expect(formatQuerySampleRate(null)).toBe("—")
    })
})
