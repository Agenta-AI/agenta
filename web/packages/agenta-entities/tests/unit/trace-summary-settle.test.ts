/**
 * What a turn's trace query does when the turn was first read MID-RUN.
 *
 * A turn a tab meets already in progress reads its trace while the run is still going, to count
 * from the run's own start rather than from the tab (#7013). A run's spans all reach the backend
 * in one batch when it ends, so that read finds nothing — and this query keeps what it learns for
 * the life of the page (`staleTime: Infinity`, `retryOnMount: false`). The pre-run answer must
 * therefore be dropped when the run settles, or the turn shows no duration, no timestamp and no
 * latency for good, however long it actually ran.
 *
 * The other half matters just as much: a trace read AFTER its run is final, and refetching it is
 * wasted work, so settling one turn must not make this query chatty for any other.
 *
 * Each test uses its own trace id: which traces this client has seen finish is module state that
 * outlives a test, and it decides how hard a not-found is retried.
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchAllPreviewTracesMock} = vi.hoisted(() => ({fetchAllPreviewTracesMock: vi.fn()}))

vi.mock("../../src/trace/api/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/trace/api/api")>()
    return {...actual, fetchAllPreviewTraces: fetchAllPreviewTracesMock}
})

import {traceDataSummaryAtomFamily} from "../../src/loadable/controller"
import {markTraceAsFresh, traceSummaryQueryAtomFamily} from "../../src/trace/state/store"

const PROJECT_ID = "proj-1"

/** Trace ids as the stream's `done` record carries them: 32 hex characters, no dashes. */
const MID_FLIGHT_TRACE = "342e31eddc4be65c6111a88dfa061932"
const UNWATCHED_TRACE = "99998888777766665555444433332222"
const DASHED_CASE_TRACE = "11112222333344445555666677778888"
const SETTLED_TRACE = "aaaabbbbccccddddeeeeffff00001111"
const UNRELATED_TRACE = "d7fce9bb14c7ceaa0fc7c1afbfe90a60"

const DURATION_MS = 50_668

/** The run's root span, as it exists only once the run has ended: 50.668s of work. */
const rootSpanFor = (traceId: string) => ({
    trace_id: traceId,
    span_id: "0437b4fcf0700ef9",
    parent_id: null,
    span_name: "_agent",
    span_kind: "SPAN_KIND_INTERNAL",
    start_time: "2026-09-21T18:38:53.935Z",
    end_time: "2026-09-21T18:39:44.603Z",
    status_code: "STATUS_CODE_UNSET",
    attributes: {ag: {}},
})

/** Mid-run the query matches no spans at all: nothing for this trace has been exported yet. */
const noSpansYet = {count: 0, spans: []}
const settled = (traceId: string) => ({count: 1, spans: [rootSpanFor(traceId)]})

const store = getDefaultStore()

const summaryOf = (traceId: string) => store.get(traceDataSummaryAtomFamily(traceId))

