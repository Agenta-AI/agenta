/**
 * A page with its own filter set (the Sessions page locked to one agent) must never change the
 * filters the all-sessions pages share.
 */
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {
    createSessionFilterAtoms,
    type SessionFilterAtoms,
    resetSessionFiltersAtom,
    sessionAgentFilterAtom,
    sessionSearchAtom,
    sessionStatusFilterAtom,
    sharedSessionFilterAtoms,
} from "../../src/state/filters"
import {useSessionsList} from "../../src/state/useSessionsList"

describe("session filter atom sets", () => {
    it("exports the shared set under the existing names", () => {
        expect(sessionSearchAtom).toBe(sharedSessionFilterAtoms.search)
        expect(sessionAgentFilterAtom).toBe(sharedSessionFilterAtoms.agent)
        expect(resetSessionFiltersAtom).toBe(sharedSessionFilterAtoms.reset)
    })

    it("keeps a page's own set apart from the shared set", () => {
        const store = createStore()
        store.set(sessionSearchAtom, "refund")
        store.set(sessionStatusFilterAtom, "waiting")

        const own = createSessionFilterAtoms()
        store.set(own.search, "login")
        store.set(own.status, "running")
        store.set(own.showTriggered, true)
        store.set(own.reset)
        store.set(own.archivedOnly, true)

        expect(store.get(sessionSearchAtom)).toBe("refund")
        expect(store.get(sessionStatusFilterAtom)).toBe("waiting")
        expect(store.get(sharedSessionFilterAtoms.archivedOnly)).toBe(false)
        expect(store.get(own.search)).toBe("")
        expect(store.get(own.archivedOnly)).toBe(true)
        expect(store.get(own.activeExceptAgent)).toBe(true)
    })
})

// No react-dom in this package: the hooks run as plain functions over one store, and the
// context holds what a provider would give.
const hookEnv = vi.hoisted(() => ({store: null as unknown, context: null as unknown}))
vi.mock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>()
    return {
        ...actual,
        useContext: (context: {_currentValue?: unknown}) =>
            hookEnv.context ?? (context as {_currentValue: unknown})._currentValue,
        useMemo: (make: () => unknown) => make(),
        useCallback: (fn: unknown) => fn,
        useEffect: () => undefined,
    }
})
vi.mock("jotai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("jotai")>()
    type Store = ReturnType<typeof actual.createStore>
    return {
        ...actual,
        useAtomValue: (a: Parameters<Store["get"]>[0]) => (hookEnv.store as Store).get(a),
        useSetAtom: () => () => undefined,
    }
})
vi.mock("@agenta/i18n", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useT: () => (key: string) => key,
}))

const listCalls = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock("../../src/state/useSessionList", () => ({
    pendingBySessionId: () => undefined,
    rowsFromPages: () => [],
    useActionableInteractions: () => ({data: undefined}),
    useSessionList: (options: Record<string, unknown>) => {
        listCalls.push(options)
        return {
            data: undefined,
            hasNextPage: false,
            isFetchingNextPage: false,
            isFetchNextPageError: false,
            fetchNextPage: () => undefined,
            refetch: () => undefined,
            isPending: false,
            isPlaceholderData: false,
            isError: false,
        }
    },
}))

describe("useSessionsList under a filter set", () => {
    const POLICY = {origin: "exclude-trigger", expansions: []} as const
    const renderUnder = (
        filterSet: SessionFilterAtoms | null,
        store: ReturnType<typeof createStore>,
    ) => {
        listCalls.length = 0
        hookEnv.store = store
        hookEnv.context = filterSet
        useSessionsList({agentId: "support", defaultPolicy: POLICY, automationPolicy: POLICY})
        // The main list's request (the pinned one asks by id).
        return listCalls.find((call) => !call.sessionIds)!
    }

    it("reads the provided set, with the page's agent", () => {
        const store = createStore()
        store.set(sessionStatusFilterAtom, "waiting")
        const own = createSessionFilterAtoms()
        store.set(own.status, "running")
        const call = renderUnder(own, store)
        expect(call.status).toBe("running")
        expect(call.agentId).toBe("support")
    })

    it("reads the shared set without a provider", () => {
        const store = createStore()
        store.set(sessionStatusFilterAtom, "waiting")
        expect(renderUnder(null, store).status).toBe("waiting")
    })
})
