/**
 * Each agent section of the main sidebar shows 4 rows. When the first page holds the sessions of
 * a few busy agents, the rail is too short to scroll, and the agents whose sessions are on later
 * pages never load. `hasUnloadedAgent` says when the rail must ask for the next page itself.
 */
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
    sessionOpenTarget: () => null,
}))

vi.mock("@agenta/sessions/state", async () => {
    const {atom} = await import("jotai")
    return {pinnedSessionIdsAtom: atom([] as string[])}
})

vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {idleReadyAtom: atom(true), projectIdAtom: atom("project-1" as string | null)}
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

describe("hasUnloadedAgent", () => {
    it("asks for more while an agent with chats has no loaded row", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                agentsWithChats: ["support", "email"],
                loadedRefs: [ref("s1", "support"), ref("s2", "support")],
                agentFilter: [],
            }),
        ).toBe(true)
    })

    it("stops once every agent with chats has a row", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                agentsWithChats: ["support", "email"],
                loadedRefs: [ref("s1", "support"), ref("s2", "email")],
                agentFilter: [],
            }),
        ).toBe(false)
    })

    it("ignores agents outside the agent filter", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(
            hasUnloadedAgent({
                agentsWithChats: ["support", "email"],
                loadedRefs: [ref("s1", "support")],
                agentFilter: ["support"],
            }),
        ).toBe(false)
    })

    it("asks for nothing when no agent has chats", async () => {
        const {hasUnloadedAgent} = await import("../../src/dynamic/sessionsSource")
        expect(hasUnloadedAgent({agentsWithChats: [], loadedRefs: [], agentFilter: []})).toBe(false)
    })
})
