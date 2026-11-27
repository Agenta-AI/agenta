// @vitest-environment jsdom
import {setSessionStatusAtom} from "@agenta/chat/state"
import {agentAutoCommitStatusAtomFamily} from "@agenta/playground/state"
import {activeUserIdAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

// Radix measures the open menu; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

const perms = vi.hoisted(() => ({edit: true}))
const sessions = vi.hoisted(() => ({failed: false, retry: vi.fn()}))
const actions = vi.hoisted(() => ({rename: vi.fn(), remove: vi.fn(), copy: vi.fn()}))
const renameAgent = vi.hoisted(() => vi.fn(async () => true))
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
    AgentKindBadge: () => <span data-testid="agent-kind-badge" />,
    useAgentActions: () => actions,
    useRenameAgent: () => renameAgent,
}))
vi.mock("@agenta/playground-ui/agent-page-header", () => ({
    AgentRevisionStatus: () => (
        <button type="button" aria-label="Retry saving">
            v4
        </button>
    ),
}))
// The rename pieces as small stand-ins: the header only wires them.
vi.mock("@agenta/sessions-ui", async () => {
    const {useState} = await import("react")
    return {
        SessionCardList: () => null,
        InlineRenameInput: ({rename, ariaLabel}: {rename: {draft: string}; ariaLabel?: string}) => (
            <input aria-label={ariaLabel} value={rename.draft} readOnly />
        ),
        useDeferredMenuSelect: (onSelect?: (key: string) => (() => void) | undefined) => ({
            handleSelect: (key: string) => onSelect?.(key)?.(),
            handleCloseAutoFocus: () => undefined,
        }),
        useInlineRename: ({current}: {current: string}) => {
            const [renaming, setRenaming] = useState(false)
            return {
                renaming,
                draft: current,
                setDraft: () => undefined,
                start: () => setRenaming(true),
                commit: async () => undefined,
                cancel: () => setRenaming(false),
            }
        },
    }
})
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
    actions.rename.mockClear()
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
    {hidden = false, builder = false, inspector = false, saveFailed = false, running = false} = {},
) => {
    let api = apiIn
    const store = createStore()
    if (saveFailed) store.set(agentAutoCommitStatusAtomFamily("rev-1"), "error")
    if (running) store.set(setSessionStatusAtom, {id: "s-1", status: "running"})
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

    it("opens the agent menu from one button: the name and its arrow, after the agent badge", async () => {
        agentNames.set("agent-1", "Support triage")
        renderHeader(panel())
        expect(screen.getByTestId("agent-kind-badge")).toBeTruthy()
        fireEvent.keyDown(screen.getByRole("button", {name: "Support triage"}), {key: "Enter"})
        expect(await screen.findByRole("menuitem", {name: "History"})).toBeTruthy()
    })

    it("marks the session button only while a run is live", () => {
        renderHeader(panel())
        expect(
            within(screen.getByTitle("Charged twice for March")).queryByTestId(
                "session-status-running",
            ),
        ).toBeNull()
        cleanup()
        renderHeader(panel(), {running: true})
        const button = screen.getByTitle("Charged twice for March")
        expect(within(button).getByTestId("session-status-running")).toBeTruthy()
    })

    it("Rename in the agent menu edits the name in place", async () => {
        agentNames.set("agent-1", "Support triage")
        renderHeader(panel())
        fireEvent.keyDown(screen.getByRole("button", {name: "Support triage"}), {key: "Enter"})
        fireEvent.click(await screen.findByRole("menuitem", {name: "Rename"}))
        const field = await screen.findByRole("textbox", {name: "Agent name"})
        expect((field as HTMLInputElement).value).toBe("Support triage")
        expect(actions.rename).not.toHaveBeenCalled()
    })

    it("names the agent by its id before its revision has loaded", () => {
        agentNames.set("agent-1", "Support triage")
        renderHeader(panel())
        expect(screen.getByText("Support triage")).toBeTruthy()
        expect(screen.queryByText("Agent")).toBeNull()
    })
})

