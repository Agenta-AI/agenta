// @vitest-environment jsdom
/**
 * The prompt playground screen: its states, the desktop split and the phone switch, the route
 * out for an agent app, and the in-app leave guard. The selection hook has its own test; here it
 * is a fixture. The config panel is a stub.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"
import type {PlaygroundSession} from "@/features/playground/usePlaygroundSession"

const {fixture, router, routeHandlers} = vi.hoisted(() => {
    const routeHandlers = new Map<string, Set<(url: string) => void>>()
    return {
        routeHandlers,
        fixture: {
            session: {} as PlaygroundSession & {appName: string | null},
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
                on: (name: string, handler: (url: string) => void) => {
                    if (!routeHandlers.has(name)) routeHandlers.set(name, new Set())
                    routeHandlers.get(name)!.add(handler)
                },
                off: (name: string, handler: (url: string) => void) =>
                    routeHandlers.get(name)?.delete(handler),
                emit: (name: string, url = "") =>
                    routeHandlers.get(name)?.forEach((handler) => handler(url)),
            },
        },
    }
})

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@/features/playground/usePlaygroundSession", () => ({
    usePlaygroundSession: () => fixture.session,
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
    PlaygroundConfigPanel: ({revisionId}: {revisionId: string}) => (
        <div data-testid="config-panel">{revisionId}</div>
    ),
    ConfigPanelSkeleton: () => <div data-testid="config-panel-skeleton" />,
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

const session = (patch: Partial<PlaygroundSession & {appName: string | null}>) => {
    fixture.session = {
        status: "ready",
        primaryId: "rev-1",
        entityIds: ["rev-1"],
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

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    fixture.wide = true
    fixture.dirty = false
    routeHandlers.clear()
    router.replace.mockClear()
    router.push.mockClear()
    session({})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("PlaygroundScreen", () => {
    it("A prompt app shows its config pane and the run placeholder", async () => {
        await render()

        expect(host.querySelector("h1")?.textContent).toBe("Greeter")
        expect(host.textContent).toContain("Playground")
        expect(byTestId("config-panel")?.textContent).toBe("rev-1")
        expect(byTestId("run-pane-placeholder")).not.toBeNull()
        expect(byTestId("page-title")?.textContent).toBe("Playground | Greeter")
    })

    it("On a phone the Configuration and Generations switch shows one pane", async () => {
        fixture.wide = false
        await render()

        expect(byTestId("config-panel")).not.toBeNull()
        expect(byTestId("run-pane-placeholder")).toBeNull()

        const generations = [...host.querySelectorAll<HTMLElement>('[role="radio"]')].find(
            (option) => option.textContent === "Generations",
        )!
        await act(async () => generations.click())

        expect(byTestId("config-panel")).toBeNull()
        expect(byTestId("run-pane-placeholder")).not.toBeNull()
    })

    it("An agent app is sent to the agent page", async () => {
        session({status: "agent"})
        await render()

        expect(router.replace).toHaveBeenCalledWith(
            expect.stringMatching(/^\/w\/ws-1\/p\/proj-1\/agents\/app-1/),
        )
    })

    it("An evaluator app shows not found", async () => {
        session({status: "evaluator"})
        await render()

        expect(byTestId("not-found")).not.toBeNull()
        expect(byTestId("config-panel")).toBeNull()
    })

    it("A load error shows Something went wrong and Try again refetches", async () => {
        session({status: "error", primaryId: null, entityIds: []})
        await render()

        expect(host.textContent).toContain("Something went wrong")
        expect(host.textContent).toContain("Playground is unable to communicate with the service")
        const retry = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Try again",
        )!
        await act(async () => retry.click())

        expect(fixture.session.retry).toHaveBeenCalled()
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

    it("Leaving with no changes does not ask", async () => {
        await render()

        await act(async () => router.events.emit("routeChangeStart", "/w/ws-1/p/proj-1/apps"))

        expect(document.body.textContent).not.toContain("Discard unsaved changes?")
    })
})
