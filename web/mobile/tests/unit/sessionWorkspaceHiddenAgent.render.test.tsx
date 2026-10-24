// @vitest-environment jsdom
//
// A session whose agent the reader cannot see (a private agent) shows no configuration: the
// config pane never mounts for it, and one mounted while the agent was visible goes when access
// to the agent does. The workspace is the real one; its neighbours are stubs.
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Seeded before the module graph loads (the collapse atoms read storage once): the config pane
// is open at desktop width.
vi.hoisted(() => {
    localStorage.setItem("agenta:chat:config-panel-collapsed", "false")
})

// Desktop width: the config pane sits beside the conversation.
vi.mock("@agenta/ui/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useMediaQuery: () => true,
}))

vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn(), query: {}, asPath: "/"})}))
// Only the config pane is handed an `entityId`: the marker says it is mounted, and for which revision.
vi.mock("next/dynamic", () => ({
    default:
        () =>
        ({entityId}: {entityId?: string}) =>
            entityId ? <div data-testid="config-pane" data-entity={entityId} /> : null,
}))

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
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: !query.includes("max-width"),
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

const render = async (store: ReturnType<typeof createStore>, agentHidden: boolean) => {
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

const configPane = () => host.querySelector<HTMLElement>('[data-testid="config-pane"]')

describe("the config pane of a session whose agent is hidden", () => {
    it("mounts for a visible agent", async () => {
        await render(createStore(), false)
        expect(configPane()?.dataset.entity).toBe("rev-1")
    })

    it("never mounts for a hidden agent, even with a revision in hand", async () => {
        await render(createStore(), true)
        expect(configPane()).toBeNull()
    })

    it("drops a pane mounted while the agent was visible when access to it goes", async () => {
        const store = createStore()
        await render(store, false)
        expect(configPane()).not.toBeNull()

        await render(store, true)

        expect(configPane()).toBeNull()
    })
})
