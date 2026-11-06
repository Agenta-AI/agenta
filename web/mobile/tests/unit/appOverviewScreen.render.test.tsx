// @vitest-environment jsdom
import {act, createElement, lazy, Suspense, type ComponentType, type ReactNode} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The page loads the screen through next/dynamic; a static import makes the lazy load settle fast.
import "@/features/app-overview/AppOverviewScreen"
import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import AppOverviewPage from "@/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/overview"

// The lists and the agent flags are the package's own queries; only axios is replaced. The
// sections and the menu have their own tests, so they stand in here as markers.
const http = vi.hoisted(() => ({post: vi.fn()}))
const router = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: () => createElement("p", {"data-testid": "not-found"}),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        asPath: "/apps/x/overview",
        replace: router.replace,
        back: vi.fn(),
    }),
}))
const beta = vi.hoisted(() => ({atom: null as PrimitiveAtom<boolean> | null}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    beta.atom = atom(false)
    return {...original, betaDeveloperModeActiveAtom: beta.atom}
})
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
        const Lazy = lazy(() => loader().then((component) => ({default: component})))
        return (props: Record<string, unknown>) =>
            createElement(Suspense, {fallback: null}, createElement(Lazy, props))
    },
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => createElement("div", null, children),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/features/app-overview/AppActionsMenu", () => ({
    AppActionsMenu: () => createElement("span", null, "actions-menu"),
}))
vi.mock("@/features/app-overview/AppUsageSection", () => ({
    AppUsageSection: ({appId}: {appId: string}) =>
        createElement("section", null, `usage-section:${appId}`),
}))
vi.mock("@/features/app-overview/AppDeploymentSection", () => ({
    AppDeploymentSection: () => createElement("section", null, "deployment-section"),
}))
vi.mock("@/features/app-overview/AppRecentPromptsSection", () => ({
    AppRecentPromptsSection: () => createElement("section", null, "prompts-section"),
}))
vi.mock("@/features/app-overview/AppEvaluationsSection", () => ({
    AppEvaluationsSection: ({kind}: {kind: string}) =>
        createElement("section", null, `${kind}-evaluations-section`),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROMPT = {
    id: "app-1",
    name: "Support bot",
    slug: "support-bot",
    flags: {is_application: true},
}
const AGENT = {id: "agent-1", name: "Helper", slug: "helper", flags: {is_application: true}}

let host: HTMLDivElement
let root: Root
let client: QueryClient
let store: ReturnType<typeof createStore>
/** Holds the agent-flag answer back, to show the page waits for it. */
let releaseFlags: (() => void) | null
let flagsDelayed: boolean
let listFails: boolean
let listDelayed: boolean
const listWaiters: (() => void)[] = []

const answer = async (url: string, body: {grouping?: unknown}) => {
    if (url.endsWith("/workflows/revisions/query")) {
        if (flagsDelayed) await new Promise<void>((resolve) => (releaseFlags = resolve))
        return {
            data: {
                count: 2,
                workflow_revisions: [
                    {id: "rev-a", workflow_id: "app-1", flags: {is_agent: false}},
                    {id: "rev-b", workflow_id: "agent-1", flags: {is_agent: true}},
                ],
            },
        }
    }
    if (listDelayed) await new Promise<void>((resolve) => listWaiters.push(resolve))
    if (listFails) throw new Error("boom")
    return {data: {count: 2, workflows: [PROMPT, AGENT]}}
}

const settle = async () => {
    for (let turn = 0; turn < 5; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
}

const mount = async (appId: string) => {
    router.query = {workspace_id: "ws", project_id: "pr", app_id: appId}
    await act(async () =>
        root.render(
            createElement(
                Provider,
                {store},
                createElement(QueryClientProvider, {client}, createElement(AppOverviewPage)),
            ),
        ),
    )
    await settle()
}

const text = () => host.textContent ?? ""

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store = createStore()
    store.set(queryClientAtom, client)
    store.set(activeUserIdAtom, "user-1")
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    http.post.mockReset().mockImplementation(answer)
    router.replace.mockReset()
    releaseFlags = null
    listWaiters.length = 0
    flagsDelayed = false
    listFails = false
    listDelayed = false
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "app-overview")
})

afterEach(() => {
    vi.unstubAllEnvs()
    act(() => root.unmount())
    host.remove()
})

describe("app overview screen", () => {
    it("The overview route shows not found while the view is hidden", async () => {
        vi.unstubAllEnvs()
        const view = DEVELOPER_VIEWS.find((entry) => entry.id === "app-overview")
        expect(view?.stage).toBe("hidden")
        expect(view?.routes).toEqual(["/apps/[app_id]/overview"])
        await mount("app-1")
        expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
        expect(text()).not.toContain("deployment-section")
    })

    it("A prompt app shows its name and every section in order", async () => {
        await mount("app-1")
        expect(host.querySelector("h1")?.textContent).toBe("Support bot")
        expect(text()).toContain("actions-menu")
        const body = text()
        const order = [
            "deployment-section",
            "prompts-section",
            "auto-evaluations-section",
            "human-evaluations-section",
        ].map((marker) => body.indexOf(marker))
        expect(order.every((index) => index >= 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

    it("Without beta developer mode the overview has no usage charts", async () => {
        await mount("app-1")
        expect(text()).toContain("deployment-section")
        expect(text()).not.toContain("usage-section")
    })

    it("In beta developer mode the usage charts of this app lead the overview", async () => {
        if (beta.atom) store.set(beta.atom, true)
        await mount("app-1")
        const body = text()
        expect(body).toContain("usage-section:app-1")
        expect(body.indexOf("usage-section")).toBeLessThan(body.indexOf("deployment-section"))
    })

    it("An agent id redirects to the agent overview", async () => {
        await mount("agent-1")
        expect(router.replace).toHaveBeenCalledTimes(1)
        expect(String(router.replace.mock.calls[0][0])).toMatch(/^\/w\/ws\/p\/pr\/agents\/agent-1/)
        expect(text()).not.toContain("deployment-section")
    })

    it("The page waits for the agent flags before it shows any section", async () => {
        flagsDelayed = true
        await mount("agent-1")
        expect(text()).not.toContain("deployment-section")
        expect(host.querySelector("[data-testid=not-found]")).toBeNull()
        expect(router.replace).not.toHaveBeenCalled()
        await act(async () => releaseFlags?.())
        await settle()
        expect(router.replace).toHaveBeenCalledTimes(1)
        expect(text()).not.toContain("deployment-section")
    })

    it("An unknown or archived app id shows not found", async () => {
        await mount("app-gone")
        expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
        expect(text()).not.toContain("deployment-section")
    })

    it("The app name heading shows a skeleton until the name loads", async () => {
        listDelayed = true
        await mount("app-1")
        expect(host.querySelector("h1")).toBeNull()
        expect(host.querySelector("[data-slot=skeleton]")).not.toBeNull()
        await act(async () => listWaiters.forEach((release) => release()))
        await settle()
        expect(host.querySelector("h1")?.textContent).toBe("Support bot")
    })

    it("A failed apps load shows Could not load apps with a retry", async () => {
        listFails = true
        await mount("app-1")
        expect(text()).toContain("Could not load apps")
        expect(text()).not.toContain("deployment-section")
        expect(host.querySelector("[data-testid=not-found]")).toBeNull()
    })
})
