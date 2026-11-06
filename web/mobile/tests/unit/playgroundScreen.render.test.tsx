// @vitest-environment jsdom
/**
 * The prompt playground screen: its states, the desktop split and the phone switch, the route
 * out for an agent app, and the in-app leave guard. The selection hook has its own test; here it
 * is a fixture. The config panel and the run pane are stubs.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"
import type {PlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

const {fixture, router, routeHandlers} = vi.hoisted(() => {
    type RouteHandler = (url: string, options: {shallow: boolean}) => void
    const routeHandlers = new Map<string, Set<RouteHandler>>()
    return {
        routeHandlers,
        fixture: {
            selection: {} as PlaygroundSelection,
            wide: true,
            dirty: false,
        },
        router: {
            query: {workspace_id: "ws-1", project_id: "proj-1", app_id: "app-1"},
            basePath: "/m",
            asPath: "/w/ws-1/p/proj-1/apps/app-1/playground",
            replace: vi.fn(async () => true),
            push: vi.fn(async () => true),
            back: vi.fn(),
            events: {
                on: (name: string, handler: RouteHandler) => {
                    if (!routeHandlers.has(name)) routeHandlers.set(name, new Set())
                    routeHandlers.get(name)!.add(handler)
                },
                off: (name: string, handler: RouteHandler) =>
                    routeHandlers.get(name)?.delete(handler),
                emit: (name: string, url = "", options = {shallow: false}) =>
                    routeHandlers.get(name)?.forEach((handler) => handler(url, options)),
            },
        },
    }
})

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@/features/playground/usePlaygroundSelection", () => ({
    usePlaygroundSelection: () => fixture.selection,
}))
vi.mock("@agenta/ui/hooks", async (original) => ({
    ...(await original<object>()),
    useMediaQuery: () => fixture.wide,
}))
vi.mock("@agenta/playground-ui/hooks", async (original) => ({
    ...(await original<object>()),
    useLocalDraftWarning: () => fixture.dirty,
}))
vi.mock("@agenta/playground-ui/panels/config", () => ({
    ConfigPanel: ({revisionId}: {revisionId: string}) => (
        <div data-testid="config-panel">{revisionId}</div>
    ),
    ConfigPanelSkeleton: () => <div data-testid="config-panel-skeleton" />,
    RevisionSwitcher: () => null,
    CompareButton: () => null,
    PromptTokenPathProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/features/playground/RevisionActions", () => ({RevisionActions: () => null}))
vi.mock("@/features/playground/PlaygroundRunPane", () => ({
    PlaygroundRunPane: ({revisionId}: {revisionId: string}) => (
        <div data-testid="run-pane">{revisionId}</div>
    ),
}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({CatalogDrawer: () => null}))
vi.mock("@agenta/ui/editor", () => ({preloadEditorPlugins: vi.fn()}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
// next/head writes no document title outside a Next app, so the title is read off its props.
vi.mock("@/components/PageTitle", () => ({
    PageTitle: ({title, context}: {title: string; context?: string}) => (
        <div data-testid="page-title">{`${title} | ${context}`}</div>
    ),
}))
vi.mock("@/components/PageNotFound", () => ({
    PageNotFound: () => <div data-testid="not-found" />,
}))

let root: Root
let host: HTMLDivElement

const select = (patch: Partial<PlaygroundSelection>) => {
    fixture.selection = {
        status: "ready",
        appKind: "prompt",
        primaryRevisionId: "rev-1",
        revisionIds: ["rev-1"],
        appName: "Greeter",
        retry: vi.fn(),
        ...patch,
    }
}

const render = async () => {
    await act(async () =>
        root.render(<PlaygroundScreen workspaceId="ws-1" projectId="proj-1" appId="app-1" />),
    )
}

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`)
/** Shown unless an ancestor pane carries the `hidden` class. */
const isShown = (id: string) => byTestId(id)?.closest(".hidden") === null

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    fixture.wide = true
    fixture.dirty = false
    routeHandlers.clear()
    router.replace.mockClear()
    router.push.mockClear()
    select({})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("PlaygroundScreen", () => {
    it("A prompt app shows its config pane and its run pane", async () => {
        await render()

        expect(host.querySelector("h1")?.textContent).toBe("Greeter")
        expect(host.textContent).toContain("Playground")
        expect(byTestId("config-panel")?.textContent).toBe("rev-1")
        expect(byTestId("run-pane")?.textContent).toBe("rev-1")
        expect(byTestId("page-title")?.textContent).toBe("Playground | Greeter")
    })

    it("Marks its panes as the playground, the scope of the playground editor style", async () => {
        await render()

        expect(byTestId("config-panel")?.closest("[data-playground]")).not.toBeNull()
        expect(byTestId("run-pane")?.closest("[data-playground]")).not.toBeNull()
    })

    it("On a phone the Configuration and Generations switch shows one pane", async () => {
        fixture.wide = false
        await render()

        expect(isShown("config-panel")).toBe(true)
        expect(isShown("run-pane")).toBe(false)

        const generations = [...host.querySelectorAll<HTMLElement>('[role="radio"]')].find(
            (option) => option.textContent === "Generations",
        )!
        await act(async () => generations.click())

        expect(isShown("config-panel")).toBe(false)
        expect(isShown("run-pane")).toBe(true)
        // Hidden, not unmounted: the config editor keeps its state across the switch.
        expect(byTestId("config-panel")).not.toBeNull()
    })

    it("An agent app is sent to the agent page", async () => {
        select({appKind: "agent"})
        await render()

        expect(router.replace).toHaveBeenCalledWith(
            expect.stringMatching(/^\/w\/ws-1\/p\/proj-1\/agents\/app-1/),
        )
    })

    it("An evaluator app shows not found", async () => {
        select({appKind: "evaluator"})
        await render()

        expect(byTestId("not-found")).not.toBeNull()
        expect(byTestId("config-panel")).toBeNull()
    })

    it("A load error shows Something went wrong and Try again refetches", async () => {
        select({status: "error", appKind: null, primaryRevisionId: null, revisionIds: []})
        await render()

        expect(host.textContent).toContain("Something went wrong")
        expect(host.textContent).toContain("Playground is unable to communicate with the service")
        const retry = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Try again",
        )!
        await act(async () => retry.click())

        expect(fixture.selection.retry).toHaveBeenCalled()
    })

    it("Leaving with a dirty revision asks first", async () => {
        fixture.dirty = true
        await render()

        let aborted = false
        await act(async () => {
            try {
                router.events.emit("routeChangeStart", "/w/ws-1/p/proj-1/apps")
            } catch {
                aborted = true
            }
        })

        expect(aborted).toBe(true)
        expect(document.body.textContent).toContain("Discard unsaved changes?")
        expect(document.body.textContent).toContain(
            "You have local draft revisions or unsaved changes that will be lost if you leave.",
        )
    })

    it("Writing the selection to the URL with a dirty revision does not ask", async () => {
        fixture.dirty = true
        await render()

        await act(async () =>
            router.events.emit("routeChangeStart", "/w/ws-1/p/proj-1/apps/app-1/playground", {
                shallow: true,
            }),
        )

        expect(document.body.textContent).not.toContain("Discard unsaved changes?")
    })

    it("Leaving with no changes does not ask", async () => {
        await render()

        await act(async () => router.events.emit("routeChangeStart", "/w/ws-1/p/proj-1/apps"))

        expect(document.body.textContent).not.toContain("Discard unsaved changes?")
    })
})
