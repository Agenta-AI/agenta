// @vitest-environment jsdom
//
// The session screen on the agent layout: one header, the conversation mounted once, and one
// right panel with one content. The old left pane, the session tab row and the old top bar are
// gone; a hidden agent never mounts its configuration.
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const media = vi.hoisted(() => ({width: 1440}))
vi.mock("@agenta/ui/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useMediaQuery: (query: string) => media.width >= Number(/(\d+)px/.exec(query)?.[1] ?? 0),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        push: vi.fn(),
        query: {},
        asPath: "/",
        events: {on: () => undefined, off: () => undefined, emit: () => undefined},
    }),
}))
// The Configuration content marks itself with the revision it edits.
vi.mock("next/dynamic", () => ({
    default:
        () =>
        ({revisionId}: {revisionId?: string}) =>
            revisionId ? <div data-testid="configuration" data-revision={revisionId} /> : null,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/features/agent-layout/SessionHeader", () => ({
    SessionHeader: () => <header data-testid="session-header" />,
}))
vi.mock("@/features/chat/useSessionTabClose", () => ({useSessionTabClose: () => () => undefined}))
vi.mock("@/features/chat/useStartBlankSession", () => ({
    useStartBlankSession: () => () => undefined,
}))
vi.mock("@/features/chat/useTriggerTestRun", () => ({useTriggerTestRun: () => undefined}))
vi.mock("@/features/chat/useDriveUrlSync", () => ({
    useDriveUrlSync: () => ({copyLink: () => undefined, onSelectionChange: () => undefined}),
}))
vi.mock("@/features/chat/SessionWorkspaceDrawers", () => ({SessionWorkspaceDrawers: () => null}))
vi.mock("@agenta/entity-ui/drive", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entity-ui/drive")>()),
    DriveSessionProvider: ({children}: {children: React.ReactNode}) => children,
    SessionFilesPane: () => <div data-testid="files" />,
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

import {panelStateKey} from "@/features/agent-layout/agentPanelState"
import {SessionWorkspace} from "@/features/chat/SessionWorkspace"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    localStorage.clear()
    media.width = 1440
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const openConfiguration = () =>
    localStorage.setItem(
        panelStateKey("anonymous", "proj-1"),
        JSON.stringify({content: "configuration", width: 520, configTab: "agent"}),
    )

const render = async (store: ReturnType<typeof createStore>, agentHidden = false) => {
    await act(async () =>
        root.render(
            <Provider store={store}>
                <SessionWorkspace
                    entityId="rev-1"
                    agentId="agent-1"
                    agentHidden={agentHidden}
                    sessionId="session-1"
                    workspaceId="ws-1"
                    projectId="proj-1"
                    chat={<div data-testid="chat-column" />}
                />
            </Provider>,
        ),
    )
}
const q = (id: string) => host.querySelectorAll(`[data-testid="${id}"]`)

describe("the session screen on the agent layout", () => {
    it("shows the header and the conversation, with the panel closed by default", async () => {
        await render(createStore())
        expect(q("session-header")).toHaveLength(1)
        expect(q("chat-column")).toHaveLength(1)
        expect(q("configuration")).toHaveLength(0)
        expect(q("agent-panel")[0]?.parentElement?.className).toContain("hidden")
    })

    it("opens the stored content at the stored width", async () => {
        openConfiguration()
        await render(createStore())
        expect(q("agent-panel")).toHaveLength(1)
        expect(q("configuration")[0]?.getAttribute("data-revision")).toBe("rev-1")
        const panel = q("agent-panel")[0]?.parentElement as HTMLElement
        expect(panel.style.width).toBe("520px")
    })

    it("never mounts the configuration of a hidden agent", async () => {
        openConfiguration()
        await render(createStore(), true)
        expect(q("configuration")).toHaveLength(0)
    })

    it("drops a configuration mounted while the agent was visible when access goes", async () => {
        openConfiguration()
        const store = createStore()
        await render(store)
        expect(q("configuration")).toHaveLength(1)
        await render(store, true)
        expect(q("configuration")).toHaveLength(0)
    })

    it("lies over the conversation under 1100 px and covers it on a phone", async () => {
        openConfiguration()
        media.width = 1000
        await render(createStore())
        const panel = q("agent-panel")[0]?.parentElement as HTMLElement
        expect(panel.className).toContain("absolute")
        expect(q("chat-column")).toHaveLength(1)

        media.width = 390
        await render(createStore())
        const chatWrapper = q("chat-column")[0]?.parentElement?.parentElement as HTMLElement
        expect(chatWrapper.className).toContain("hidden")
        // Still mounted once, so a running answer goes on.
        expect(q("chat-column")).toHaveLength(1)
    })
})