describe("the session header on a phone", () => {
    const openMore = async () => {
        fireEvent.click(screen.getByRole("button", {name: "More actions"}))
        return screen.findByTestId("bottom-sheet-menu")
    }

    it("is one bar: the session as the title, then More; Files, Configuration and Builder are in More", async () => {
        renderHeader(panel({phone: true}), {builder: true})
        const header = screen.getByTestId("session-header")
        expect(header.className).toContain("h-11")
        expect(header.textContent).toContain("Charged twice for March")
        expect(screen.queryByRole("button", {name: "Configuration"})).toBeNull()
        const sheet = await openMore()
        for (const item of ["Files", "Configuration", "Builder"]) {
            expect(within(sheet).getByRole("menuitem", {name: item})).toBeTruthy()
        }
    })

    it("opens the agent menu entries from More as a bottom sheet with no visible Cancel", async () => {
        renderHeader(panel({phone: true}))
        const sheet = await openMore()
        for (const item of ["History", "Rename", "Export agent", "Archive agent"]) {
            expect(within(sheet).getByRole("menuitem", {name: item})).toBeTruthy()
        }
        expect(within(sheet).queryByRole("button", {name: "Cancel"})).toBeNull()
        fireEvent.click(within(sheet).getByRole("button", {name: "Close"}))
        await waitFor(() => expect(screen.queryByTestId("bottom-sheet-menu")).toBeNull())
    })

    it("Rename on a phone opens the rename dialog, not the in-place field", async () => {
        renderHeader(panel({phone: true}))
        const sheet = await openMore()
        fireEvent.click(within(sheet).getByRole("menuitem", {name: "Rename"}))
        expect(actions.rename).toHaveBeenCalledWith(expect.objectContaining({id: "agent-1"}))
    })

    it("opens the latest sessions in a bottom sheet with New session and Sessions, no Cancel", async () => {
        renderHeader(panel({phone: true}))
        fireEvent.click(screen.getByTitle("Charged twice for March"))
        const sheet = await screen.findByTestId("session-sheet")
        expect(within(sheet).getByRole("button", {name: "New session"})).toBeTruthy()
        expect(within(sheet).getByRole("link", {name: "Sessions"})).toBeTruthy()
        expect(within(sheet).queryByRole("button", {name: "Cancel"})).toBeNull()
        fireEvent.click(within(sheet).getByRole("button", {name: "Close"}))
        await waitFor(() => expect(screen.queryByTestId("session-sheet")).toBeNull())
    })

    // jsdom applies no Tailwind styles, so the shown or hidden state is read from the class.
    it("keeps the version status mounted but hidden in the bar, and shows it while a save failed", () => {
        renderHeader(panel({phone: true}))
        const hidden = screen.getByTestId("session-header-save-status")
        // Mounted while hidden: it drives session follow.
        expect(within(hidden).getByRole("button", {name: "Retry saving"})).toBeTruthy()
        expect(hidden.className).toContain("hidden")
        cleanup()
        renderHeader(panel({phone: true}), {saveFailed: true})
        const shown = screen.getByTestId("session-header-save-status")
        expect(within(shown).getByRole("button", {name: "Retry saving"})).toBeTruthy()
        expect(shown.className).not.toContain("hidden")
        expect(shown.className).toContain("flex")
    })

    it("shows no Configuration and no Builder for a private agent the reader cannot see", async () => {
        renderHeader(panel({phone: true}), {hidden: true, builder: true})
        const sheet = await openMore()
        expect(within(sheet).queryByRole("menuitem", {name: "Configuration"})).toBeNull()
        expect(within(sheet).queryByRole("menuitem", {name: "Builder"})).toBeNull()
        expect(within(sheet).getByRole("menuitem", {name: "Files"})).toBeTruthy()
    })
})
