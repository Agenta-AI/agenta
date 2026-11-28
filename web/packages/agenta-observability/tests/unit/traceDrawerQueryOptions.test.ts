import {describe, expect, it, vi} from "vitest"

const fetchPreviewTrace = vi.hoisted(() => vi.fn(async () => ({count: 1, traces: {}})))
vi.mock("@agenta/entities/trace", async (original) => ({
    ...(await original<typeof import("@agenta/entities/trace")>()),
    fetchPreviewTrace,
}))

import {traceDrawerQueryOptions} from "../../src/traceDrawer/traceDrawerStore"

const staleTimeOf = (options: ReturnType<typeof traceDrawerQueryOptions>, data: unknown) =>
    options.staleTime({state: {data: data as never}})

describe("traceDrawerQueryOptions", () => {
    it("keeps the trace drawer's query key", () => {
        const options = traceDrawerQueryOptions({
            traceId: "tr-1",
            projectId: "pr-1",
            canViewSpans: true,
        })
        expect(options.queryKey).toEqual(["trace-drawer", "tr-1", "pr-1"])
        expect(
            traceDrawerQueryOptions({traceId: null, projectId: null, canViewSpans: true}).queryKey,
        ).toEqual(["trace-drawer", "none", "none"])
    })

    it("runs only with a trace id and the right to view spans", () => {
        const enabled = (traceId: string | null, canViewSpans: boolean) =>
            traceDrawerQueryOptions({traceId, projectId: "pr-1", canViewSpans}).enabled
        expect(enabled("tr-1", true)).toBe(true)
        expect(enabled("tr-1", false)).toBe(false)
        expect(enabled(null, true)).toBe(false)
    })

    it("reads the trace by id in the project", async () => {
        const options = traceDrawerQueryOptions({
            traceId: "tr-1",
            projectId: "pr-1",
            canViewSpans: true,
        })
        await options.queryFn()
        expect(fetchPreviewTrace).toHaveBeenCalledWith("tr-1", "pr-1")
        expect(options.refetchOnWindowFocus).toBe(false)
    })

    it("keeps a trace with spans fresh and reads an empty or failed one again", () => {
        const options = traceDrawerQueryOptions({
            traceId: "tr-1",
            projectId: "pr-1",
            canViewSpans: true,
        })
        expect(
            staleTimeOf(options, {count: 1, traces: {tr1: {spans: {root: {span_id: "root"}}}}}),
        ).toBeGreaterThan(0)
        expect(staleTimeOf(options, {count: 1, traces: {tr1: {spans: {}}}})).toBe(0)
        expect(staleTimeOf(options, {count: 0, traces: {}})).toBe(0)
        expect(staleTimeOf(options, null)).toBe(0)
    })
})