/** Under vitest's own 5s cap, so a failure reads as the assertion that never held. */
async function waitForAssertion(assertion: () => void, timeoutMs = 3000) {
    const startedAt = Date.now()
    let lastError: unknown
    while (Date.now() - startedAt < timeoutMs) {
        try {
            assertion()
            return
        } catch (error) {
            lastError = error
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    throw lastError
}

describe("trace summary across a run settling", () => {
    beforeEach(() => {
        fetchAllPreviewTracesMock.mockReset()
        // Drop every cached atom instance so each test starts from an empty query cache.
        traceSummaryQueryAtomFamily.clear()
        store.set(queryClientAtom, new QueryClient())
        store.set(projectIdAtom, PROJECT_ID)
        store.set(sessionAtom, true)
    })

    it("recovers the duration when the run this tab met mid-flight settles", async () => {
        fetchAllPreviewTracesMock.mockResolvedValue(noSpansYet)
        const unsub = store.sub(traceDataSummaryAtomFamily(MID_FLIGHT_TRACE), () => {})

        try {
            // While the run is in flight there is nothing to read, and the query keeps that.
            await waitForAssertion(() => {
                expect(fetchAllPreviewTracesMock).toHaveBeenCalled()
                expect(summaryOf(MID_FLIGHT_TRACE).isPending).toBe(false)
            })
            expect(summaryOf(MID_FLIGHT_TRACE).rootSpan).toBeNull()
            expect(summaryOf(MID_FLIGHT_TRACE).metrics.durationMs).toBeUndefined()

            // The run ends: its spans land, and the stream tells this tab so.
            fetchAllPreviewTracesMock.mockResolvedValue(settled(MID_FLIGHT_TRACE))
            markTraceAsFresh(MID_FLIGHT_TRACE)

            await waitForAssertion(() => {
                expect(summaryOf(MID_FLIGHT_TRACE).metrics.durationMs).toBe(DURATION_MS)
            })
            expect(summaryOf(MID_FLIGHT_TRACE).rootSpan?.span_name).toBe("_agent")
        } finally {
            unsub()
        }
    })

    it("leaves no failed read behind on a turn nobody is watching", async () => {
        // The turn scrolled out of view, or the reader moved on, before the run ended. Settling a
        // run only refetches queries something still watches, which is enough ONLY while an
        // unwatched query keeps no error to get stuck on: a query that errored with no data does
        // not fetch on its next mount either, because `retryOnMount: false` blocks that. So this
        // pins the assumption. If it ever fails, settling has to clear the error, not mark it
        // stale, and `dropPreSettleTraceAnswer` needs `resetQueries` instead.
        fetchAllPreviewTracesMock.mockResolvedValue(noSpansYet)
        const queryClient = store.get(queryClientAtom)
        const key = ["trace-summary", PROJECT_ID, UNWATCHED_TRACE]

        const unsub = store.sub(traceDataSummaryAtomFamily(UNWATCHED_TRACE), () => {})
        await waitForAssertion(() => {
            expect(summaryOf(UNWATCHED_TRACE).isPending).toBe(false)
        })
        expect(queryClient.getQueryState(key)?.status).toBe("error")
        unsub()

        expect(queryClient.getQueryState(key)?.status).not.toBe("error")

        // And coming back to the turn asks again rather than re-showing the pre-run answer.
        fetchAllPreviewTracesMock.mockResolvedValue(settled(UNWATCHED_TRACE))
        const remount = store.sub(traceDataSummaryAtomFamily(UNWATCHED_TRACE), () => {})
        try {
            await waitForAssertion(() => {
                expect(summaryOf(UNWATCHED_TRACE).metrics.durationMs).toBe(DURATION_MS)
            })
        } finally {
            remount()
        }
    })

    it("matches the trace whichever way its id is spelled", async () => {
        fetchAllPreviewTracesMock.mockResolvedValue(noSpansYet)
        const unsub = store.sub(traceDataSummaryAtomFamily(DASHED_CASE_TRACE), () => {})

        try {
            await waitForAssertion(() => {
                expect(summaryOf(DASHED_CASE_TRACE).isPending).toBe(false)
            })

            fetchAllPreviewTracesMock.mockResolvedValue(settled(DASHED_CASE_TRACE))
            // The same trace, dashed — the form a trace id takes elsewhere in the app.
            markTraceAsFresh("11112222-3333-4444-5555-666677778888")

            await waitForAssertion(() => {
                expect(summaryOf(DASHED_CASE_TRACE).metrics.durationMs).toBe(DURATION_MS)
            })
        } finally {
            unsub()
        }
    })

    it("keeps a settled trace cached, and re-reads nothing when another run settles", async () => {
        fetchAllPreviewTracesMock.mockResolvedValue(settled(SETTLED_TRACE))
        const unsub = store.sub(traceDataSummaryAtomFamily(SETTLED_TRACE), () => {})

        try {
            await waitForAssertion(() => {
                expect(summaryOf(SETTLED_TRACE).metrics.durationMs).toBe(DURATION_MS)
            })
            expect(fetchAllPreviewTracesMock).toHaveBeenCalledTimes(1)

            // A second reader of the same settled trace is served from the cache.
            const second = store.sub(traceDataSummaryAtomFamily(SETTLED_TRACE), () => {})
            second()

            // Some OTHER turn finishing is not news about this one.
            markTraceAsFresh(UNRELATED_TRACE)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(fetchAllPreviewTracesMock).toHaveBeenCalledTimes(1)
            expect(summaryOf(SETTLED_TRACE).metrics.durationMs).toBe(DURATION_MS)
        } finally {
            unsub()
        }
    })
})
