// @vitest-environment jsdom
import {act, createElement} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const api = vi.hoisted(() => ({page: vi.fn()}))
vi.mock("@agenta/entities/testset", async (original) => ({
    ...(await original<object>()),
    queryTestsetsPage: (...args: unknown[]) => api.page(...args),
}))
vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: () => createElement("p", {"data-testid": "not-found"}),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {workspace_id: "ws", project_id: "pr"},
        asPath: "/w/ws/p/pr/testsets/archived",
        push: vi.fn(),
        back: vi.fn(),
    }),
}))
// The shell is not what these tests read: stand in for it and its project binding.
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => createElement("div", null, children),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: noop}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import ArchivedTestsetsPage from "@/pages/w/[workspace_id]/p/[project_id]/testsets/archived"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

const mount = async () => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client: new QueryClient({defaultOptions: {queries: {retry: false}}})},
                    createElement(ArchivedTestsetsPage),
                ),
            ),
        )
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store = createStore()
    store.set(activeUserIdAtom, "user-1")
    api.page.mockReset()
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: noop,
        removeEventListener: noop,
    })) as unknown as typeof window.matchMedia
})

afterEach(() => {
    vi.unstubAllEnvs()
    act(() => root.unmount())
    host.remove()
})

describe("archived test sets route", () => {
    it("Archived testsets route shows not found while the view is hidden", async () => {
        expect(DEVELOPER_VIEWS.find((view) => view.id === "testsets")?.stage).toBe("hidden")
        await mount()
        expect(document.querySelector('[data-testid="not-found"]')).not.toBeNull()
        expect(host.textContent).not.toContain("Archived test sets")
        expect(api.page).not.toHaveBeenCalled()
    })

    it("The page shows its title, subtitle and a Back link to the test sets list", async () => {
        vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "testsets")
        api.page.mockResolvedValue({testsets: [], nextCursor: null})
        await mount()
        expect(host.textContent).toContain("Archived test sets")
        expect(host.textContent).toContain(
            "Archived test sets are hidden from your workspace but can be restored at any time.",
        )
        const back = host.querySelector('a[aria-label="Back to test sets"]')
        expect(back?.getAttribute("href")).toBe("/w/ws/p/pr/testsets")
        expect(host.textContent).toContain("No archived test sets")
    })

    it("A failed load shows Could not load archived test sets with a retry", async () => {
        vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "testsets")
        api.page.mockRejectedValue(new Error("boom"))
        await mount()
        expect(host.textContent).toContain("Could not load archived test sets")
        expect(host.textContent).not.toContain("No archived test sets")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        expect(retry).toBeDefined()
        await act(async () => retry?.click())
        expect(api.page).toHaveBeenCalledTimes(2)
    })
})
