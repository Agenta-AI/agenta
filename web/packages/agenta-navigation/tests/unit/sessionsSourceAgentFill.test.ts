/**
 * Each agent section of the main sidebar shows 4 rows. When the first page holds the sessions of
 * a few busy agents, the rail is too short to scroll, and the agents whose sessions are on later
 * pages never load. `hasUnloadedAgent` says when the rail must ask for the next page itself.
 */
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/session", () => ({
    querySessions: vi.fn(),
    querySessionsFlatPage: vi.fn(),
    queryInteractions: vi.fn(),
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

describe("sidebarSessionsNeedNextPageAtomFamily", () => {
    it.each([
        ["grouped by date", {groupBy: "date"}],
        ["on the automation list", {type: "automation"}],
        ["with a status filter", {status: "running"}],
    ])("asks for nothing %s", async (_label, change) => {
        const {sidebarSessionsNeedNextPageAtomFamily} =
            await import("../../src/dynamic/sessionsSource")
        filters.value = {
            agentIds: [],
            status: "all",
            activity: "7d",
            type: "chat",
            groupBy: "agent",
            ...change,
        }
        expect(createStore().get(sidebarSessionsNeedNextPageAtomFamily("auto-fill-test"))).toBe(
            false,
        )
    })
})
