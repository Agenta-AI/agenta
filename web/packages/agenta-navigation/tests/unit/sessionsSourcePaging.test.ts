/**
 * The session rail's tail used to ask for `pageSize * pages` rows in one request. The sessions
 * query caps `windowing.limit` at 200 and answers 422 above it, so the fifth page at size 50 came
 * back empty, the rail collapsed from 250 rows to its head window of 50, and no project with more
 * than 250 sessions could reach an older one. The narrow scope hit the same wall at its eleventh
 * page, 220 rows at size 20.
 *
 * These tests pin the walk: every request stays at one page size, the pages accumulate, and the
 * page count belongs to a project so a switch does not start the new one deep in the list.
 */
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const querySessions = vi.fn()
const querySessionsFlatPage = vi.fn()
const queryInteractions = vi.fn()

vi.mock("@agenta/entities/session", () => ({
    querySessions: (...args: unknown[]) => querySessions(...args),
    querySessionsFlatPage: (...args: unknown[]) => querySessionsFlatPage(...args),
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

// The real filters atom is storage-backed, which does not round-trip under `node`.
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

/** What the server refuses above. A request over this answers 422 and returns no rows at all. */
const SERVER_LIMIT = 200

const BASE_TIME = Date.UTC(2026, 8, 1)

/** Newest first, one minute apart, so an index is also a position in the list. */
const row = (index: number) => ({
    id: `row-${index}`,
    session_id: `s${index}`,
    created_at: new Date(BASE_TIME - index * 60_000).toISOString(),
    updated_at: new Date(BASE_TIME - index * 60_000).toISOString(),
    flags: {is_alive: true, is_running: false},
})

interface PageRequest {
    limit: number
    next?: string
    newest?: string
    order?: string
}

/**
 * A project holding `total` sessions, answering the way the real endpoint does: at most `limit`
 * rows, and a cursor on the last row whenever the page came back full.
 */
const project = (total: number) => {
    const all = Array.from({length: total}, (_, index) => row(index))
    return async (args: PageRequest) => {
        // The 422 the real endpoint answers above the cap. The client reads a rejected query as
        // no answer, which is what emptied the tail and collapsed the rail.
        if (args.limit > SERVER_LIMIT) return null
        let start = 0
        if (args.next) {
            const at = all.findIndex((entry) => entry.id === args.next)
            start = at >= 0 ? at + 1 : all.length
        } else if (args.newest) {
            const at = all.findIndex((entry) => entry.updated_at < args.newest!)
            start = at >= 0 ? at : all.length
        }
        const sessions = all.slice(start, start + args.limit)
        const last = sessions[sessions.length - 1]
        const full = sessions.length === args.limit && last
        return {
            count: sessions.length,
            sessions,
            windowing: full
                ? {next: last.id, newest: last.updated_at, limit: args.limit}
                : {limit: args.limit},
        }
    }
}

const settle = async (ticks = 20) => {
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

/** The main rail reads 50 rows a page; every other scope reads 20. */
const MAIN_PAGE_SIZE = 50
const NARROW_PAGE_SIZE = 20
const NARROW_SCOPE = "test-narrow-scope"

const pageTo = async (store: any, scope: string, target: number) => {
    const {loadMoreSidebarSessionsAtomFamily, sidebarSessionPagingAtomFamily} =
        await import("../../src/dynamic/sessionsSource")
    for (let page = 0; page < target; page++) {
        expect(store.get(sidebarSessionPagingAtomFamily(scope)).hasMore).toBe(true)
        store.set(loadMoreSidebarSessionsAtomFamily(scope))
        await settle()
    }
}

describe("session rail paging past the server's limit", () => {
    beforeEach(() => {
        querySessions.mockReset()
        querySessionsFlatPage.mockReset()
        queryInteractions.mockReset()
        memory.clear()
    })

    it.each([
        ["the main rail", undefined, MAIN_PAGE_SIZE, 5],
        ["the narrow rail", NARROW_SCOPE, NARROW_PAGE_SIZE, 11],
    ])(
        "keeps every %s request inside the server limit while paging past it",
        async (_label, scopeOverride, pageSize, pages) => {
            const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
            const {sidebarSessionPagingAtomFamily} =
                await import("../../src/dynamic/sessionsSource")
            const scope = scopeOverride ?? MAIN_SIDEBAR_SCOPE_ID

            const serve = project(1_000)
            queryInteractions.mockResolvedValue([])
            querySessions.mockImplementation(async (args: PageRequest) => {
                const page = await serve(args)
                return page ? page.sessions : null
            })
            querySessionsFlatPage.mockImplementation(serve)

            const store = newStore()
            const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
            store.get(sidebarSessionPagingAtomFamily(scope))
            await settle()

            await pageTo(store, scope, pages)

            const requests = querySessionsFlatPage.mock.calls.map(([args]) => args as PageRequest)
            expect(requests.length).toBeGreaterThan(0)

            // The whole point: no single request may cross the cap, at either page size.
            const widest = Math.max(...requests.map((request) => request.limit))
            expect(widest).toBe(pageSize)
            expect(widest).toBeLessThanOrEqual(SERVER_LIMIT)

            // The last read walks one request per page, and every one after the first carries a
            // cursor rather than a wider window. A read starts at the one request with no cursor.
            // A read opens with one cursor-less request and then follows the server's cursor.
            expect(requests.some((request) => request.next === undefined)).toBe(true)

            // How deep the walk actually got. The head holds the first window and the tail walks
            // `pages` more, so the last cursor names row `pageSize * pages - 1`. Reaching it is
            // the proof that rows past the cap are fetched rather than thrown away: the single
            // widening request answered 422 from `pageSize * 5` upward and returned nothing.
            const deepest = Math.max(
                ...requests
                    .map((request) => Number(request.next?.replace("row-", "") ?? -1))
                    .filter((index) => index >= 0),
            )
            expect(deepest).toBe(pageSize * pages - 1)
            expect(deepest).toBeGreaterThan(SERVER_LIMIT)

            // Rows already scrolled past are still held: `hasMore` needs a full tail, which past
            // the cap is exactly what the single widening request could not return.
            expect(store.get(sidebarSessionPagingAtomFamily(scope)).hasMore).toBe(true)
            unsubscribe()
        },
    )

    it("stops walking when the list ends instead of spending the remaining requests", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {sidebarSessionPagingAtomFamily} = await import("../../src/dynamic/sessionsSource")
        const scope = MAIN_SIDEBAR_SCOPE_ID

        // 170 rows: the head takes 50, so the tail ends part-way through its third page.
        const serve = project(170)
        queryInteractions.mockResolvedValue([])
        querySessions.mockImplementation(async (args: PageRequest) => {
            const page = await serve(args)
            return page ? page.sessions : null
        })
        querySessionsFlatPage.mockImplementation(serve)

        const store = newStore()
        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        await pageTo(store, scope, 3)

        const lastRead = querySessionsFlatPage.mock.calls
            .map(([args]) => args as PageRequest)
            .slice(-3)
        expect(lastRead.length).toBeLessThanOrEqual(3)
        // A short page is the end of the list, so `hasMore` closes rather than asking again.
        expect(store.get(sidebarSessionPagingAtomFamily(scope)).hasMore).toBe(false)
        unsubscribe()
    })

    it("keeps walking when a row in a full page fails validation", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {sidebarSessionPagingAtomFamily} = await import("../../src/dynamic/sessionsSource")
        const scope = MAIN_SIDEBAR_SCOPE_ID

        const serve = project(1_000)
        queryInteractions.mockResolvedValue([])
        querySessions.mockImplementation(async (args: PageRequest) => {
            const page = await serve(args)
            return page ? page.sessions : null
        })
        // `parseSessionsQueryResponse` drops a row the frontend schema does not know yet and
        // leaves `count` alone, so a full page can arrive one row short. Reading the survivors
        // rather than `count` would take that for the end of the list.
        querySessionsFlatPage.mockImplementation(async (args: PageRequest) => {
            const page = await serve(args)
            if (!page || page.sessions.length < args.limit) return page
            return {...page, sessions: page.sessions.slice(0, -1)}
        })

        const store = newStore()
        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        await pageTo(store, scope, 5)

        const cursors = querySessionsFlatPage.mock.calls
            .map(([args]) => (args as PageRequest).next)
            .filter(Boolean)
        expect(cursors.length).toBeGreaterThan(0)
        const deepest = Math.max(...cursors.map((next) => Number(next!.replace("row-", ""))))
        // One dropped row per page must not end the walk after the first page.
        expect(deepest).toBe(MAIN_PAGE_SIZE * 5 - 1)
        unsubscribe()
    })

    it("fails the tail query when a request mid-walk fails", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {loadMoreSidebarSessionsAtomFamily, sidebarSessionPagingAtomFamily} =
            await import("../../src/dynamic/sessionsSource")
        const scope = MAIN_SIDEBAR_SCOPE_ID

        const serve = project(1_000)
        queryInteractions.mockResolvedValue([])
        querySessions.mockImplementation(async (args: PageRequest) => {
            const page = await serve(args)
            return page ? page.sessions : null
        })

        querySessionsFlatPage.mockImplementation(serve)

        const store = newStore()
        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        await pageTo(store, scope, 2)
        expect(store.get(sidebarSessionPagingAtomFamily(scope)).isError).toBe(false)

        // From here every request past the walk's second page answers with nothing. Keyed on the
        // cursor rather than a call counter so it fails at the same depth on every read.
        // Returning the pages read so far as a success would store a truncated list that React
        // Query treats as complete and never retries.
        const failFrom = `row-${MAIN_PAGE_SIZE * 3 - 1}`
        querySessionsFlatPage.mockImplementation(async (args: PageRequest) =>
            args.next === failFrom ? null : serve(args),
        )

        store.set(loadMoreSidebarSessionsAtomFamily(scope))
        await settle()

        expect(store.get(sidebarSessionPagingAtomFamily(scope)).isError).toBe(true)
        unsubscribe()
    })

    it("drops the page count and the frozen boundary when the project changes", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {projectIdAtom} = await import("@agenta/shared/state")
        const {sidebarSessionPageCountAtomFamily, sidebarSessionPagingAtomFamily} =
            await import("../../src/dynamic/sessionsSource")
        const scope = MAIN_SIDEBAR_SCOPE_ID

        const serve = project(1_000)
        queryInteractions.mockResolvedValue([])
        querySessions.mockImplementation(async (args: PageRequest) => {
            const page = await serve(args)
            return page ? page.sessions : null
        })
        querySessionsFlatPage.mockImplementation(serve)

        const store = newStore()
        const unsubscribe = store.sub(sidebarSessionPagingAtomFamily(scope), () => {})
        store.get(sidebarSessionPagingAtomFamily(scope))
        await settle()

        await pageTo(store, scope, 3)
        expect(store.get(sidebarSessionPageCountAtomFamily(scope))).toBe(3)

        store.set(projectIdAtom, "project-2")
        await settle()

        // Otherwise the new project renders several hundred rows at once, and its tail is frozen
        // at a boundary taken from a list the user has left.
        expect(store.get(sidebarSessionPageCountAtomFamily(scope))).toBe(0)

        store.set(projectIdAtom, "project-1")
        expect(store.get(sidebarSessionPageCountAtomFamily(scope))).toBe(3)
        unsubscribe()
    })
})
