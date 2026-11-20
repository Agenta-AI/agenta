// @vitest-environment jsdom
import {activeUserIdAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

const perms = vi.hoisted(() => ({edit: true}))
const sessions = vi.hoisted(() => ({failed: false, retry: vi.fn()}))
const actions = vi.hoisted(() => ({rename: vi.fn(), remove: vi.fn(), copy: vi.fn()}))
const agentNames = vi.hoisted(() => new Map<string, string>())
vi.mock("@agenta/navigation", async () => {
    const {atom} = await import("jotai")
    const {atomFamily} = await import("jotai-family")
    // One atom per id, like the real family: a new atom each render would render forever.
    return {
        agentDisplayNameAtomFamily: atomFamily((id: string) =>
            atom(() => agentNames.get(id) ?? null),
        ),
    }
})
vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn(), query: {}, asPath: "/"})}))
vi.mock("@agenta/entity-ui/agent", () => ({
    AgentIdentity: ({name}: {name: string}) => <span>{name}</span>,
    useAgentActions: () => actions,
}))
vi.mock("@agenta/playground-ui/agent-page-header", () => ({AgentRevisionStatus: () => null}))
vi.mock("@agenta/sessions-ui", () => ({SessionCardList: () => null}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/sessions/useSessionRowMenu", () => ({useSessionRowMenu: () => ({})}))
vi.mock("@/features/chat/SessionSharingControl", () => ({SessionSharingControl: () => null}))
vi.mock("@/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({data: {name: "Charged twice for March"}}),
}))
vi.mock("@/features/chat/SessionInspectorSheet", () => ({
    SessionInspectorSheet: ({open}: {open: boolean}) =>
        open ? <div data-testid="session-inspector" /> : null,
}))
vi.mock("@/features/agent-layout/useAgentSessionOrder", () => ({
    useAgentSessionOrder: () => ({failed: sessions.failed, retry: sessions.retry}),
    sessionMenuListArgs: () => ({}),
}))
vi.mock("@/features/chat/useStartBlankSession", () => ({useStartBlankSession: () => vi.fn()}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => perms.edit,
}))

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {SessionHeader} from "@/features/agent-layout/SessionHeader"

afterEach(() => {
    cleanup()
    perms.edit = true
    agentNames.clear()
})

const panel = (over: Partial<AgentPanelApi> = {}): AgentPanelApi => ({
    content: null,
    toggle: vi.fn(async () => true),
    close: vi.fn(async () => true),
    configTab: "agent",
    setConfigTab: vi.fn(),
    wide: false,
    setWide: vi.fn(),
    phone: false,
    available: {files: true, configuration: true, builder: false},
    ...over,
})

const renderHeader = (
    apiIn: AgentPanelApi,
    {hidden = false, builder = false, inspector = false} = {},
) => {
    let api = apiIn
    const store = createStore()
    store.set(activeUserIdAtom, "qa-user")
    store.set(playgroundInspectorEnabledAtom, inspector)
    if (builder) api = {...api, available: {...api.available, builder: true}}
    return render(
        <Provider store={store}>
            <AgentPanelContext.Provider value={api}>
                <SessionHeader
                    agentId="agent-1"
                    entityId="rev-1"
                    sessionId="s-1"
                    onUpdate={() => undefined}
                    autoUpdate={false}
                    agentHidden={hidden}
                    canSend
                    workspaceId="w"
                    projectId="p"
                />
            </AgentPanelContext.Provider>
        </Provider>,
    )
}

const openAgentMenu = () => {
    const trigger = screen.getByRole("button", {name: "Agent"})
    trigger.focus()
    fireEvent.keyDown(trigger, {key: "Enter"})
}

