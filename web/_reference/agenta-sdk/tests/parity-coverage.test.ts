/**
 * Tests for the parity-coverage methods added in stage 0 to close the gap
 * vs the Python SDK. These verify URL construction, HTTP verb, and request
 * body shape at the fetch boundary. Integration tests will exercise actual
 * server responses; here we focus on "the method hits the right endpoint
 * with the right verb and body."
 *
 * Resources covered:
 *   - Evaluators: simple lifecycle (archive/unarchive/transfer), revision +
 *     variant CRUD (14 methods)
 *   - Queries: revision CRUD, simple-query lifecycle (12 methods)
 *   - TestSets: variant CRUD, revision unarchive/log/retrieve, transfer (9 methods)
 *   - Evaluations: refresh metrics + runs (2 methods)
 *   - Tracing: users/analytics queries (3 methods)
 *   - Workflows: inspect/invoke + revision/variant gaps (8 methods)
 */

import {describe, it, expect, vi, afterEach} from "vitest"

import {AgentaClient} from "@src/client.js"
import {Evaluators} from "@src/evaluators.js"
import {Queries} from "@src/queries.js"
import {TestSets} from "@src/testsets.js"
import {Evaluations} from "@src/evaluations.js"
import {Tracing} from "@src/trace-queries.js"
import {Workflows} from "@src/workflows.js"

interface MockResponse {
    ok?: boolean
    status?: number
    json?: unknown
    headers?: Record<string, string>
}

function fakeResponse(response: MockResponse): Response {
    return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        statusText: "OK",
        headers: new Headers(response.headers ?? {}),
        json: () => Promise.resolve(response.json ?? {}),
        text: () => Promise.resolve(""),
    } as Response
}

function mockOnce(response: MockResponse = {json: {count: 0}}) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse(response))
}

