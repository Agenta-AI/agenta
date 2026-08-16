import {filterKeySpans, filterTree, isKeySpan} from "@agenta/observability/trace"
import {describe, expect, it} from "vitest"

import type {TraceSpanNode} from "../../src/core/traceSpan"

const span = (partial: Partial<TraceSpanNode>): TraceSpanNode =>
    ({span_id: "id", span_name: "span", ...partial}) as TraceSpanNode

describe("filterTree", () => {
    const tree = span({
        span_name: "root",
        children: [
            span({span_id: "a", span_name: "fetch user", children: []}),
            span({
                span_id: "b",
                span_name: "wrapper",
                children: [span({span_id: "c", span_name: "call model", children: []})],
            }),
        ],
    })

    it("keeps a branch when a descendant matches, even though the branch itself does not", () => {
        const result = filterTree(tree, "model")

        expect(result?.children?.map((c) => c.span_name)).toEqual(["wrapper"])
        expect(result?.children?.[0].children?.map((c) => c.span_name)).toEqual(["call model"])
    })

    it("drops branches with no match anywhere", () => {
        expect(filterTree(span({span_name: "root", children: []}), "nope")).toBeNull()
    })

    it("does not mutate the input", () => {
        filterTree(tree, "model")
        expect(tree.children).toHaveLength(2)
    })
})

describe("filterKeySpans", () => {
    it("keeps the root and promotes key descendants past the wrappers", () => {
        const tree = span({
            span_id: "root",
            span_type: "workflow",
            children: [
                span({
                    span_id: "chain",
                    span_type: "chain",
                    children: [span({span_id: "llm", span_type: "llm", children: []})],
                }),
            ],
        })

        const {tree: filtered, hiddenCount} = filterKeySpans(tree)

        expect(hiddenCount).toBe(1)
        expect(filtered?.children?.map((c) => c.span_id)).toEqual(["llm"])
    })

    it("keeps an errored span whatever its type", () => {
        expect(isKeySpan(span({span_type: "chain", status_code: "STATUS_CODE_ERROR"}))).toBe(true)
        expect(isKeySpan(span({span_type: "chain"}))).toBe(false)
    })

    it("reports no tree for no input", () => {
        expect(filterKeySpans(undefined)).toEqual({tree: null, hiddenCount: 0})
    })
})
