// @vitest-environment jsdom
//
// The chat column survives a browser whose desktop playground collapsed nothing.
//
// `agenta:chat:config-panel-collapsed` is one origin-wide boolean. On a desktop it means "the
// config pane sits beside the conversation"; on a phone there is no beside, so the same false put
// the pane where the chat is and hid the transcript and its composer outright.
//
// The unit case beside this one pins the atom that resolves it. This one pins the WIRING, because
// that is what a revert changes: pointing `SessionWorkspace` back at the shared atom left the
// mobile atom correct, every existing case green, and the column hidden again. So this renders the
// workspace itself, at phone width, with the desktop value in storage, and looks for the chat.
import {act} from "react"

import {phoneViewportAtom} from "@agenta/chat/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Seeded BEFORE the module graph loads: both collapse atoms use `getOnInit: true` and read
// storage exactly once. A `beforeEach` write lands after that and the case passes whichever key
// the workspace is pointed at, which is no case at all.
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

    it("hides it only when this app's own preference asks for the config pane", async () => {
        // The other direction, so the case cannot be satisfied by a workspace that never hides
        // anything: the phone's own reveal control still takes the screen.
        const {mobileConfigPanelCollapsedAtom} = await import("@/features/chat/configPaneState")
        const store = createStore()
        store.set(phoneViewportAtom, true)
        store.set(mobileConfigPanelCollapsedAtom, false)

        await render(store)

        expect(chatColumnVisible()).toBe(false)
    })
})