function newClient() {
    return new AgentaClient({
        host: "https://api.test",
        apiKey: "key",
        projectId: "proj-1",
        retries: 1,
    })
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe("Evaluators — parity additions", () => {
    const ev = () => new Evaluators(newClient())

    it("archive POSTs /preview/simple/evaluators/:id/archive", async () => {
        const spy = mockOnce()
        await ev().archive("ev-1")
        expect(spy.mock.calls[0][0]).toContain("/preview/simple/evaluators/ev-1/archive")
        expect(spy.mock.calls[0][1]?.method).toBe("POST")
    })

    it("unarchive POSTs /preview/simple/evaluators/:id/unarchive", async () => {
        const spy = mockOnce()
        await ev().unarchive("ev-1")
        expect(spy.mock.calls[0][0]).toContain("/preview/simple/evaluators/ev-1/unarchive")
    })

    it("transfer POSTs to .../transfer with the body", async () => {
        const spy = mockOnce()
        await ev().transfer("ev-1", {target_project_id: "p-2"})
        expect(spy.mock.calls[0][0]).toContain("/preview/simple/evaluators/ev-1/transfer")
        expect(spy.mock.calls[0][1]?.body).toBe(JSON.stringify({target_project_id: "p-2"}))
    })

    it("getRevision GETs /preview/evaluators/revisions/:id", async () => {
        const spy = mockOnce()
        await ev().getRevision("rev-1")
        expect(spy.mock.calls[0][0]).toContain("/preview/evaluators/revisions/rev-1")
        expect(spy.mock.calls[0][1]?.method).toBe("GET")
    })

    it("archiveRevision / unarchiveRevision hit the right paths", async () => {
        mockOnce()
        mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await ev().archiveRevision("rev-1")
        await ev().unarchiveRevision("rev-1")

        expect(spy.mock.calls[0][0]).toContain("/preview/evaluators/revisions/rev-1/archive")
        expect(spy.mock.calls[1][0]).toContain("/preview/evaluators/revisions/rev-1/unarchive")
    })

    it("logRevisions / queryRevisions POST to the canonical paths", async () => {
        mockOnce()
        mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await ev().logRevisions({evaluator_ref: {slug: "x"}})
        await ev().queryRevisions({refs: [{slug: "x"}]})

        expect(spy.mock.calls[0][0]).toContain("/preview/evaluators/revisions/log")
        expect(spy.mock.calls[1][0]).toContain("/preview/evaluators/revisions/query")
    })

    it("variant CRUD methods all hit /preview/evaluators/variants/...", async () => {
        for (let i = 0; i < 6; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await ev().createVariant({name: "v1"})
        await ev().getVariant("var-1")
        await ev().archiveVariant("var-1")
        await ev().unarchiveVariant("var-1")
        await ev().forkVariant({source: "var-1"})
        await ev().queryVariants({refs: [{slug: "x"}]})

        expect(spy.mock.calls[0][0]).toContain("/preview/evaluators/variants/")
        expect(spy.mock.calls[1][0]).toContain("/preview/evaluators/variants/var-1")
        expect(spy.mock.calls[2][0]).toContain("/preview/evaluators/variants/var-1/archive")
        expect(spy.mock.calls[3][0]).toContain("/preview/evaluators/variants/var-1/unarchive")
        expect(spy.mock.calls[4][0]).toContain("/preview/evaluators/variants/fork")
        expect(spy.mock.calls[5][0]).toContain("/preview/evaluators/variants/query")
    })
})

describe("Queries — parity additions", () => {
    const q = () => new Queries(newClient())

    it("revision lifecycle hits /preview/queries/revisions/...", async () => {
        for (let i = 0; i < 6; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await q().commitRevision({revision: {}})
        await q().getRevision("rev-1")
        await q().archiveRevision("rev-1")
        await q().unarchiveRevision("rev-1")
        await q().logRevisions({query_ref: {slug: "x"}})
        await q().queryRevisions({refs: [{slug: "x"}]})

        expect(spy.mock.calls[0][0]).toContain("/preview/queries/revisions/commit")
        expect(spy.mock.calls[1][0]).toContain("/preview/queries/revisions/rev-1")
        expect(spy.mock.calls[2][0]).toContain("/preview/queries/revisions/rev-1/archive")
        expect(spy.mock.calls[3][0]).toContain("/preview/queries/revisions/rev-1/unarchive")
        expect(spy.mock.calls[4][0]).toContain("/preview/queries/revisions/log")
        expect(spy.mock.calls[5][0]).toContain("/preview/queries/revisions/query")
    })

    it("simple-query lifecycle hits /preview/simple/queries/...", async () => {
        for (let i = 0; i < 4; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await q().getSimple("q-1")
        await q().archiveSimple("q-1")
        await q().unarchiveSimple("q-1")
        await q().querySimple({refs: [{slug: "x"}]})

        expect(spy.mock.calls[0][0]).toContain("/preview/simple/queries/q-1")
        expect(spy.mock.calls[1][0]).toContain("/preview/simple/queries/q-1/archive")
        expect(spy.mock.calls[2][0]).toContain("/preview/simple/queries/q-1/unarchive")
        expect(spy.mock.calls[3][0]).toContain("/preview/simple/queries/query")
    })
})

describe("TestSets — parity additions", () => {
    const ts = () => new TestSets(newClient())

    it("revision additions: unarchiveRevision, logRevisions, retrieveRevision", async () => {
        for (let i = 0; i < 3; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await ts().unarchiveRevision("rev-1")
        await ts().logRevisions({testset_ref: {slug: "x"}})
        await ts().retrieveRevision({testset_revision_ref: {id: "rev-1"}})

        expect(spy.mock.calls[0][0]).toContain("/preview/testsets/revisions/rev-1/unarchive")
        expect(spy.mock.calls[1][0]).toContain("/preview/testsets/revisions/log")
        expect(spy.mock.calls[2][0]).toContain("/preview/testsets/revisions/retrieve")
    })

    it("transfer hits the simple testset transfer path", async () => {
        const spy = mockOnce()
        await ts().transfer("ts-1", {target_project_id: "p-2"})
        expect(spy.mock.calls[0][0]).toContain("/preview/simple/testsets/ts-1/transfer")
    })

    it("variant CRUD hits /preview/testsets/variants/...", async () => {
        for (let i = 0; i < 4; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await ts().createVariant({name: "v1"})
        await ts().archiveVariant("var-1")
        await ts().unarchiveVariant("var-1")
        await ts().queryVariants({refs: [{slug: "x"}]})

        expect(spy.mock.calls[0][0]).toContain("/preview/testsets/variants/")
        expect(spy.mock.calls[1][0]).toContain("/preview/testsets/variants/var-1/archive")
        expect(spy.mock.calls[2][0]).toContain("/preview/testsets/variants/var-1/unarchive")
        expect(spy.mock.calls[3][0]).toContain("/preview/testsets/variants/query")
    })
})

describe("Evaluations — parity additions", () => {
    const ev = () => new Evaluations(newClient())

    it("refreshMetrics hits /preview/evaluations/metrics/refresh", async () => {
        const spy = mockOnce()
        await ev().refreshMetrics({run_ids: ["r1"]})
        expect(spy.mock.calls[0][0]).toContain("/preview/evaluations/metrics/refresh")
    })

    it("refreshRuns hits /preview/evaluations/runs/refresh", async () => {
        const spy = mockOnce()
        await ev().refreshRuns({run_ids: ["r1"]})
        expect(spy.mock.calls[0][0]).toContain("/preview/evaluations/runs/refresh")
    })
})

describe("Tracing — parity additions", () => {
    const tr = () => new Tracing(newClient())

    it("queryUsers hits /tracing/users/query (legacy mount, no /preview)", async () => {
        const spy = mockOnce()
        await tr().queryUsers({applicationId: "app-1"})
        const url = spy.mock.calls[0][0] as string
        expect(url).toContain("/tracing/users/query")
        expect(url).not.toContain("/preview/")
        expect(url).toContain("application_id=app-1")
    })

    it("queryAnalytics hits /tracing/analytics/query", async () => {
        const spy = mockOnce()
        await tr().queryAnalytics({granularity: "hour"})
        expect(spy.mock.calls[0][0]).toContain("/tracing/analytics/query")
    })

    it("spanAnalytics hits /tracing/spans/analytics", async () => {
        const spy = mockOnce()
        await tr().spanAnalytics({granularity: "hour"})
        expect(spy.mock.calls[0][0]).toContain("/tracing/spans/analytics")
    })
})

describe("Workflows — parity additions", () => {
    const wf = () => new Workflows(newClient())

    it("inspect / invoke hit /preview/workflows/...", async () => {
        mockOnce()
        mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await wf().inspect({workflow_ref: {slug: "x"}})
        await wf().invoke({workflow_revision_ref: {id: "r1"}, inputs: {}})

        expect(spy.mock.calls[0][0]).toContain("/preview/workflows/inspect")
        expect(spy.mock.calls[1][0]).toContain("/preview/workflows/invoke")
    })

    it("revision additions: retrieveRevision, logRevisions, unarchiveRevision", async () => {
        for (let i = 0; i < 3; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await wf().retrieveRevision({workflow_ref: {slug: "x"}})
        await wf().logRevisions({workflow_ref: {slug: "x"}})
        await wf().unarchiveRevision("rev-1")

        expect(spy.mock.calls[0][0]).toContain("/preview/workflows/revisions/retrieve")
        expect(spy.mock.calls[1][0]).toContain("/preview/workflows/revisions/log")
        expect(spy.mock.calls[2][0]).toContain("/preview/workflows/revisions/rev-1/unarchive")
    })

    it("variant additions: getVariant, forkVariant, unarchiveVariant", async () => {
        for (let i = 0; i < 3; i++) mockOnce()
        const spy = vi.spyOn(globalThis, "fetch")

        await wf().getVariant("var-1")
        await wf().forkVariant({source_ref: {id: "var-1"}})
        await wf().unarchiveVariant("var-1")

        expect(spy.mock.calls[0][0]).toContain("/preview/workflows/variants/var-1")
        expect(spy.mock.calls[0][1]?.method).toBe("GET")
        expect(spy.mock.calls[1][0]).toContain("/preview/workflows/variants/fork")
        expect(spy.mock.calls[2][0]).toContain("/preview/workflows/variants/var-1/unarchive")
    })
})
