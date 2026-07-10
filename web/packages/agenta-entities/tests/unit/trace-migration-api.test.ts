/**
 * Unit tests for the AGE-3788 Phase 1/2 api functions (sessions + delete),
 * migrated to the Fern client.
 *
 * Mocks `@agenta/sdk/resources` (not axios) so we assert the Fern method is
 * called with the right body + queryParams without constructing a real client,
 * per the pattern in retrieveWorkflowRevision.test.ts.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const querySpansSessions = vi.fn()
const deleteTrace = vi.fn()
const fetchTrace = vi.fn()
const querySpans = vi.fn()
const queryTraces = vi.fn()
const querySpansAnalytics = vi.fn()

const fakeTracesClient = {
    querySpansSessions,
    deleteTrace,
    fetchTrace,
    querySpans,
    queryTraces,
    querySpansAnalytics,
}

// The code under test resolves its client via `@agenta/sdk/resources`; the low-priority
// variant shares the fake (the priority is a fetch hint, not a behavior change).
vi.mock("@agenta/sdk/resources", () => ({
    getTracesClient: () => fakeTracesClient,
    getLowPriorityTracesClient: () => fakeTracesClient,
}))

// Import AFTER the mock so the unit-under-test picks up the fake client.
import {
    deletePreviewTrace,
    fetchAllPreviewTraces,
    fetchAllPreviewTracesWithMeta,
    fetchPreviewTrace,
    fetchSessions,
    fetchSpansAnalytics,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "../../src/trace/api"
import type {TracesResponse} from "../../src/trace/core"

beforeEach(() => {
    querySpansSessions.mockReset()
    deleteTrace.mockReset()
    fetchTrace.mockReset()
    querySpans.mockReset()
    queryTraces.mockReset()
    querySpansAnalytics.mockReset()
})

describe("fetchSessions (Phase 1 — POST /spans/sessions/query)", () => {
    it("sends windowing + realtime as the body and project/app as queryParams", async () => {
        querySpansSessions.mockResolvedValueOnce({
            count: 2,
            session_ids: ["s1", "s2"],
            windowing: {next: "cur-2"},
        })

        const res = await fetchSessions(
            {appId: "app-1", windowing: {limit: 50, oldest: "2026-01-01"}, realtime: true},
            "proj-9",
        )

        expect(querySpansSessions).toHaveBeenCalledTimes(1)
        const [body, opts] = querySpansSessions.mock.calls[0]
        expect(body).toEqual({windowing: {limit: 50, oldest: "2026-01-01"}, realtime: true})
        expect(opts.queryParams).toEqual({project_id: "proj-9", application_id: "app-1"})
        expect(res).toEqual({count: 2, session_ids: ["s1", "s2"], windowing: {next: "cur-2"}})
    })

    it("folds cursor into windowing.next", async () => {
        querySpansSessions.mockResolvedValueOnce({count: 0, session_ids: []})
        await fetchSessions({cursor: "abc"}, "proj-9")
        const [body] = querySpansSessions.mock.calls[0]
        expect(body.windowing).toEqual({next: "abc"})
    })

    it("returns null when the Fern call throws (AgentaApiError -> null)", async () => {
        querySpansSessions.mockRejectedValueOnce(new Error("500"))
        expect(await fetchSessions({}, "proj-9")).toBeNull()
    })

    it("rethrows AbortError so the query client can cancel", async () => {
        const abort = new DOMException("Aborted", "AbortError")
        querySpansSessions.mockRejectedValueOnce(abort)
        await expect(fetchSessions({}, "proj-9")).rejects.toBe(abort)
    })
})

describe("deletePreviewTrace (Phase 2 — DELETE /traces/{id})", () => {
    it("calls deleteTrace with trace_id + project queryParam and returns the id response", async () => {
        deleteTrace.mockResolvedValueOnce({count: 1, trace_id: "t-1"})
        const res = await deletePreviewTrace("t-1", "proj-9")
        expect(deleteTrace).toHaveBeenCalledTimes(1)
        const [body, opts] = deleteTrace.mock.calls[0]
        expect(body).toEqual({trace_id: "t-1"})
        expect(opts.queryParams).toEqual({project_id: "proj-9"})
        expect(res).toEqual({count: 1, trace_id: "t-1"})
    })

    it("returns null when the delete throws", async () => {
        deleteTrace.mockRejectedValueOnce(new Error("boom"))
        expect(await deletePreviewTrace("t-1", "proj-9")).toBeNull()
    })
})

describe("fetchPreviewTrace (Phase 3 — GET /traces/{id})", () => {
    const DASHED = "0d2e4f6a-1111-2222-3333-444455556666"
    const UNDASHED = DASHED.replace(/-/g, "")
    // span-name-keyed map shared by the old + new payloads (the part that does
    // not change across the migration — only the outer envelope does).
    const spansMap = {
        root: {
            trace_id: DASHED,
            span_id: "s-root",
            span_name: "root",
            spans: {
                child: {trace_id: DASHED, span_id: "s-child", span_name: "child"},
            },
        },
    }

    it("calls fetchTrace with trace_id + project queryParam, returns legacy map keyed UNDASHED", async () => {
        fetchTrace.mockResolvedValueOnce({count: 1, trace: {trace_id: DASHED, spans: spansMap}})
        const res = await fetchPreviewTrace(DASHED, "proj-9")
        const [body, opts] = fetchTrace.mock.calls[0]
        expect(body).toEqual({trace_id: DASHED})
        expect(opts.queryParams).toEqual({project_id: "proj-9"})
        // annotationFormController reads traces[undashed].spans — key must be undashed.
        expect(Object.keys(res!.traces)).toEqual([UNDASHED])
        expect(res!.traces[UNDASHED].spans).toBeDefined()
    })

    // GOLDEN CONVERGENCE (T6 CRITICAL): the new-endpoint path must produce the
    // SAME TraceSpanNode[] tree as the legacy /tracing/traces/{id} path did.
    // NOTE: fixtures are representative; replace with REAL captured old+new
    // payloads when backend access is available (T6 follow-up).
    it("new-path tree deep-equals old-path tree", async () => {
        fetchTrace.mockResolvedValueOnce({count: 1, trace: {trace_id: DASHED, spans: spansMap}})
        const newResult = await fetchPreviewTrace(DASHED, "proj-9")

        // Legacy /tracing/traces/{id} envelope for the same trace.
        const oldEquivalent = {count: 1, traces: {[DASHED]: {spans: spansMap}}}

        const newTree = transformTracingResponse(transformTracesResponseToTree(newResult!))
        // The literal `spansMap` omits some optional span fields, so a direct
        // cast won't structurally match; `as unknown as TracesResponse` is
        // honest about the shim while still typing the value (vs `as never`).
        const oldTree = transformTracingResponse(
            transformTracesResponseToTree(oldEquivalent as unknown as TracesResponse),
        )

        expect(newTree).toEqual(oldTree)
        expect(newTree).toHaveLength(1)
        expect(newTree[0].span_id).toBe("s-root")
        expect(newTree[0].children?.[0].span_id).toBe("s-child")
    })

    it("returns an empty map when the trace is absent", async () => {
        fetchTrace.mockResolvedValueOnce({count: 0, trace: null})
        const res = await fetchPreviewTrace(DASHED, "proj-9")
        expect(res).toEqual({count: 0, traces: {}})
    })

    it("returns null when fetchTrace throws", async () => {
        fetchTrace.mockRejectedValueOnce(new Error("404"))
        expect(await fetchPreviewTrace(DASHED, "proj-9")).toBeNull()
    })
})

describe("fetchAllPreviewTraces (Phase 4 — flat spans via POST /spans/query)", () => {
    it("routes focus=span to querySpans with structured filtering + windowing + queryParams", async () => {
        querySpans.mockResolvedValueOnce({count: 1, spans: [{trace_id: "t", span_id: "s"}]})
        const filter = JSON.stringify({
            conditions: [{field: "span_id", operator: "in", value: ["s"]}],
        })
        const res = await fetchAllPreviewTraces(
            {size: 10, focus: "span", filter},
            "app-1",
            "proj-9",
        )

        expect(querySpans).toHaveBeenCalledTimes(1)
        const [request, opts] = querySpans.mock.calls[0]
        expect(request.windowing).toEqual({limit: 10})
        expect(request.filtering).toEqual({
            conditions: [{field: "span_id", operator: "in", value: ["s"]}],
        })
        // focus is intentionally NOT forwarded — /spans/query is always flat.
        expect(request.focus).toBeUndefined()
        expect(opts.queryParams).toEqual({project_id: "proj-9", application_id: "app-1"})
        expect(res).toEqual({count: 1, spans: [{trace_id: "t", span_id: "s"}]})
    })

    it("routes focus=chat (and undefined) to querySpans too (only 'trace' stays legacy)", async () => {
        querySpans.mockResolvedValue({count: 0, spans: []})
        await fetchAllPreviewTraces({focus: "chat"}, "", "proj-9")
        await fetchAllPreviewTraces({}, "", "proj-9")
        expect(querySpans).toHaveBeenCalledTimes(2)
        // No application_id queryParam when appId is empty.
        expect(querySpans.mock.calls[0][1].queryParams).toEqual({project_id: "proj-9"})
    })

    it("returns null when querySpans throws", async () => {
        querySpans.mockRejectedValueOnce(new Error("429"))
        expect(await fetchAllPreviewTraces({focus: "span"}, "", "proj-9")).toBeNull()
    })
})

describe("fetchAllPreviewTraces (Phase 5 — trace-tree via POST /traces/query)", () => {
    const DASHED = "0d2e4f6a-1111-2222-3333-444455556666"
    const UNDASHED = DASHED.replace(/-/g, "")

    it("routes focus=trace to queryTraces and adapts the array to the legacy map (undashed keys)", async () => {
        const filter = JSON.stringify({
            conditions: [{field: "trace_id", operator: "in", value: [UNDASHED]}],
        })
        queryTraces.mockResolvedValueOnce({
            count: 1,
            traces: [{trace_id: DASHED, spans: {root: {trace_id: DASHED, span_id: "s"}}}],
        })

        const res = (await fetchAllPreviewTraces(
            {focus: "trace", filter},
            "",
            "proj-9",
        )) as TracesResponse

        expect(queryTraces).toHaveBeenCalledTimes(1)
        const [request, opts] = queryTraces.mock.calls[0]
        expect(request.filtering).toEqual({
            conditions: [{field: "trace_id", operator: "in", value: [UNDASHED]}],
        })
        expect(opts.queryParams).toEqual({project_id: "proj-9"})
        // The coalescer + ETL read data.traces[traceIdNoDashes] — key must be undashed.
        expect(Object.keys(res.traces)).toEqual([UNDASHED])
    })

    it("returns null when queryTraces throws", async () => {
        queryTraces.mockRejectedValueOnce(new Error("500"))
        expect(await fetchAllPreviewTraces({focus: "trace"}, "", "proj-9")).toBeNull()
    })
})

describe("fetchAllPreviewTracesWithMeta (Phase 5 CQ2 — rate-limit pacing)", () => {
    // The meta variant reads X-RateLimit-* off the raw Response via Fern's
    // .withRawResponse(), so the mock returns a {withRawResponse} thenable.
    const withRaw = (data: unknown, headers: Headers) => ({
        withRawResponse: () => Promise.resolve({data, rawResponse: {headers}}),
    })

    it("parses X-RateLimit-* from rawResponse.headers and returns {data, rateLimit}", async () => {
        const headers = new Headers({"x-ratelimit-remaining": "42", "x-ratelimit-limit": "120"})
        querySpans.mockReturnValueOnce(
            withRaw({count: 1, spans: [{trace_id: "t", span_id: "s"}]}, headers),
        )

        const res = await fetchAllPreviewTracesWithMeta({focus: "span"}, "app-1", "proj-9")
        expect(res.rateLimit).toEqual({remaining: 42, limit: 120})
        expect(res.data).toEqual({count: 1, spans: [{trace_id: "t", span_id: "s"}]})
    })

    it("returns null rate-limit fields when the headers are absent", async () => {
        querySpans.mockReturnValueOnce(withRaw({count: 0, spans: []}, new Headers()))
        const res = await fetchAllPreviewTracesWithMeta({focus: "span"}, "", "proj-9")
        expect(res.rateLimit).toEqual({remaining: null, limit: null})
    })

    it("returns {data:null, rateLimit:nulls} on a non-abort failure", async () => {
        querySpans.mockReturnValueOnce({withRawResponse: () => Promise.reject(new Error("500"))})
        const res = await fetchAllPreviewTracesWithMeta({focus: "span"}, "", "proj-9")
        expect(res.data).toBeNull()
        expect(res.rateLimit).toEqual({remaining: null, limit: null})
    })

    it("rethrows AbortError so the export can cancel", async () => {
        const abort = new DOMException("Aborted", "AbortError")
        querySpans.mockReturnValueOnce({withRawResponse: () => Promise.reject(abort)})
        await expect(fetchAllPreviewTracesWithMeta({focus: "span"}, "", "proj-9")).rejects.toBe(
            abort,
        )
    })
})

describe("fetchSpansAnalytics (Phase 6 — POST /spans/analytics/query)", () => {
    it("omits `specs` (backend defaults), sends focus/interval/window and JSON-string filter", async () => {
        querySpansAnalytics.mockResolvedValueOnce({count: 0, buckets: []})

        await fetchSpansAnalytics({
            projectId: "proj-9",
            appId: "app-1",
            focus: "trace",
            interval: 60,
            oldest: "2026-01-01T00:00:00Z",
            newest: "2026-01-02T00:00:00Z",
            filter: {conditions: [{field: "references", operator: "in", value: [{id: "app-1"}]}]},
        })

        expect(querySpansAnalytics).toHaveBeenCalledTimes(1)
        const [request, opts] = querySpansAnalytics.mock.calls[0]
        // `specs` MUST be absent so the backend applies DEFAULT_ANALYTICS_SPECS.
        expect(request).not.toHaveProperty("specs")
        expect(request.focus).toBe("trace")
        expect(request.interval).toBe(60)
        expect(request.oldest).toBe("2026-01-01T00:00:00Z")
        expect(request.newest).toBe("2026-01-02T00:00:00Z")
        // filter is a JSON-encoded string query param, not a structured body.
        expect(typeof request.filter).toBe("string")
        expect(JSON.parse(request.filter)).toEqual({
            conditions: [{field: "references", operator: "in", value: [{id: "app-1"}]}],
        })
        expect(opts.queryParams).toEqual({project_id: "proj-9", application_id: "app-1"})
    })

    it("omits `filter` when no conditions are supplied", async () => {
        querySpansAnalytics.mockResolvedValueOnce({count: 0, buckets: []})
        await fetchSpansAnalytics({projectId: "proj-9", interval: 30})
        const [request, opts] = querySpansAnalytics.mock.calls[0]
        expect(request).not.toHaveProperty("filter")
        expect(request).not.toHaveProperty("specs")
        expect(request.focus).toBe("trace") // default focus
        expect(opts.queryParams).toEqual({project_id: "proj-9"})
    })

    it("returns null without calling Fern when projectId is empty", async () => {
        const res = await fetchSpansAnalytics({projectId: ""})
        expect(res).toBeNull()
        expect(querySpansAnalytics).not.toHaveBeenCalled()
    })

    it("parses a representative analytics response (metrics keyed by dotted path)", async () => {
        const buckets = [
            {
                timestamp: "2026-01-01T00:00:00Z",
                interval: 60,
                metrics: {
                    "attributes.ag.metrics.costs.cumulative.total": {
                        type: "numeric/continuous",
                        count: 3,
                        sum: 0.42,
                    },
                    "attributes.ag.type.trace": {type: "categorical/single", count: 3},
                },
            },
        ]
        querySpansAnalytics.mockResolvedValueOnce({count: 1, buckets})
        const res = await fetchSpansAnalytics({projectId: "proj-9"})
        expect(res).toEqual({count: 1, buckets})
    })

    it("returns null when the Fern call throws (AgentaApiError -> null)", async () => {
        querySpansAnalytics.mockRejectedValueOnce(new Error("500"))
        const res = await fetchSpansAnalytics({projectId: "proj-9"})
        expect(res).toBeNull()
    })

    it("rethrows AbortError so TanStack Query can cancel", async () => {
        const abort = new DOMException("Aborted", "AbortError")
        querySpansAnalytics.mockRejectedValueOnce(abort)
        await expect(fetchSpansAnalytics({projectId: "proj-9"})).rejects.toBe(abort)
    })
})
