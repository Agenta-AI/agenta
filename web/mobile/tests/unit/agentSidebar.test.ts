// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"

import {agentSidebarItems} from "../../src/features/agent-sidebar/agentSidebarItems"
import {sidebarAfterRoute} from "../../src/features/agent-sidebar/agentSidebarRoute"
import {groupByDay} from "../../src/features/agent-sidebar/dayGroups"
import {
    MAIN_SIDEBAR,
    SELECTED_SIDEBAR_KEY,
    openAgentSidebar,
    parseSelectedSidebar,
    openMainSidebar,
} from "../../src/features/agent-sidebar/selectedSidebar"
import {switchTarget} from "../../src/features/agent-sidebar/switchAgent"

const SESSION = "/w/[workspace_id]/p/[project_id]/sessions/[session_id]"
const AGENT = "/w/[workspace_id]/p/[project_id]/agents/[agent_id]"
const shown = {kind: "agent", agentId: "a1", from: "main"} as const

afterEach(() => window.sessionStorage.clear())

describe("which sidebar a browser tab shows", () => {
    it("shows the main sidebar for a shared link: a new tab has nothing stored", () => {
        expect(parseSelectedSidebar(window.sessionStorage.getItem(SELECTED_SIDEBAR_KEY))).toEqual(
            MAIN_SIDEBAR,
        )
    })

    it("keeps the agent sidebar across a reload of the tab", () => {
        openAgentSidebar("a1", "agents")
        expect(parseSelectedSidebar(window.sessionStorage.getItem(SELECTED_SIDEBAR_KEY))).toEqual({
            kind: "agent",
            agentId: "a1",
            from: "agents",
        })
        openMainSidebar()
        expect(window.sessionStorage.getItem(SELECTED_SIDEBAR_KEY)).toBeNull()
    })

    it("reads a broken stored value as the main sidebar", () => {
        expect(parseSelectedSidebar("{not json")).toEqual(MAIN_SIDEBAR)
        expect(parseSelectedSidebar('{"kind":"agent"}')).toEqual(MAIN_SIDEBAR)
    })
})

describe("the sidebar after a page change", () => {
    it("keeps the main sidebar when a session opens from it", () => {
        expect(sidebarAfterRoute(MAIN_SIDEBAR, SESSION, "a2")).toBeNull()
    })

    it("shows the main sidebar on a page that is not an agent page", () => {
        expect(sidebarAfterRoute(shown, "/w/[workspace_id]/p/[project_id]/settings", null)).toEqual(
            MAIN_SIDEBAR,
        )
        expect(sidebarAfterRoute(shown, "/w/[workspace_id]/p/[project_id]/agents", null)).toEqual(
            MAIN_SIDEBAR,
        )
    })

    it("switches to the agent of a page of another agent", () => {
        expect(sidebarAfterRoute(shown, SESSION, "a2")).toEqual({
            kind: "agent",
            agentId: "a2",
            from: "main",
        })
    })

    it("keeps the agent sidebar on its own agent's pages, and while the agent is not known", () => {
        expect(sidebarAfterRoute(shown, AGENT, "a1")).toBeNull()
        expect(sidebarAfterRoute(shown, SESSION, null)).toBeNull()
    })
})

describe("sessions grouped by day", () => {
    const now = new Date(2026, 10, 19, 15, 0)
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString()

    it("splits rows into Today, Yesterday and Earlier and leaves out empty groups", () => {
        const rows = [at(19, 9), at(19, 0), at(18, 23), at(10, 12), null]
        const groups = groupByDay(rows, (row) => row, now)
        expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
            ["today", 2],
            ["yesterday", 1],
            ["earlier", 2],
        ])
        expect(groupByDay([at(17, 8)], (row) => row, now).map((g) => g.key)).toEqual(["earlier"])
    })
})

describe("the agent switcher's target", () => {
    const base = {projectURL: "/w/w1/p/p1", pickedAgentId: "a2"}

    it("keeps the same agent page and tab", async () => {
        const target = await switchTarget({
            ...base,
            pathname: AGENT,
            query: {agent_id: "a1", view: "configuration", tab: "access"},
            latestSessionId: async () => "never",
        })
        expect(target).toBe("/w/w1/p/p1/agents/a2?view=configuration&tab=access")
        expect(
            await switchTarget({
                ...base,
                pathname: AGENT,
                query: {agent_id: "a1", view: "analytics"},
                latestSessionId: async () => "never",
            }),
        ).toBe("/w/w1/p/p1/agents/a2?view=analytics")
    })

    it("goes from a session to the picked agent's latest session, or to a new one", async () => {
        expect(
            await switchTarget({
                ...base,
                pathname: SESSION,
                query: {session_id: "s1"},
                latestSessionId: async () => "s9",
            }),
        ).toBe("/w/w1/p/p1/sessions/s9")
        expect(
            await switchTarget({
                ...base,
                pathname: SESSION,
                query: {session_id: "s1"},
                latestSessionId: async () => null,
            }),
        ).toBeNull()
    })
})

describe("the agent sidebar's session rows", () => {
    const t = ((key: string, values?: {count: number}) =>
        values ? `${key}:${values.count}` : key) as never
    const base = {
        projectURL: "/w/w1/p/p1",
        agentId: "a1",
        sessions: [],
        total: null,
        t,
        newSessionHref: "/w/w1/p/p1/agents/a1",
        onNewSession: () => undefined,
    }
    const sessionsGroup = (items: ReturnType<typeof agentSidebarItems>) =>
        items.find((item) => item.key === "agent-sidebar-sessions")!

    it("shows the error and a Retry row after a failed first load, and Retry reads again", () => {
        const onRetry = vi.fn()
        const group = sessionsGroup(agentSidebarItems({...base, status: "error", onRetry}))
        expect(group.submenu!.map((row) => row.title)).toEqual([
            "agentSidebar.loadError",
            "agentSidebar.retry",
        ])
        group.submenu![1].onClick!({} as never)
        expect(onRetry).toHaveBeenCalledOnce()
    })

    it("shows Sessions without a number until the count loads, then the older sessions row", () => {
        expect(sessionsGroup(agentSidebarItems(base)).groupAction).toBeUndefined()
        const session = {
            sessionId: "s1",
            appId: "a1",
            name: "One",
            archived: false,
            title: "One",
            activityAt: new Date().toISOString(),
            status: "idle" as const,
            isAutomation: false,
        }
        const group = sessionsGroup(agentSidebarItems({...base, sessions: [session], total: 42}))
        expect(group.groupAction).toBeDefined()
        expect(group.submenu!.at(-1)!.title).toBe("agentSidebar.showOlderSessions:41")
    })
})
