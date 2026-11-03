// @vitest-environment jsdom
import {act, createElement, lazy, Suspense, type ComponentType} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import EvaluationsPage from "@/pages/w/[workspace_id]/p/[project_id]/evaluations"

const screen = vi.hoisted(() => vi.fn())
const nav = vi.hoisted(() => ({replace: vi.fn()}))

vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: () => createElement("p", {"data-testid": "not-found"}),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {workspace_id: "ws", project_id: "pr"},
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations",
        asPath: "/",
        back: vi.fn(),
        replace: nav.replace,
    }),
}))
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
        const Lazy = lazy(() => loader().then((component) => ({default: component})))
        return (props: Record<string, unknown>) =>
            createElement(Suspense, {fallback: null}, createElement(Lazy, props))
    },
}))
vi.mock("@/features/evaluations/list/EvaluationsScreen", () => ({
    EvaluationsScreen: ({onCreate}: {onCreate: (kind: string) => void}) => {
        screen()
        return createElement(
            "button",
            {"data-testid": "create-live", onClick: () => onCreate("online")},
            "Evaluations screen",
        )
    },
}))
vi.mock("@/features/evaluations/live/LiveEvaluationSheet", () => ({
    LiveEvaluationSheet: ({open, onCreated}: {open: boolean; onCreated: () => void}) =>
        open
            ? createElement("button", {"data-testid": "live-created", onClick: onCreated}, "Live")
            : null,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const mount = async () => {
    const store = createStore()
    store.set(activeUserIdAtom, "user-1")
    await act(async () =>
        root.render(createElement(Provider, {store}, createElement(EvaluationsPage))),
    )
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    screen.mockReset()
})

afterEach(() => {
    vi.unstubAllEnvs()
    act(() => root.unmount())
    host.remove()
})

describe("evaluations route", () => {
    it("Evaluations route shows not found while the view is hidden", async () => {
        const view = DEVELOPER_VIEWS.find((entry) => entry.id === "evaluations")
        expect(view?.stage).toBe("hidden")
        expect(view?.routes).toEqual(["/evaluations"])
        await mount()
        expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
        expect(screen).not.toHaveBeenCalled()
    })

    it("The route shows the screen when the deployment forces the view on", async () => {
        vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "evaluations")
        await mount()
        expect(host.textContent).toContain("Evaluations screen")
    })

    it("A created live evaluation opens the Live tab", async () => {
        vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "evaluations")
        await mount()
        await act(async () => host.querySelector<HTMLElement>("[data-testid=create-live]")?.click())
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await act(async () =>
            host.querySelector<HTMLElement>("[data-testid=live-created]")?.click(),
        )
        expect(nav.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({kind: "online"})}),
            undefined,
            {shallow: true},
        )
    })
})
