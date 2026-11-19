// @vitest-environment jsdom
/**
 * The sidebar sync as the app shell runs it: each screen mounts its own shell, so a page change
 * remounts the hook. A reload keeps the agent sidebar; a page change applies the rules.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const route = vi.hoisted(() => ({
    pathname: "",
    asPath: "",
    query: {} as Record<string, string>,
}))
const header = vi.hoisted(() => ({data: null as unknown}))
const AGENT_2 = "00000000-0000-4000-8000-000000000002"
const agents = vi.hoisted(() => ({list: [] as {id: string}[]}))

vi.mock("next/router", () => ({useRouter: () => route}))
vi.mock("../../src/features/chat/useSessionHeader", () => ({useSessionHeader: () => header}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        agentWorkflowsListQueryStateAtom: atom(() => ({
            data: agents.list,
            isPending: false,
            isError: false,
        })),
    }
})

type Sync = typeof import("../../src/features/agent-sidebar/useAgentSidebarSync")
type Store = typeof import("../../src/features/agent-sidebar/selectedSidebar")
let sync: Sync
let store: Store
// Fresh modules per test (the sync keeps the last path of the tab), so the store is fresh too.
let jotai: typeof import("jotai")
let Shell: () => null
let host: HTMLDivElement
let root: Root

const SESSION = "/w/[workspace_id]/p/[project_id]/sessions/[session_id]"
const HOME = "/w/[workspace_id]/p/[project_id]/apps"
const SETTINGS = "/w/[workspace_id]/p/[project_id]/settings"

const go = (pathname: string, asPath: string, query: Record<string, string> = {}) => {
    route.pathname = pathname
    route.asPath = asPath
    route.query = query
}
/** A new screen: its own app shell, so the hook mounts again. */
const mountScreen = () => {
    act(() => root?.unmount())
    root = createRoot(host)
    Shell = () => {
        sync.useAgentSidebarSync("p1")
        return null
    }
    act(() => root.render(createElement(Shell)))
}
const selected = () => jotai.getDefaultStore().get(store.selectedSidebarAtom)

beforeEach(async () => {
    vi.resetModules()
    window.sessionStorage.clear()
    header.data = null
    agents.list = [{id: "a1"}, {id: AGENT_2}]
    sync = await import("../../src/features/agent-sidebar/useAgentSidebarSync")
    store = await import("../../src/features/agent-sidebar/selectedSidebar")
    jotai = await import("jotai")
    host = document.createElement("div")
    document.body.append(host)
})
afterEach(() => {
    act(() => root?.unmount())
    host.remove()
})

// The first test loads the modules fresh, which is slow on a busy machine.
describe("the sidebar sync", {timeout: 30_000}, () => {
    it("keeps the agent sidebar on a reload, on any page", () => {
        go(HOME, "/w/w1/p/p1/apps")
        store.openAgentSidebar("a1")
        mountScreen()
        expect(selected()).toEqual({kind: "agent", agentId: "a1", from: "main"})
    })

    it("shows the main sidebar after a page change to Settings, though the shell remounts", () => {
        go(SESSION, "/w/w1/p/p1/sessions/s1", {session_id: "s1"})
        mountScreen()
        store.openAgentSidebar("a1")
        go(SETTINGS, "/w/w1/p/p1/settings")
        mountScreen()
        expect(selected()).toEqual({kind: "main"})
    })

    it("switches to the agent of a session whose row arrives after the page change", () => {
        go(HOME, "/w/w1/p/p1/apps")
        mountScreen()
        store.openAgentSidebar("a1")
        go(SESSION, "/w/w1/p/p1/sessions/s2", {session_id: "s2"})
        mountScreen()
        expect(selected()).toMatchObject({agentId: "a1"})
        header.data = {session_id: "s2", references: [{key: "workflow", id: AGENT_2}]}
        // The same shell renders again when the row arrives.
        act(() => root.render(createElement(Shell)))
        expect(selected()).toMatchObject({kind: "agent", agentId: AGENT_2})
    })

    it("keeps a choice made before the session's row arrives", () => {
        go(HOME, "/w/w1/p/p1/apps")
        mountScreen()
        store.openAgentSidebar("a1")
        go(SESSION, "/w/w1/p/p1/sessions/s3", {session_id: "s3"})
        mountScreen()
        act(() => store.openAgentSidebar("a1", "agents"))
        header.data = {session_id: "s3", references: [{key: "workflow", id: AGENT_2}]}
        act(() => root.render(createElement(Shell)))
        expect(selected()).toEqual({kind: "agent", agentId: "a1", from: "agents"})
    })

    it("keeps the open button's choice while the page stays", () => {
        go(SESSION, "/w/w1/p/p1/sessions/s1", {session_id: "s1", agent: "a1"})
        mountScreen()
        act(() => store.openAgentSidebar(AGENT_2))
        expect(selected()).toMatchObject({agentId: AGENT_2})
    })
})
