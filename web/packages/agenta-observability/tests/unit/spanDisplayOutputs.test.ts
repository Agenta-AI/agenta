import {describe, expect, it} from "vitest"

import {getSpanDisplayOutputs} from "../../src/state/selectors"
import type {TraceSpanNode} from "../../src/core/traceSpan"

const span = (partial: Record<string, unknown>): TraceSpanNode =>
    ({span_id: "id", span_name: "span", ...partial}) as unknown as TraceSpanNode

const withOutputs = (outputs: unknown, partial: Record<string, unknown> = {}) =>
    span({attributes: {ag: {data: {outputs}}}, ...partial})

describe("getSpanDisplayOutputs", () => {
    it("keeps the span's own outputs when it has them", () => {
        expect(getSpanDisplayOutputs(withOutputs({answer: "own"}))).toEqual({answer: "own"})
    })

    it("falls back to the nested agent span's outputs (tree children) when the root has none", () => {
        const root = span({
            children: [withOutputs("reply", {span_type: "agent", span_id: "a"})],
        })
        expect(getSpanDisplayOutputs(root)).toBe("reply")
    })

    it("falls back to the nested agent span's outputs (API `spans` map) when the root has none", () => {
        const root = span({
            spans: {invoke_agent: withOutputs("reply", {span_type: "agent", span_id: "a"})},
        })
        expect(getSpanDisplayOutputs(root)).toBe("reply")
    })

    it("hides the generator repr a streamed root span records", () => {
        const root = withOutputs("<async_generator object run at 0x1>")
        expect(getSpanDisplayOutputs(root)).toBeNull()
    })
})
