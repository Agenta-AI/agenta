/**
 * Under agent grouping each heading names its agent. The name comes from the workflow artifact
 * query, which starts only after the session rows load, so a cold rail showed "Agent" as the
 * heading until it answered. The agent catalog the rail already reads carries the same name.
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

/** What the artifact query has answered so far, by workflow id. */
const artifactNames = vi.hoisted(() => new Map<string, string>())
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        agentWorkflowsListQueryStateAtom: atom({data: [], isPending: false}),
        appWorkflowsListQueryAtom: atom({
            data: {
                refs: [
                    {id: "support", name: "Support triage", slug: "support-triage-agent"},
                    {id: "email", name: "Email writer", slug: "email-writer"},
                ],
            },
        }),
        workflowMolecule: {
            selectors: {artifactName: (id: string) => atom(artifactNames.get(id) ?? null)},
        },
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

vi.mock("../../src/dynamic/sessionFilters", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    const {atom} = await import("jotai")
    const {atomFamily} = await import("jotai-family")
    return {
        ...actual,
        sidebarSessionFiltersAtomFamily: atomFamily((_scopeId: string) =>
            atom(() => ({
                agentIds: [],
                status: "all",
                activity: "7d",
                type: "chat",
                groupBy: "agent",
            })),
        ),
    }
})

const settle = async () => {
    for (let index = 0; index < 20; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const headings = async () => {
    const {MAIN_SIDEBAR_SCOPE_ID: scope} = await import("../../src/constants")
    const {sidebarSessionGroupsAtomFamily} = await import("../../src/dynamic/sessionsSource")
    const {sidebarAlwaysOpenGroupsAtomFamily} = await import("../../src/state")
    const {SESSIONS_SIDEBAR_KEY} = await import("../../src/constants")
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    querySessions.mockImplementation(async () => [
        {session_id: "s1", agent: "support", updated_at: at(1)},
        {session_id: "s2", agent: "email", updated_at: at(2)},
    ])
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(sidebarAlwaysOpenGroupsAtomFamily(scope), [SESSIONS_SIDEBAR_KEY])
    const groups = sidebarSessionGroupsAtomFamily(scope)
    store.sub(groups, () => undefined)
    await settle()
    return store.get(groups).groups.map((group) => group.label)
}

describe("agent headings in the main sidebar", () => {
    it("name the agent from the catalog while its artifact has not answered", async () => {
        artifactNames.clear()
        const labels = await headings()
        expect(labels).toEqual(expect.arrayContaining(["Support triage", "Email writer"]))
        expect(labels).not.toContain("Agent")
    })

    it("prefer the artifact name once it answers", async () => {
        artifactNames.clear()
        artifactNames.set("support", "Support desk")
        const labels = await headings()
        expect(labels).toEqual(expect.arrayContaining(["Support desk", "Email writer"]))
    })

    it("give the session header the same name by agent id", async () => {
        artifactNames.clear()
        const {agentDisplayNameAtomFamily} = await import("../../src/dynamic/sessionsSource")
        const store = createStore()
        expect(store.get(agentDisplayNameAtomFamily("support"))).toBe("Support triage")
        expect(store.get(agentDisplayNameAtomFamily("unknown"))).toBeNull()
        expect(store.get(agentDisplayNameAtomFamily(""))).toBeNull()
    })
})
