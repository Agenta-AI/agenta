// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {activeUserIdAtom, projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only the HTTP layer is fake: the run query, its selectors and the pause and resume calls are
// the real package code.
const http = vi.hoisted(() => ({
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<typeof import("@agenta/shared/api")>()),
    axios: http,
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

const router = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        asPath: "/w/ws/p/pr/evaluations/results/run",
        replace: router.replace,
        back: vi.fn(),
    }),
}))
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
const permission = vi.hoisted(() => ({allowed: true}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => permission.allowed,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: () => createElement("p", {"data-testid": "not-found"}),
}))

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import {
    defaultRunDetailsView,
    runDetailsTabs,
    useRunDetailsView,
} from "@/features/evaluation-run/useRunDetailsView"
import EvaluationRunPage from "@/pages/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let runCounter = 0

interface RunSpec {
    status?: string
    live?: boolean
    active?: boolean
    human?: boolean
    name?: string
    /** Test set, app and evaluator references, so the overview looks up their names. */
    references?: boolean
}

const REFERENCED_STEPS = [
    {key: "ts", type: "input", references: {testset: {id: "ts-1"}}},
    {
        key: "app",
        type: "invocation",
        references: {application: {id: "app-1"}, application_revision: {id: "rev-1", version: 2}},
    },
    {key: "ev", type: "annotation", origin: "auto", references: {evaluator: {id: "ev-1"}}},
]

/** A new run id per test: the package caches runs by id for the whole file. */
function serveRun(spec: RunSpec | null) {
    const id = `run-${++runCounter}`
    const run = spec && {
        id,
        name: spec.name ?? "Capitals check",
        status: spec.status ?? "success",
        flags: {is_live: Boolean(spec.live), is_active: Boolean(spec.active), is_closed: false},
        data: {
            steps: spec.references
                ? REFERENCED_STEPS
                : spec.human
                  ? [{key: "ev", type: "annotation", origin: "human", references: {}}]
                  : [],
        },
    }
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/evaluations/runs/query")) {
            return {data: {count: run ? 1 : 0, runs: run ? [run] : []}}
        }
        if (url.endsWith("/evaluations/metrics/query")) return {data: {count: 0, metrics: []}}
        if (url.endsWith("/evaluations/scenarios/query")) return {data: {count: 0, scenarios: []}}
        if (url.endsWith(`/simple/evaluations/${id}/stop`)) return {data: {evaluation: {id}}}
        if (url.endsWith(`/simple/evaluations/${id}/start`)) throw new Error("Request failed")
        throw new Error(`unexpected request ${url}`)
    })
    router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: id}
    return id
}

/** The package batches run and metric requests for about 80 ms before it sends them. */
const flush = () =>
    act(async () => {
        for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    })

async function mount(target = store) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store: target},
                createElement(QueryClientProvider, {client}, createElement(EvaluationRunPage)),
            ),
        )
    })
    await flush()
}

const buttonNamed = (name: string) =>
    [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === name)

beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "evaluations")
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(activeUserIdAtom, "user-1")
    store.set(projectIdAtom, "pr")
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    permission.allowed = true
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllEnvs()
})

describe("run details tabs", () => {
    it("A human run that is still running opens on the Annotate tab", () => {
        expect(defaultRunDetailsView({kind: "human", status: "running"})).toBe("focus")
        expect(runDetailsTabs({kind: "human"}).map((tab) => tab.label)).toEqual([
            "Overview",
            "Scenarios",
            "Configuration",
            "Annotate",
        ])
    })

    it("A finished human run opens on the Overview tab", () => {
        expect(defaultRunDetailsView({kind: "human", status: "COMPLETED"})).toBe("overview")
    })

    it("An auto run has no Annotate tab", async () => {
        serveRun({})
        await mount()
        const tabs = [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
        expect(tabs).toEqual(["Overview", "Scenarios", "Configuration"])
        expect(host.textContent).toContain("Capitals check")
    })

    it("Changing the tab writes view to the URL", async () => {
        router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: "run-x"}
        let setView: (next: string) => void = () => undefined
        const Probe = () => {
            setView = useRunDetailsView(null).setView
            return null
        }
        await act(async () => root.render(createElement(Probe)))
        act(() => setView("scenarios"))
        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
                query: {...router.query, view: "scenarios"},
            },
            undefined,
            {shallow: true},
        )
    })
})

