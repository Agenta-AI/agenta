/**
 * Unit tests for the AGE-3788 tracing-migration scaffolding (Phase 0):
 *   - buildSpansQueryRequest / toFilteringInput  (legacy params -> Fern request)
 *   - fernTraceOutputToNodes / fernTracesToLegacyTraceMap / fernSpansToNodes
 *     (Fern envelope -> existing FE structures, via the reused transform)
 *   - the trace_type/span_type enum flip ("undefined" -> "unknown")
 *
 * Pure logic — no network. Golden-fixture parity (real old+new payloads) is a
 * separate T6/T7/T8 concern; here we cover the param mapping, the envelope
 * normalisation, dash-stripping, and the enum drift fix in isolation.
 */
import {describe, expect, it} from "vitest"

import {
    buildSpansQueryRequest,
    fernSpansToNodes,
    fernTraceOutputToNodes,
    fernTracesToLegacyTraceMap,
    toFilteringInput,
} from "../../src/trace/api"
import {
    SpanCategoryEnum,
    TraceTypeEnum,
    type TraceOutput,
    type TraceSpan,
} from "../../src/trace/core"

// --- fixtures ----------------------------------------------------------------

const leafSpan = (id: string, name: string, traceId = "t-1"): TraceSpan => ({
    trace_id: traceId,
    span_id: id,
    span_name: name,
})

// A TraceOutput whose `spans` is the span-name-keyed map the new endpoints return.
const traceOutput = (traceId: string): TraceOutput => ({
    trace_id: traceId,
    spans: {
        root: {
            ...leafSpan("s-root", "root", traceId),
            spans: {
                child: leafSpan("s-child", "child", traceId),
            },
        },
    },
})

// --- buildSpansQueryRequest --------------------------------------------------

describe("buildSpansQueryRequest", () => {
    it("maps size -> windowing.limit and cursor -> windowing.next", () => {
        const req = buildSpansQueryRequest({size: 50, cursor: "abc"})
        expect(req.windowing?.limit).toBe(50)
        expect(req.windowing?.next).toBe("abc")
    })

    it("maps oldest/newest into windowing", () => {
        const req = buildSpansQueryRequest({oldest: "2026-01-01", newest: "2026-02-01"})
        expect(req.windowing?.oldest).toBe("2026-01-01")
        expect(req.windowing?.newest).toBe("2026-02-01")
    })

    it("omits windowing entirely when no pagination params are given", () => {
        expect(buildSpansQueryRequest({}).windowing).toBeUndefined()
    })

    it("passes a structured filter object through as filtering", () => {
        const filter = {conditions: [{field: "trace_id", operator: "in", value: ["x"]}]}
        const req = buildSpansQueryRequest({filter})
        expect(req.filtering).toEqual(filter)
    })

    it("parses a JSON-string filter into filtering", () => {
        const req = buildSpansQueryRequest({filter: '{"conditions":[]}'})
        expect(req.filtering).toEqual({conditions: []})
    })
})

describe("toFilteringInput", () => {
    it("returns undefined for undefined / non-JSON string", () => {
        expect(toFilteringInput(undefined)).toBeUndefined()
        expect(toFilteringInput("not json")).toBeUndefined()
    })
    it("passes structured objects through", () => {
        expect(toFilteringInput({operator: "and", conditions: []})).toEqual({
            operator: "and",
            conditions: [],
        })
    })
})

// --- fernTraceOutputToNodes (single trace envelope) --------------------------

describe("fernTraceOutputToNodes", () => {
    it("returns [] for null / absent spans", () => {
        expect(fernTraceOutputToNodes(null)).toEqual([])
        expect(fernTraceOutputToNodes({trace_id: "t", spans: null})).toEqual([])
    })

    it("builds a tree with key + invocationIds + children", () => {
        const nodes = fernTraceOutputToNodes(traceOutput("t-1"))
        expect(nodes).toHaveLength(1)
        const root = nodes[0]
        expect(root.span_id).toBe("s-root")
        expect(root.key).toBe("s-root")
        expect(root.invocationIds).toEqual({trace_id: "t-1", span_id: "s-root"})
        expect(root.children).toHaveLength(1)
        expect(root.children?.[0].span_id).toBe("s-child")
    })
})

// --- fernTracesToLegacyTraceMap (batch, transitional) ------------------------

describe("fernTracesToLegacyTraceMap", () => {
    it("keys the map by UNDASHED trace_id (coalescer contract)", () => {
        const dashed = "0d2e4f6a-1111-2222-3333-444455556666"
        const undashed = dashed.replace(/-/g, "")
        const out = fernTracesToLegacyTraceMap([{...traceOutput(dashed)}])
        expect(Object.keys(out.traces)).toEqual([undashed])
        expect(out.count).toBe(1)
        expect(out.traces[undashed].spans).toBeDefined()
    })

    it("skips entries without a trace_id and handles empty input", () => {
        expect(fernTracesToLegacyTraceMap(null)).toEqual({count: 0, traces: {}})
        const out = fernTracesToLegacyTraceMap([{spans: {}} as TraceOutput])
        expect(out.count).toBe(0)
    })
})

// --- fernSpansToNodes (flat) -------------------------------------------------

describe("fernSpansToNodes", () => {
    it("maps flat spans to enriched leaf nodes", () => {
        const nodes = fernSpansToNodes([leafSpan("s-1", "a"), leafSpan("s-2", "b")])
        expect(nodes.map((n) => n.span_id)).toEqual(["s-1", "s-2"])
        expect(nodes[0].key).toBe("s-1")
        expect(nodes[0].invocationIds).toEqual({trace_id: "t-1", span_id: "s-1"})
    })
    it("returns [] for empty / null", () => {
        expect(fernSpansToNodes(null)).toEqual([])
        expect(fernSpansToNodes([])).toEqual([])
    })
})

// --- enum drift fix ("undefined" -> "unknown") -------------------------------

describe("trace/span type enum flip (AGE-3788)", () => {
    it("accepts the Fern catch-all 'unknown'", () => {
        expect(TraceTypeEnum.safeParse("unknown").success).toBe(true)
        expect(SpanCategoryEnum.safeParse("unknown").success).toBe(true)
    })
    it("no longer accepts the legacy 'undefined'", () => {
        expect(TraceTypeEnum.safeParse("undefined").success).toBe(false)
        expect(SpanCategoryEnum.safeParse("undefined").success).toBe(false)
    })
    it("still accepts known values", () => {
        expect(TraceTypeEnum.safeParse("invocation").success).toBe(true)
        expect(SpanCategoryEnum.safeParse("llm").success).toBe(true)
    })
})
