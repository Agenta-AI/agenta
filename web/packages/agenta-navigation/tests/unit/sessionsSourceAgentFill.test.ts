/**
 * Each agent section of the main sidebar shows 4 rows. When the first page holds the sessions of
 * a few busy agents, the rail is too short to scroll, and the agents whose sessions are on later
 * pages never load. `hasUnloadedAgent` says when the rail must ask for the next page itself.
 */
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it, vi} from "vitest"

const querySessions = vi.hoisted(() => vi.fn())
vi.mock("@agenta/entities/session", () => ({
    querySessions: (...args: unknown[]) => querySessions(...args),
    querySessionsFlatPage: vi.fn(async () => ({count: 0, sessions: [], windowing: {}})),
    queryInteractions: vi.fn(async () => []),
    livenessPollInterval: () => false,
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        agentWorkflowsListQueryStateAtom: atom({data: [], isPending: false}),
        appWorkflowsListQueryAtom: atom({data: {refs: [{id: "support"}, {id: "email"}]}}),
        workflowMolecule: {selectors: {artifactName: () => atom(null)}},
    }
})

vi.mock("@agenta/sessions/row", () => ({
    isAutomationSession: () => false,
    sessionOpenTarget: (row: {agent?: string}) => (row.agent ? {appId: row.agent} : null),
}))

vi.mock("@agenta/sessions/state", async () => {
    const {atom} = await import("jotai")
    return {pinnedSessionIdsAtom: atom([] as string[])}
})

vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {idleReadyAtom: atom(true), projectIdAtom: atom("project-1" as string | null)}
})

const filters = vi.hoisted(() => ({
    value: {agentIds: [], status: "all", activity: "7d", type: "chat", groupBy: "agent"} as Record<
        string,
        unknown
    >,
}))
vi.mock("../../src/dynamic/sessionFilters", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    const {atom} = await import("jotai")
    const {atomFamily} = await import("jotai-family")
    return {
        ...actual,
        sidebarSessionFiltersAtomFamily: atomFamily((_scopeId: string) =>
            atom(() => filters.value),
        ),
    }
})

const ref = (sessionId: string, agentId: string) =>
    ({
        id: sessionId,
        sessionId,
        name: sessionId,
        appId: agentId,
        agentId,
        pinned: false,
        alive: false,
    }) as never

const NOW = Date.UTC(2026, 10, 20)
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString()
const chat = (agentId: string, days: number) =>
    ({session_id: `${agentId}-${days}`, agent: agentId, updated_at: daysAgo(days)}) as never
const WEEK = daysAgo(7)

describe("hasUnloadedAgent", () => {
    it("asks for more while an agent with a chat in the window has no loaded row", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                chats: [chat("support", 0), chat("email", 3)],
                loadedRefs: [ref("s1", "support")],
                agentFilter: [],
                oldest: WEEK,
            }),
        ).toBe(true)
    })

    it("stops once every agent with a chat in the window has a row", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                chats: [chat("support", 0), chat("email", 3)],
                loadedRefs: [ref("s1", "support"), ref("s2", "email")],
                agentFilter: [],
                oldest: WEEK,
            }),
        ).toBe(false)
    })

    it("ignores agents whose chats are older than the rail's window", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                chats: [chat("support", 0), chat("email", 30)],
                loadedRefs: [ref("s1", "support")],
                agentFilter: [],
                oldest: WEEK,
            }),
        ).toBe(false)
    })

    it("ignores agents outside the agent filter", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                chats: [chat("support", 0), chat("email", 1)],
                loadedRefs: [ref("s1", "support")],
                agentFilter: ["support"],
                oldest: WEEK,
            }),
        ).toBe(false)
    })
})

const BASE_FILTERS = {agentIds: [], status: "all", activity: "7d", type: "chat", groupBy: "agent"}

const settle = async () => {
    for (let index = 0; index < 20; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A first page of 50 chats, all with "support"; the ranking query (200 chats) also knows a chat
 * with "email" from yesterday, which is on a later page.
 */
const busyFirstPage = async (scope: string) => {
    const {sidebarSessionsNeedNextPageAtomFamily} = await import("../../src/dynamic/sessionsSource")
    const {sidebarAlwaysOpenGroupsAtomFamily} = await import("../../src/state")
    const {SESSIONS_SIDEBAR_KEY} = await import("../../src/constants")
    const now = Date.now()
    const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
    const support = Array.from({length: 50}, (_, index) => ({
        session_id: `support-${index}`,
        agent: "support",
        updated_at: at(index),
    }))
    querySessions.mockImplementation(async (args: {limit?: number}) =>
        args.limit === 200
            ? [...support, {session_id: "email-1", agent: "email", updated_at: at(24 * 60)}]
            : support,
    )
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(sidebarAlwaysOpenGroupsAtomFamily(scope), [SESSIONS_SIDEBAR_KEY])
    const atomForScope = sidebarSessionsNeedNextPageAtomFamily(scope)
    store.sub(atomForScope, () => undefined)
    await settle()
    return {store, atomForScope}
}

describe("sidebarSessionsNeedNextPageAtomFamily", () => {
    it("asks for the next page while an agent with a recent chat has no row", async () => {
        filters.value = {...BASE_FILTERS}
        const {store, atomForScope} = await busyFirstPage("mobile-main")
        expect(store.get(atomForScope)).toBe(true)
    })

    it("stops after the automatic page cap", async () => {
        filters.value = {...BASE_FILTERS}
        const {sidebarSessionPageCountAtomFamily, MAX_AUTO_SESSION_PAGES} =
            await import("../../src/dynamic/sessionsSource")
        const {store, atomForScope} = await busyFirstPage("mobile-main")
        store.set(sidebarSessionPageCountAtomFamily("mobile-main"), {
            pages: MAX_AUTO_SESSION_PAGES,
            boundary: new Date().toISOString(),
        })
        expect(store.get(atomForScope)).toBe(false)
    })

    it.each([
        ["grouped by date", {groupBy: "date"}],
        ["on the automation list", {type: "automation"}],
        ["with a status filter", {status: "running"}],
    ])("asks for nothing %s", async (_label, change) => {
        filters.value = {...BASE_FILTERS, ...change}
        const {store, atomForScope} = await busyFirstPage("mobile-main")
        expect(store.get(atomForScope)).toBe(false)
    })
})
