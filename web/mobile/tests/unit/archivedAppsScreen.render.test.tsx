// @vitest-environment jsdom
import {act, createElement} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const api = vi.hoisted(() => ({queryWorkflows: vi.fn(), ensureAgentFlags: vi.fn()}))
vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
    ensureAgentFlags: (...args: unknown[]) => api.ensureAgentFlags(...args),
}))
vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: () => createElement("p", {"data-testid": "not-found"}),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {workspace_id: "ws", project_id: "pr"},
        asPath: "/w/ws/p/pr/apps/archived",
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
import ArchivedAppsPage from "@/pages/w/[workspace_id]/p/[project_id]/apps/archived"
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
                    createElement(ArchivedAppsPage),
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
    api.queryWorkflows.mockReset()
    api.ensureAgentFlags.mockReset()
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

describe("archived apps route", () => {
    it("Archived apps route shows not found until the user turns the view on", async () => {
        expect(DEVELOPER_VIEWS.find((view) => view.id === "archived-apps")?.stage).toBe("preview")
        await mount()
        expect(document.querySelector('[data-testid="not-found"]')).not.toBeNull()
        expect(host.textContent).not.toContain("Archived Apps")
        expect(api.queryWorkflows).not.toHaveBeenCalled()
    })

    it("A failed load shows Could not load archived apps with a retry", async () => {
        // The view is hidden in the registry; the deployment override is how a view is forced on.
        vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "archived-apps")
        api.queryWorkflows.mockRejectedValue(new Error("boom"))
        await mount()
        expect(host.textContent).toContain("Could not load archived apps")
        expect(host.textContent).not.toContain("No archived apps")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        expect(retry).toBeDefined()
        await act(async () => retry?.click())
        expect(api.queryWorkflows).toHaveBeenCalledTimes(2)
    })
})
