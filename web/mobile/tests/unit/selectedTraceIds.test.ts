import {describe, expect, it} from "vitest"

import {selectedTraceIds} from "@/features/observability/selectedTraceIds"

const TRACES = [
    {
        trace_id: "trace-a",
        span_id: "span-a-root",
        children: [{trace_id: "trace-a", span_id: "span-a-child"}],
    },
    {trace_id: "trace-b", span_id: "span-b-root"},
]

describe("selectedTraceIds", () => {
    it("maps each selected row (a span id) to its trace id", () => {
        expect(selectedTraceIds(TRACES, ["span-a-root", "span-b-root"])).toEqual([
            "trace-a",
            "trace-b",
        ])
    })

    it("lists a trace once when several of its spans are selected", () => {
        expect(selectedTraceIds(TRACES, ["span-a-root", "span-a-child", "span-b-root"])).toEqual([
            "trace-a",
            "trace-b",
        ])
    })

    it("drops a key that matches no loaded span", () => {
        expect(selectedTraceIds(TRACES, ["span-gone", "span-b-root"])).toEqual(["trace-b"])
    })

    it("returns nothing for no selection", () => {
        expect(selectedTraceIds(TRACES, [])).toEqual([])
    })
})
