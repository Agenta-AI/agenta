// @vitest-environment jsdom
//
// The chat column survives a browser whose desktop playground collapsed nothing.
//
// THIS PINS MAIN'S MECHANISM, not this delta's. `agenta:chat:config-panel-collapsed` used to be
// one origin-wide boolean: on a desktop it means "the config pane sits beside the conversation",
// and on a phone there is no beside, so the same false put the pane where the chat is and hid the
// transcript and its composer outright. Main answered it with a second key for phone width
// (`agenta:chat:config-panel-collapsed-phone`) picked by `configPanelCollapsedViewportPreferenceAtom`
// (#6378); this branch had answered the same thing with an app-scoped atom, which main's supersedes.
// The case is kept because the property is worth a case at the screen, and it renders the workspace
// itself at phone width with the desktop value in storage and looks for the chat.
//
// It does NOT cover #6930: a preference stored ON the phone still wins on the next load, so one tap
// of the reveal control opens the pane over the conversation for good. No case on either side does.
import {act} from "react"

import {phoneViewportAtom} from "@agenta/chat/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Seeded BEFORE the module graph loads: the collapse atoms use `getOnInit: true` and read storage
// exactly once. A `beforeEach` write lands after that and the case passes whichever key the
// workspace is pointed at, which is no case at all. Only the WIDE key is seeded; the phone key is
// left unset, which is the whole point.
vi.hoisted(() => {
    localStorage.setItem("agenta:chat:config-panel-collapsed", "false")
})

// Below `md`. The whole defect only exists at this width.
vi.mock("@agenta/ui/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useMediaQuery: () => false,
}))

vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn(), query: {}, asPath: "/"})}))
vi.mock("next/dynamic", () => ({default: () => () => null}))

// The workspace's neighbours, none of which decide what this case asks about. Each is stubbed at
// the module the workspace imports it from, so the component under test is the real one.
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/features/chat/SessionsPane", () => ({SessionsPane: () => null}))
vi.mock("@/features/chat/CollapsedConfigRail", () => ({CollapsedConfigRail: () => null}))
vi.mock("@/features/chat/SessionTabs", () => ({SessionTabs: () => null}))
vi.mock("@/features/chat/SessionTopBar", () => ({SessionTopBar: () => null}))
vi.mock("@/features/chat/useSessionTabClose", () => ({useSessionTabClose: () => () => undefined}))
vi.mock("@/features/chat/useStartBlankSession", () => ({
    useStartBlankSession: () => () => undefined,
}))
vi.mock("@/features/chat/useTriggerTestRun", () => ({useTriggerTestRun: () => undefined}))
vi.mock("@agenta/entity-ui/drive", () => ({
    DriveSessionProvider: ({children}: {children: React.ReactNode}) => children,
    SessionFilesPane: () => null,
    useSessionFilesPane: () => ({open: false, close: () => undefined, toggle: () => undefined}),
}))
vi.mock("@agenta/sessions-ui", () => ({
    useRequestSessionTabRename: () => () => undefined,
    useSessionActions: () => ({setArchived: () => undefined}),
}))
vi.mock("@agenta/sessions/link", () => ({sessionRoutePath: () => "/"}))
vi.mock("@agenta/sessions/state", async () => {
    const {atom} = await import("jotai")
    const tabs = atom([] as string[])
    return {renderedSessionTabsAtomFamily: () => tabs, sessionTabScope: () => "scope"}
})
vi.mock("@agenta/playground/state", () => ({registerAgentAutoCommitHandler: () => () => undefined}))
vi.mock("@agenta/ui/shortcuts", () => ({useSessionShortcuts: () => undefined}))

import {SessionWorkspace} from "@/features/chat/SessionWorkspace"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    // jsdom ships no `matchMedia`, and the shared pane-coexistence hook reads one. Phone width,
    // matching the `useMediaQuery` stub above.
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    }))
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

const CHAT_MARKER = "the conversation"

const render = async (store: ReturnType<typeof createStore>) => {
    await act(async () =>
        root.render(
            <Provider store={store}>
                <SessionWorkspace
                    entityId="rev-1"
                    agentId="agent-1"
                    sessionId="session-1"
                    workspaceId="ws-1"
                    projectId="proj-1"
                    // Main's create-an-agent surface lands collapsed through this; a session page
                    // does not, which is the state the defect lived in.
                    collapseConfigByDefault={false}
                    chat={<div data-testid="chat-column">{CHAT_MARKER}</div>}
                />
            </Provider>,
        ),
    )
}

/** Present AND on screen: the defect hid the column with a class, it did not unmount it. */
const chatColumnVisible = (): boolean => {
    let node: HTMLElement | null = host.querySelector<HTMLElement>('[data-testid="chat-column"]')
    if (!node) return false
    while (node && node !== host) {
        if (node.classList.contains("hidden")) return false
        node = node.parentElement
    }
    return true
}

describe("the session workspace on a phone", () => {
    it("shows the conversation though the desktop stored an expanded config pane", async () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)

        await render(store)

        expect(chatColumnVisible()).toBe(true)
    })

    it("hides it only when the phone's own preference asks for the config pane", async () => {
        // The other direction, so the case cannot be satisfied by a workspace that never hides
        // anything: the phone's own reveal control still takes the screen. Writing through
        // `configPanelCollapsedAtom` at phone width stores under the phone key.
        const {configPanelCollapsedAtom} = await import("@agenta/chat/state")
        const store = createStore()
        store.set(phoneViewportAtom, true)
        store.set(configPanelCollapsedAtom, false)

        await render(store)

        expect(chatColumnVisible()).toBe(false)
    })
})