describe("run details page", () => {
    it("Opening a run sends no write request", async () => {
        // Every read the page makes, including the name lookups of the test set, app, variant
        // and evaluator: through axios or through fetch (the Fern client).
        const fetched: string[] = []
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                fetched.push(`${init?.method ?? "GET"} ${String(input)}`)
                return new Response("{}", {status: 404})
            }),
        )
        store.set(sessionAtom, true)
        serveRun({status: "running", live: true, active: true, references: true})
        http.get.mockResolvedValue({data: {}})
        await mount()
        await flush()

        expect(host.textContent).toContain("Evaluator Scores Overview")
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.put).not.toHaveBeenCalled()
        expect(http.delete).not.toHaveBeenCalled()
        const posted = http.post.mock.calls.map((call) => String(call[0]))
        expect(posted).toContain("https://agenta.test/api/evaluations/runs/query")
        expect(posted).toContain("https://agenta.test/api/evaluations/metrics/query")
        // Every POST is a query: a read with a body, never a change.
        expect(posted.filter((url) => !url.endsWith("/query"))).toEqual([])
        expect(fetched.filter((line) => !/^(GET|POST \S+\/query)\b/.test(line))).toEqual([])
        vi.unstubAllGlobals()
        store.set(sessionAtom, false)
    })

    it("The Scenarios tab loads only when it is opened", async () => {
        serveRun({})
        await mount()
        expect(http.post.mock.calls.map((call) => String(call[0]))).not.toContain(
            "https://agenta.test/api/evaluations/scenarios/query",
        )
        expect(host.textContent).not.toContain("No scenarios")
    })

    it("Opening the Scenarios tab sends no write request", async () => {
        serveRun({status: "running", live: true, active: true, references: true})
        router.query = {...router.query, view: "scenarios"}
        await mount()
        await flush()
        expect(host.textContent).toContain("No scenarios")
        expect(http.post.mock.calls.map((call) => String(call[0]))).toContain(
            "https://agenta.test/api/evaluations/scenarios/query",
        )
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.put).not.toHaveBeenCalled()
        expect(http.delete).not.toHaveBeenCalled()
        const posted = http.post.mock.calls.map((call) => String(call[0]))
        expect(posted.filter((url) => !url.endsWith("/query"))).toEqual([])
    })

    it("Pausing an active online run calls stop and shows Evaluation stopped", async () => {
        const id = serveRun({status: "running", live: true, active: true})
        await mount()
        await act(async () => buttonNamed("Pause")?.click())
        await flush()
        expect(http.post).toHaveBeenCalledWith(
            `https://agenta.test/api/simple/evaluations/${id}/stop`,
            undefined,
            {params: {project_id: "pr"}},
        )
        expect(toast.success).toHaveBeenCalledWith("Evaluation stopped")
    })

    it("A failed resume shows Failed to resume evaluation", async () => {
        serveRun({status: "running", live: true, active: false})
        await mount()
        await act(async () => buttonNamed("Resume")?.click())
        await flush()
        expect(toast.error).toHaveBeenCalledWith("Failed to resume evaluation")
        expect(toast.success).not.toHaveBeenCalled()
    })

    it("A reader without edit rights sees no Pause button", async () => {
        permission.allowed = false
        serveRun({status: "running", live: true, active: true})
        await mount()
        expect(host.textContent).toContain("Capitals check")
        expect(buttonNamed("Pause")).toBeUndefined()
    })

    it("An unknown run shows not found", async () => {
        serveRun(null)
        await mount()
        expect(host.querySelector('[data-testid="not-found"]')).not.toBeNull()
    })

    it("A failed run load shows Could not load this evaluation", async () => {
        serveRun({})
        http.post.mockRejectedValue(new Error("Request failed with status code 500"))
        await mount()
        expect(host.textContent).toContain("Could not load this evaluation")
    })

    it("Run details route shows not found while the view is hidden", async () => {
        vi.unstubAllEnvs()
        expect(DEVELOPER_VIEWS.find((view) => view.id === "evaluations")).toMatchObject({
            stage: "hidden",
            routes: ["/evaluations", "/evaluations/results/[evaluation_id]"],
        })
        serveRun({})
        // A fresh store: the default one keeps the views it read with the env override on.
        const fresh = createStore()
        fresh.set(activeUserIdAtom, "user-1")
        await mount(fresh)
        expect(host.querySelector('[data-testid="not-found"]')).not.toBeNull()
        expect(http.post).not.toHaveBeenCalled()
    })
})

describe("scenario focus drawer", () => {
    it("The focus drawer code loads only when a scenario is focused", async () => {
        serveRun({})
        await mount()
        expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it("A focused scenario opens the drawer, and opening it sends no write request", async () => {
        const id = serveRun({})
        router.query = {...router.query, focusScenarioId: "sc-1", focusRunId: id}
        await mount()
        await flush()
        expect(document.body.textContent).toContain("This scenario is not in this evaluation")
        const posted = http.post.mock.calls.map((call) => String(call[0]))
        expect(posted.filter((url) => !url.endsWith("/query"))).toEqual([])
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.put).not.toHaveBeenCalled()
        expect(http.delete).not.toHaveBeenCalled()
    })
})
