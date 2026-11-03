// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {activeUserIdAtom, projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only the HTTP layer is fake. The run query, its selectors, the save function and the save hook
// are the real package and app code, so the request body is what the API would receive.
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

const router = vi.hoisted(() => ({query: {} as Record<string, string>, replace: vi.fn()}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        asPath: "/w/ws/p/pr/evaluations/results/run",
        replace: router.replace,
        back: vi.fn(),
    }),
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
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
vi.mock("@/components/PageTitle", () => ({
    PageTitle: ({title}: {title: string}) => createElement("span", {"data-testid": "title"}, title),
}))
vi.mock("@agenta/auth-ui", () => ({NotFoundScreen: () => null}))

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import EvaluationRunPage from "@/pages/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let runCounter = 0

/** The run as the API stores it, with fields the package schema does not list. */
const storedData = {
    steps: [
        {
            key: "input-1",
            type: "input",
            origin: "custom",
            inputs: [{key: "country"}],
            references: {testset: {id: "ts-1"}, testset_revision: {id: "ts-rev-1"}},
            extra_step_field: "kept",
        },
        {
            key: "app-1",
            type: "invocation",
            origin: "auto",
            inputs: [{key: "input-1"}],
            references: {
                application: {id: "app-1"},
                application_revision: {id: "rev-1", version: 2},
            },
        },
    ],
    repeats: 2,
    mappings: [{column: {kind: "input", name: "country"}, step: {key: "input-1", path: "country"}}],
    extra_data_field: {nested: true},
}

let stored: Record<string, unknown>

/** A new run id per test: the package caches runs by id for the whole file. */
function serveRun(overrides: Record<string, unknown> = {}) {
    const id = `run-${++runCounter}`
    stored = {
        id,
        name: "Capitals check",
        description: "Checks capitals",
        status: "evaluation_finished",
        version: "2025.07.14",
        flags: {is_live: false, is_active: false, is_closed: false, has_testsets: true},
        tags: ["geography"],
        meta: {owner: "team"},
        data: storedData,
        created_at: "2026-10-01T09:30:00Z",
        updated_at: "2026-10-01T09:30:00Z",
        created_by_id: "user-1",
        ...overrides,
    }
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/evaluations/runs/query")) return {data: {count: 1, runs: [stored]}}
        if (url.endsWith("/evaluations/metrics/query")) return {data: {count: 0, metrics: []}}
        return {data: {}}
    })
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith(`/evaluations/runs/${id}`)) return {data: {count: 1, run: stored}}
        return {data: {}}
    })
    router.query = {
        workspace_id: "ws",
        project_id: "pr",
        evaluation_id: id,
        view: "configuration",
    }
    return id
}

/** The package batches run requests for about 80 ms before it sends them. */
const flush = () =>
    act(async () => {
        for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    })

async function mount() {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(QueryClientProvider, {client}, createElement(EvaluationRunPage)),
            ),
        )
    })
    await flush()
    // The tab body is a separate chunk: wait for it, as a reader would.
    for (let i = 0; i < 30 && !host.querySelector('[aria-label="Run summary"]'); i++) {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 100)))
    }
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
    permission.allowed = true
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllEnvs()
})

describe("run summary card", () => {
    it("Shows the status, name, description, tags and run id", async () => {
        const id = serveRun()
        await mount()
        expect(host.textContent).toContain("Evaluation Finished")
        expect(host.textContent).toContain("Capitals check")
        expect(host.textContent).toContain("Checks capitals")
        expect(host.textContent).toContain("geography")
        expect(host.textContent).toContain(id)
        expect(host.querySelector('[aria-label="Copy run ID"]')).not.toBeNull()
    })

    it("The card has no Edit button, even for a reader who may edit evaluation runs", async () => {
        permission.allowed = true
        serveRun()
        await mount()
        expect(host.textContent).toContain("Capitals check")
        expect(buttonNamed("Edit")).toBeUndefined()
        expect(host.querySelector('input[placeholder="Run name"]')).toBeNull()
    })

    it("Opening the Configuration tab sends no write request", async () => {
        serveRun()
        await mount()
        expect(host.textContent).toContain("Capitals check")
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.put).not.toHaveBeenCalled()
        expect(http.delete).not.toHaveBeenCalled()
        expect(
            http.post.mock.calls
                .map((call) => String(call[0]))
                .filter((url) => !url.endsWith("/query")),
        ).toEqual([])
    })

    it("The evaluations view is still hidden by default", () => {
        expect(DEVELOPER_VIEWS.find((view) => view.id === "evaluations")?.stage).toBe("hidden")
    })
})
