import {describe, expect, it} from "vitest"

import {getNodeById} from "../../src/trace/utils/nodeTree"

/**
 * The traversal used to walk `Object.values(node)`, which visits every property — not just
 * `children`. Span metadata carries `span_id` too (`invocationIds`, OTel links), so a lookup
 * could return a link bag instead of the span it describes.
 */

interface Node {
    span_id?: string
    span_name?: string
    children?: unknown
    invocationIds?: {trace_id?: string; span_id?: string}
    otel?: {links?: {span_id?: string}[]}
}

describe("getNodeById", () => {
    it("finds a root by id", () => {
        const nodes: Node[] = [{span_id: "a"}, {span_id: "b", span_name: "wanted"}]
        expect(getNodeById(nodes, "b")?.span_name).toBe("wanted")
    })

    it("finds a nested child", () => {
        const nodes: Node[] = [
            {span_id: "a", children: [{span_id: "a1", children: [{span_id: "a2"}]}]},
        ]
        expect(getNodeById(nodes, "a2")?.span_id).toBe("a2")
    })

    it("does not return metadata that happens to carry the id", () => {
        // A SINGLE node, not an array: that is the path the old traversal walked with
        // `Object.values`, which visits `invocationIds` and `otel` alongside `children`.
        // An annotation span's `invocationIds.span_id` points at a DIFFERENT span, so the
        // lookup could hand back that bag instead of the span itself.
        const node: Node = {
            span_id: "root",
            invocationIds: {trace_id: "t", span_id: "target"},
            otel: {links: [{span_id: "target"}]},
            children: [{span_id: "target", span_name: "the real span"}],
        }
        expect(getNodeById(node, "target")?.span_name).toBe("the real span")
    })

    it("accepts a single node as well as an array", () => {
        expect(getNodeById({span_id: "solo"} as Node, "solo")?.span_id).toBe("solo")
    })

    it("returns null for a miss and for empty input", () => {
        expect(getNodeById([{span_id: "a"}] as Node[], "zzz")).toBeNull()
        expect(getNodeById(null, "a")).toBeNull()
        expect(getNodeById(undefined, "a")).toBeNull()
    })
})
