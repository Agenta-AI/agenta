// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {NavMenu} from "@agenta/navigation-ui"
import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {developerNavItems} from "@/features/developer/developerNavItems"
import {
    developerViewPreviewAtomFamily,
    isDeveloperViewEnabled,
} from "@/features/developer/developerViewAccess"
import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import type {DeveloperView} from "@/features/developer/developerViews"
import PlaygroundPage from "@/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground"

import {TEST_DEVELOPER_VIEWS} from "./developerViewFixtures"

vi.mock("@/features/developer/developerViews", async () => ({
    DEVELOPER_VIEWS: (await import("./developerViewFixtures")).TEST_DEVELOPER_VIEWS,
}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        asPath: "/w/ws/p/pr/lab-hidden",
        back: vi.fn(),
        query: {workspace_id: "ws", project_id: "pr", app_id: "app-1"},
    }),
}))

// Counts how many times the playground screen module loads. A hidden view must load none.
const playgroundScreenLoads = vi.hoisted(() => ({count: 0}))

vi.mock("@/features/playground/PlaygroundScreen", () => {
    playgroundScreenLoads.count += 1
    return {PlaygroundScreen: () => <p data-testid="playground-screen" />}
})

vi.mock("@/features/playground/states/PlaygroundSkeleton", () => ({
    PlaygroundSkeleton: () => <p data-testid="playground-skeleton" />,
}))

vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => <>{children}</>,
}))

// The prop the rail must pass is invisible in the DOM: expose it.
vi.mock("next/link", () => ({
    default: ({
        href,
        prefetch,
        children,
        ...props
    }: {
        href: string
        prefetch?: boolean
        children?: ReactNode
    }) => (
        <a href={href} data-prefetch={String(prefetch)} {...props}>
            {children}
        </a>
    ),
}))

vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: ({path}: {path?: string}) => <p data-testid="not-found">{path}</p>,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "/w/ws/p/pr"

describe("developer views", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const render = (node: ReactNode) =>
        act(() => root.render(<Provider store={store}>{node}</Provider>))

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        store.set(activeUserIdAtom, "u1")
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        localStorage.clear()
    })

    describe("nav section", () => {
        it("adds nothing when no view is enabled, or only a feature gate with no route", () => {
            expect(developerNavItems(PROJECT, [])).toEqual([])
            const gate = TEST_DEVELOPER_VIEWS.find((view) => view.id === "lab-gate")!
            expect(developerNavItems(PROJECT, [gate])).toEqual([])
        })

        it("renders a Developer section whose links turn off prefetch", () => {
            const [, , on] = TEST_DEVELOPER_VIEWS
            render(
                <NavMenu
                    items={developerNavItems(PROJECT, [on])}
                    collapsed={false}
                    mode="inline"
                />,
            )
            expect(host.textContent).toContain("Developer")
            const links = Array.from(host.querySelectorAll("a"))
            expect(links.map((link) => link.getAttribute("href"))).toEqual([`${PROJECT}/lab-on`])
            expect(links.map((link) => link.dataset.prefetch)).toEqual(["false"])
        })
    })

    describe("DeveloperViewGate", () => {
        const view = <p data-testid="view">view</p>

        it("renders nothing until the signed-in user is known", () => {
            store.set(activeUserIdAtom, null)
            render(<DeveloperViewGate viewId="lab-on">{view}</DeveloperViewGate>)
            expect(host.innerHTML).toBe("")
        })

        it("renders the view when it is on", () => {
            render(<DeveloperViewGate viewId="lab-on">{view}</DeveloperViewGate>)
            expect(host.querySelector("[data-testid=view]")).not.toBeNull()
        })

        it("renders not found for a hidden view, and for an unknown id", () => {
            render(<DeveloperViewGate viewId="lab-hidden">{view}</DeveloperViewGate>)
            expect(host.querySelector("[data-testid=view]")).toBeNull()
            expect(host.querySelector("[data-testid=not-found]")?.textContent).toBe(
                `${PROJECT}/lab-hidden`,
            )
            render(<DeveloperViewGate viewId="nope">{view}</DeveloperViewGate>)
            expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
        })

        it("renders a preview view only after the user switches it on", () => {
            render(<DeveloperViewGate viewId="lab-preview">{view}</DeveloperViewGate>)
            expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
            act(() => store.set(developerViewPreviewAtomFamily("lab-preview"), true))
            expect(host.querySelector("[data-testid=view]")).not.toBeNull()
        })
    })

    describe("endpoints view", () => {
        it("Endpoints route shows not found while the view is hidden", async () => {
            const actual = await vi.importActual<{DEVELOPER_VIEWS: readonly DeveloperView[]}>(
                "@/features/developer/developerViews",
            )
            const endpoints = actual.DEVELOPER_VIEWS.find((view) => view.id === "endpoints")
            expect(endpoints).toBeDefined()
            expect(endpoints!.stage).toBe("hidden")
            expect(endpoints!.routes?.[0]).toBe("/endpoints")
            expect(
                isDeveloperViewEnabled(endpoints!, {previewOptedIn: false, forcedIds: new Set()}),
            ).toBe(false)
        })
    })

    describe("playground view", () => {
        it("Playground route shows not found while the view is hidden", async () => {
            const actual = await vi.importActual<{DEVELOPER_VIEWS: readonly DeveloperView[]}>(
                "@/features/developer/developerViews",
            )
            const playground = actual.DEVELOPER_VIEWS.find((view) => view.id === "playground")
            expect(playground).toBeDefined()
            expect(playground!.stage).toBe("hidden")
            expect(playground!.nav).toBeUndefined()
            expect(playground!.routes?.[0]).toBe("/apps/[app_id]/playground")
            expect(
                isDeveloperViewEnabled(playground!, {previewOptedIn: false, forcedIds: new Set()}),
            ).toBe(false)
        })

        it("A hidden playground view loads no screen code", () => {
            render(<PlaygroundPage />)
            expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
            expect(host.querySelector("[data-testid=playground-screen]")).toBeNull()
            expect(playgroundScreenLoads.count).toBe(0)
        })
    })

    describe("evaluators view", () => {
        it("Evaluators routes show not found while the view is hidden", async () => {
            const actual = await vi.importActual<{DEVELOPER_VIEWS: readonly DeveloperView[]}>(
                "@/features/developer/developerViews",
            )
            const evaluators = actual.DEVELOPER_VIEWS.find((view) => view.id === "evaluators")
            expect(evaluators).toBeDefined()
            expect(evaluators!.stage).toBe("hidden")
            expect(evaluators!.routes).toEqual(["/evaluators", "/evaluators/archived"])
            expect(
                isDeveloperViewEnabled(evaluators!, {previewOptedIn: false, forcedIds: new Set()}),
            ).toBe(false)
        })
    })
})
