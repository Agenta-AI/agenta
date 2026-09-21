// @vitest-environment jsdom
//
// The tool catalog has a mount on the session screen.
//
// Every surface that offers the catalog — the config panel's "Browse integrations", and the
// agent's own connect widget in the transcript — opens it by setting `toolCatalogDrawerOpenAtom`.
// A setter with nothing listening is a control that does nothing and reports nothing, so the
// mount is the whole mechanism and it belongs to the workspace: the config pane does not render
// in chat mode, which is where the transcript's connect request arrives.
//
// The case drives the atom rather than clicking a control, because the atom is what both openers
// share and what the workspace answers.
import {act, createElement} from "react"

import {phoneViewportAtom} from "@agenta/chat/state"
import {toolCatalogDrawerOpenAtom} from "@agenta/entities/gatewayTool"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The real drawer is a portalled EnhancedDrawer over the catalog's own network hooks; neither is
// this file's subject. The stand-in keeps the ONE property that matters: it reads the same atom,
// so it appears exactly when an opener would have opened the real one.
vi.mock("@agenta/entity-ui/gatewayTool", async () => {
    const {useAtomValue} = await import("jotai")
    const {toolCatalogDrawerOpenAtom: openAtom} = await import("@agenta/entities/gatewayTool")
    return {
        CatalogDrawer: () => {
            const open = useAtomValue(openAtom)
            return open ? createElement("div", {"data-testid": "tool-catalog"}) : null
        },
    }
})

// `next/dynamic` is stubbed away in the sibling cases because what they assert is static. Here the
// mount IS a dynamic one, so the loader has to actually run or the case passes with no mount at
// all. This resolves it and renders what it yields, which is what the real `dynamic` does.
vi.mock("next/dynamic", async () => {
    const {useEffect, useState} = await import("react")
    return {
        default: (loader: () => Promise<unknown>) => {
            const Dynamic = (props: Record<string, unknown>) => {
                const [Loaded, setLoaded] = useState<((p: unknown) => unknown) | null>(null)
                useEffect(() => {
                    let live = true
                    void Promise.resolve(loader()).then((resolved) => {
                        const component = (resolved as {default?: unknown}).default ?? resolved
                        if (live) setLoaded(() => component as (p: unknown) => unknown)
                    })
                    return () => {
                        live = false
                    }
                }, [])
                return Loaded ? createElement(Loaded as never, props) : null
            }
            return Dynamic
        },
    }
})

// Below `md`, the width /m is drawn for.
vi.mock("@agenta/ui/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useMediaQuery: () => false,
}))

vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn(), query: {}, asPath: "/"})}))

// The workspace's neighbours, none of which decide what this case asks about. The config pane is
// stubbed at the module the dynamic loader reaches for, so resolving it does not pull the whole
// schema-form surface into the run.
vi.mock("@/features/chat/ConfigPane", () => ({ConfigPane: () => null}))
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
    // jsdom ships no `matchMedia`, and the shared pane-coexistence hook reads one.
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
                    chat={<div data-testid="chat-column">the conversation</div>}
                />
            </Provider>,
        ),
    )
}

/** Portalled in the real drawer, so the query is against the document, not the host node. */
const catalogOnScreen = () => !!document.querySelector('[data-testid="tool-catalog"]')

describe("the session workspace", () => {
    it("opens the tool catalog when an opener sets its atom", async () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)

        await render(store)

        // Closed first, so the case cannot be satisfied by a stand-in that always renders.
        expect(catalogOnScreen()).toBe(false)

        await act(async () => store.set(toolCatalogDrawerOpenAtom, true))

        expect(catalogOnScreen()).toBe(true)
    })
})
