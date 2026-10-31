// Trace content is readable only by a role that holds `view_spans`. Without it, the trace atoms
// send no request at all, and every display that builds on the summary falls back to what the
// turn itself carries. With it, the same atoms read the trace as before.
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const check = vi.hoisted(() => ({allowed: false, calls: [] as string[]}))
vi.mock("@agenta/sdk/resources", () => ({
    getAccessClient: () => ({
        checkPermissions: async ({action}: {action: string}) => {
            check.calls.push(action)
            if (!check.allowed) throw new Error("403")
            return {}
        },
    }),
}))

// Every span and trace read of the summary goes through this one fetcher, which posts to
// `/spans/query` or `/traces/query`.
const traces = vi.hoisted(() => ({fetch: vi.fn()}))
vi.mock("../../src/trace/api", async (original) => ({
    ...(await original<object>()),
    fetchAllPreviewTraces: traces.fetch,
}))

import {canViewSpansAtom} from "../../src/access"
import {traceDataSummaryAtomFamily} from "../../src/loadable"
import {traceSummaryQueryAtomFamily} from "../../src/trace/state/store"

const ROOT_SPAN = {
    trace_id: "trace-1",
    span_id: "span-1",
    parent_id: null,
    span_name: "agent",
    start_time: "2026-10-30T10:00:00Z",
    end_time: "2026-10-30T10:00:05Z",
}

const store = () => {
    const jotai = createStore()
    jotai.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    jotai.set(projectIdAtom, "project-1")
    jotai.set(sessionAtom, "session-token")
    return jotai
}

/** Mount the summary, as a screen does, and wait until the permission answer is in. */
const mountSummary = async (jotai: ReturnType<typeof store>) => {
    const stop = jotai.sub(traceDataSummaryAtomFamily("trace-1"), () => undefined)
    const stopGate = jotai.sub(canViewSpansAtom, () => undefined)
    await vi.waitFor(() => expect(check.calls).toContain("view_spans"))
    // One more tick for the answer to settle into the atoms.
    await new Promise((resolve) => setTimeout(resolve, 0))
    return () => {
        stop()
        stopGate()
    }
}

beforeEach(() => {
    check.allowed = false
    check.calls = []
    traces.fetch.mockReset()
    traces.fetch.mockResolvedValue({spans: [ROOT_SPAN]})
})

describe("trace reads without view_spans", () => {
    it("asks the backend once and reads no trace after a refusal", async () => {
        const jotai = store()
        const stop = await mountSummary(jotai)

        expect(check.calls).toEqual(["view_spans"])
        expect(jotai.get(canViewSpansAtom)).toBe(false)
        // Give a wrongly opened gate the time to fetch, so its absence means something.
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(traces.fetch).not.toHaveBeenCalled()
        expect(jotai.get(traceSummaryQueryAtomFamily("trace-1")).fetchStatus).toBe("idle")

        const summary = jotai.get(traceDataSummaryAtomFamily("trace-1"))
        expect(summary.isPending).toBe(false)
        expect(summary.rootSpan).toBeNull()
        stop()
    })

    it("reads no trace while the answer is still in flight", () => {
        const jotai = store()
        const stop = jotai.sub(traceDataSummaryAtomFamily("trace-1"), () => undefined)

        expect(jotai.get(canViewSpansAtom)).toBe(false)
        expect(traces.fetch).not.toHaveBeenCalled()
        // Pending, not empty: a reader who may read traces sees no "no answer" text yet.
        expect(jotai.get(traceDataSummaryAtomFamily("trace-1")).isPending).toBe(true)
        stop()
    })
})

describe("trace reads with view_spans", () => {
    it("reads the trace once the backend allows it", async () => {
        check.allowed = true
        const jotai = store()
        const stop = await mountSummary(jotai)

        await vi.waitFor(() => expect(jotai.get(canViewSpansAtom)).toBe(true))
        await vi.waitFor(() => expect(traces.fetch).toHaveBeenCalled())
        stop()
    })
})
