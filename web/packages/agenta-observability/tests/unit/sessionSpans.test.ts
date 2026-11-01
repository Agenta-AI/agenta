import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {atom, createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it, vi} from "vitest"

const {executeTraceQueryMock, fetchSessionsMock} = vi.hoisted(() => ({
    executeTraceQueryMock: vi.fn(),
    fetchSessionsMock: vi.fn(),
}))

vi.mock("../../src/api/queryHelpers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/api/queryHelpers")>()
    return {...actual, executeTraceQuery: executeTraceQueryMock}
})

vi.mock("@agenta/entities/access", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/access")>()
    return {...actual, canViewSpansAtom: atom(true)}
})

vi.mock("@agenta/entities/trace", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/trace")>()
    return {...actual, fetchSessions: fetchSessionsMock}
})

import {limitAtomFamily} from "../../src/state/controls"
import {
    filteredSessionIdsAtom,
    sessionsLoadingAtom,
    sessionsQueryAtom,
    sessionTraceCountAtomFamily,
} from "../../src/state/queries"

const sessionIdOf = (params: {filter?: string}) => {
    const conditions = JSON.parse(params.filter ?? "{}").conditions ?? []
    return conditions.find((c: {key?: string}) => c.key === "ag.session.id")?.value as string
}

async function waitFor(assertion: () => void, timeoutMs = 3000) {
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

describe("session spans", () => {
    it("fetches each session's spans once across two session pages", async () => {
        fetchSessionsMock.mockImplementation(async (body: {windowing: {newest?: string}}) =>
            body.windowing.newest === "cursor-2"
                ? {session_ids: ["s3", "s4"], count: 4}
                : {session_ids: ["s1", "s2"], count: 4, windowing: {newest: "cursor-2"}},
        )
        executeTraceQueryMock.mockImplementation(async ({params}) => {
            const sessionId = sessionIdOf(params)
            const traces = sessionId === "s2" ? [] : [{span_id: `${sessionId}-span`}]
            return {traces, traceCount: traces.length}
        })

        const store = createStore()
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(projectIdAtom, "proj-1")
        store.set(sessionAtom, true)
        store.set(limitAtomFamily("sessions"), 2)

        const unsubs = [
            store.sub(sessionsQueryAtom, () => {}),
            store.sub(filteredSessionIdsAtom, () => {}),
            store.sub(sessionsLoadingAtom, () => {}),
        ]

        await waitFor(() => expect(store.get(filteredSessionIdsAtom)).toEqual(["s1"]))
        expect(store.get(sessionsLoadingAtom)).toBe(false)

        await store.get(sessionsQueryAtom).fetchNextPage()

        await waitFor(() => expect(store.get(filteredSessionIdsAtom)).toEqual(["s1", "s3", "s4"]))
        expect(store.get(sessionTraceCountAtomFamily("s3"))).toBe(1)
        expect(
            executeTraceQueryMock.mock.calls.map(([args]) => sessionIdOf(args.params)).sort(),
        ).toEqual(["s1", "s2", "s3", "s4"])

        unsubs.forEach((unsub) => unsub())
    })

    it("keeps a session listed and loading while its spans are in flight", async () => {
        let release: (value: unknown) => void = () => {}
        fetchSessionsMock.mockResolvedValue({session_ids: ["p1"], count: 1})
        executeTraceQueryMock.mockReset()
        executeTraceQueryMock.mockReturnValue(new Promise((resolve) => (release = resolve)))

        const store = createStore()
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(projectIdAtom, "proj-2")
        store.set(sessionAtom, true)
        const unsubs = [
            store.sub(filteredSessionIdsAtom, () => {}),
            store.sub(sessionsLoadingAtom, () => {}),
        ]

        await waitFor(() => expect(executeTraceQueryMock).toHaveBeenCalledTimes(1))
        expect(store.get(filteredSessionIdsAtom)).toEqual(["p1"])
        expect(store.get(sessionsLoadingAtom)).toBe(true)

        release({traces: [{span_id: "p1-span"}], traceCount: 1})
        await waitFor(() => expect(store.get(sessionsLoadingAtom)).toBe(false))
        expect(store.get(sessionTraceCountAtomFamily("p1"))).toBe(1)

        unsubs.forEach((unsub) => unsub())
    })
})
