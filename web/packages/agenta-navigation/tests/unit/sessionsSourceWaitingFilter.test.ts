/**
 * "Awaiting input" has no server predicate: the sidebar resolves the gated session ids itself and
 * pushes them down as an explicit id list. The head query did that; the tail query the rail loads
 * on scroll did not, so from the second page on the server answered with every session older than
 * the boundary and the filter leaked. These tests pin the id set onto both requests.
 */
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const querySessions = vi.fn()
const queryInteractions = vi.fn()

vi.mock("@agenta/entities/session", () => ({
    querySessions: (...args: unknown[]) => querySessions(...args),
    queryInteractions: (...args: unknown[]) => queryInteractions(...args),
    livenessPollInterval: () => false,
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        agentWorkflowsListQueryStateAtom: atom({data: [], isPending: false}),
        appWorkflowsListQueryAtom: atom({data: {refs: []}}),
        workflowMolecule: {selectors: {artifactName: () => atom(null)}},
    }
})

vi.mock("@agenta/sessions/row", () => ({
    isAutomationSession: () => false,
    sessionOpenTarget: (row: {session_id: string}) => ({appId: `app-${row.session_id}`}),
}))

vi.mock("@agenta/sessions/state", async () => {
    const {atom} = await import("jotai")
    return {pinnedSessionIdsAtom: atom([] as string[])}
})

vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {idleReadyAtom: atom(true), projectIdAtom: atom("project-1" as string | null)}
})

// The real filters atom is storage-backed, which does not round-trip under `node`. Swap it for a
// plain writable atom so the test and the source read the same instance.
vi.mock("../../src/dynamic/sessionFilters", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    const {atom} = await import("jotai")
    const {atomFamily} = await import("jotai-family")
    const base = atomFamily((_scopeId: string) =>
        atom({
            agentIds: [] as string[],
            status: "all",
            activity: "7d",
            type: "chat",
            groupBy: "date",
        } as any),
    )
    return {
        ...actual,
        sidebarSessionFiltersAtomFamily: atomFamily((scopeId: string) =>
            atom(
                (get) => get(base(scopeId)),
                (get, set, next: Record<string, unknown>) =>
                    set(base(scopeId), {...(get(base(scopeId)) as object), ...next} as any),
            ),
        ),
    }
})

const memory = new Map<string, string>()
;(globalThis as unknown as {localStorage: unknown}).localStorage = {
    getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size
    },
}

const PAGE_SIZE = 50

const sessionRow = (id: string) => ({
    session_id: id,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: `2026-09-0${(Number(id.slice(1)) % 9) + 1}T00:00:00Z`,
    flags: {is_alive: true, is_running: false},
})

const settle = async (ticks = 12) => {
    for (let index = 0; index < ticks; index++)
        await new Promise((resolve) => setTimeout(resolve, 0))
}

const newStore = () => {
    const store = createStore()
    store.set(
        queryClientAtom,
        new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}}),
    )
    return store
}

describe("Awaiting input sidebar filter and the paging tail", () => {
    beforeEach(() => {
        querySessions.mockReset()
        queryInteractions.mockReset()
    })

    it("carries the waiting id set on the tail request, not only on the head", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {sidebarSessionFiltersAtomFamily} = await import("../../src/dynamic/sessionFilters")
        const {sidebarSessionPagingAtomFamily, loadMoreSidebarSessionsAtomFamily} =
            await import("../../src/dynamic/sessionsSource")

        // A full head window is what unlocks paging, so the leak needs at least that many gated
        // sessions to be reachable at all.
        const waitingIds = Array.from({length: 60}, (_, index) => `s${index}`)
        queryInteractions.mockResolvedValue(waitingIds.map((id) => ({session_id: id})))
        querySessions.mockImplementation(async (args: {sessionIds?: string[]}) =>
            (args.sessionIds ?? waitingIds).slice(0, PAGE_SIZE).map(sessionRow),
        )

        const store = newStore()
        const scope = MAIN_SIDEBAR_SCOPE_ID
        store.set(sidebarSessionFiltersAtomFamily(scope), {status: "waiting"})

        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        const headCalls = querySessions.mock.calls.map(([args]) => args)
        expect(headCalls.length).toBeGreaterThan(0)
        expect(headCalls[0].sessionIds).toEqual(waitingIds)
        expect(store.get(sidebarSessionPagingAtomFamily(scope)).hasMore).toBe(true)

        querySessions.mockClear()
        store.set(loadMoreSidebarSessionsAtomFamily(scope))
        await settle()

        const tailCalls = querySessions.mock.calls.map(([args]) => args)
        expect(tailCalls.length).toBeGreaterThan(0)
        const tail = tailCalls[tailCalls.length - 1]
        expect(tail.sessionIds).toEqual(waitingIds)
        expect(tail.newest).toBeTruthy()
        expect(tail.limit).toBe(PAGE_SIZE)

        unsubscribe()
    })

    it("leaves the tail request unfiltered by id under any other status", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {sidebarSessionFiltersAtomFamily} = await import("../../src/dynamic/sessionFilters")
        const {sidebarSessionPagingAtomFamily, loadMoreSidebarSessionsAtomFamily} =
            await import("../../src/dynamic/sessionsSource")

        const allIds = Array.from({length: 60}, (_, index) => `s${index}`)
        queryInteractions.mockResolvedValue([])
        querySessions.mockImplementation(async () => allIds.slice(0, PAGE_SIZE).map(sessionRow))

        const store = newStore()
        const scope = MAIN_SIDEBAR_SCOPE_ID
        store.set(sidebarSessionFiltersAtomFamily(scope), {status: "all"})

        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        expect(store.get(sidebarSessionPagingAtomFamily(scope)).hasMore).toBe(true)

        querySessions.mockClear()
        store.set(loadMoreSidebarSessionsAtomFamily(scope))
        await settle()

        const tailCalls = querySessions.mock.calls.map(([args]) => args)
        expect(tailCalls.length).toBeGreaterThan(0)
        expect(tailCalls[tailCalls.length - 1].sessionIds).toBeUndefined()

        unsubscribe()
    })

    it("cannot page at all when fewer than one window of sessions are awaiting input", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {sidebarSessionFiltersAtomFamily} = await import("../../src/dynamic/sessionFilters")
        const {sidebarSessionPagingAtomFamily} = await import("../../src/dynamic/sessionsSource")

        const waitingIds = ["a", "b", "c"]
        queryInteractions.mockResolvedValue(waitingIds.map((id) => ({session_id: id})))
        querySessions.mockImplementation(async (args: {sessionIds?: string[]}) =>
            (args.sessionIds ?? []).map(sessionRow),
        )

        const store = newStore()
        const scope = MAIN_SIDEBAR_SCOPE_ID
        store.set(sidebarSessionFiltersAtomFamily(scope), {status: "waiting"})

        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        expect(store.get(sidebarSessionPagingAtomFamily(scope)).hasMore).toBe(false)
        unsubscribe()
    })
})