describe("the session header", () => {
    it("shows the session title and the panel icons, the open one pressed", () => {
        const api = panel({content: "configuration"})
        renderHeader(api, {builder: true})
        expect(screen.getByTestId("session-header")).toBeTruthy()
        expect(screen.getByText("Charged twice for March")).toBeTruthy()
        expect(
            screen.getByRole("button", {name: "Configuration"}).getAttribute("aria-pressed"),
        ).toBe("true")
        expect(screen.getByRole("button", {name: "Files"}).getAttribute("aria-pressed")).toBe(
            "false",
        )
        fireEvent.click(screen.getByRole("button", {name: "Builder"}))
        expect(api.toggle).toHaveBeenCalledWith("builder")
    })

    it("hides Builder until a builder content is registered", () => {
        renderHeader(panel())
        expect(screen.queryByRole("button", {name: "Builder"})).toBeNull()
    })

    it("shows the lock for a hidden agent, with no Configuration and no Builder", () => {
        renderHeader(panel(), {hidden: true, builder: true})
        expect(screen.queryByRole("button", {name: "Configuration"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Builder"})).toBeNull()
        expect(screen.getByRole("button", {name: "Files"})).toBeTruthy()
    })

    it("offers History, Rename, Export agent and Archive agent to an editor", async () => {
        renderHeader(panel())
        openAgentMenu()
        for (const item of ["History", "Rename", "Export agent", "Archive agent"]) {
            expect(await screen.findByRole("menuitem", {name: item})).toBeTruthy()
        }
    })

    it("offers only History and Export agent to a reader who cannot edit", async () => {
        perms.edit = false
        renderHeader(panel())
        openAgentMenu()
        expect(await screen.findByRole("menuitem", {name: "History"})).toBeTruthy()
        expect(screen.getByRole("menuitem", {name: "Export agent"})).toBeTruthy()
        expect(screen.queryByRole("menuitem", {name: "Rename"})).toBeNull()
        expect(screen.queryByRole("menuitem", {name: "Archive agent"})).toBeNull()
    })

    it("offers Inspect session in the session menu while the debug preference is on", async () => {
        renderHeader(panel(), {inspector: true})
        fireEvent.click(screen.getByTitle("Charged twice for March"))
        fireEvent.click(await screen.findByRole("button", {name: "Inspect session"}))
        expect(await screen.findByTestId("session-inspector")).toBeTruthy()
    })

    it("has no Inspect session while the debug preference is off", async () => {
        renderHeader(panel())
        fireEvent.click(screen.getByTitle("Charged twice for March"))
        expect(await screen.findByRole("button", {name: "New session"})).toBeTruthy()
        expect(screen.queryByRole("button", {name: "Inspect session"})).toBeNull()
    })

    it("says the session list could not load, with Retry, and still offers New session", async () => {
        sessions.failed = true
        renderHeader(panel())
        fireEvent.click(screen.getByTitle("Charged twice for March"))
        expect(await screen.findByText("Could not load sessions")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", {name: "Retry"}))
        expect(sessions.retry).toHaveBeenCalled()
        expect(screen.getByRole("button", {name: "New session"})).toBeTruthy()
        sessions.failed = false
    })

    it("names the agent by its id before its revision has loaded", () => {
        agentNames.set("agent-1", "Support triage")
        renderHeader(panel())
        expect(screen.getByText("Support triage")).toBeTruthy()
        expect(screen.queryByText("Agent")).toBeNull()
    })
})

describe("the session header on a phone", () => {
    const rows = () => screen.getByTestId("session-header").children

    it("has two rows: the agent with Configuration and Builder, then the session with Files", () => {
        renderHeader(panel({phone: true}), {builder: true})
        const header = screen.getByTestId("session-header")
        const [agentRow, sessionRow] = [...rows()].filter((row) => row.tagName === "DIV")
        expect(agentRow.textContent).toContain("Agent")
        expect(
            within(agentRow as HTMLElement).getByRole("button", {name: "Configuration"}),
        ).toBeTruthy()
        expect(within(agentRow as HTMLElement).getByRole("button", {name: "Builder"})).toBeTruthy()
        expect(sessionRow.textContent).toContain("Charged twice for March")
        expect(within(sessionRow as HTMLElement).getByRole("button", {name: "Files"})).toBeTruthy()
        // The icons have a 44 px hit area on a phone.
        expect(header.querySelector("#agent-panel-icon-files")?.className).toContain(
            "max-md:size-11",
        )
    })

    it("opens the agent menu as a bottom sheet with Cancel", async () => {
        renderHeader(panel({phone: true}))
        fireEvent.click(screen.getByRole("button", {name: /Agent/}))
        const sheet = await screen.findByTestId("bottom-sheet-menu")
        for (const item of ["History", "Rename", "Export agent", "Archive agent"]) {
            expect(within(sheet).getByRole("menuitem", {name: item})).toBeTruthy()
        }
        fireEvent.click(within(sheet).getByRole("button", {name: "Cancel"}))
        await waitFor(() => expect(screen.queryByTestId("bottom-sheet-menu")).toBeNull())
    })

    it("opens the latest sessions in a bottom sheet with New session, Sessions and Cancel", async () => {
        renderHeader(panel({phone: true}))
        fireEvent.click(screen.getByTitle("Charged twice for March"))
        const sheet = await screen.findByTestId("session-sheet")
        expect(within(sheet).getByRole("button", {name: "New session"})).toBeTruthy()
        expect(within(sheet).getByRole("link", {name: "Sessions"})).toBeTruthy()
        fireEvent.click(within(sheet).getByRole("button", {name: "Cancel"}))
        await waitFor(() => expect(screen.queryByTestId("session-sheet")).toBeNull())
    })

    it("shows no Configuration and no Builder for a private agent the reader cannot see", () => {
        renderHeader(panel({phone: true}), {hidden: true, builder: true})
        expect(screen.queryByRole("button", {name: "Configuration"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Builder"})).toBeNull()
        expect(screen.getByRole("button", {name: "Files"})).toBeTruthy()
    })
})
