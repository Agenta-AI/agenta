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
    http.patch.mockImplementation(async (url: string, body: {run: Record<string, unknown>}) => {
        stored = {...stored, ...body.run}
        return {data: {count: 1, run: stored}}
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

/** Type into a controlled field the way a user does. */
async function typeInto(selector: string, value: string) {
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
    if (!field) throw new Error(`no field ${selector}`)
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const NAME = 'input[placeholder="Run name"]'
const DESCRIPTION = 'textarea[placeholder="Description (optional)"]'

async function openEditor() {
    await act(async () => buttonNamed("Edit")?.click())
}

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

    it("Save sends the full run: the data and references unchanged, only the name and description new", async () => {
        const id = serveRun()
        await mount()
        await openEditor()
        await typeInto(NAME, "  Capitals v2 ")
        await typeInto(DESCRIPTION, "Second pass")
        await act(async () => buttonNamed("Save")?.click())
        await flush()

        expect(http.patch).toHaveBeenCalledTimes(1)
        const [url, body, config] = http.patch.mock.calls[0]
        expect(url).toBe(`https://agenta.test/api/evaluations/runs/${id}`)
        expect(config).toEqual({params: {project_id: "pr"}})
        // The whole `data` goes back, including what the package schema does not list, so the
        // API rebuilds the run references from the same steps.
        expect(body.run.data).toEqual(storedData)
        // Only the run id, the two edited fields and `data`: the API keeps every field a body
        // leaves out, so a status or flag change made a moment ago is not undone.
        expect(body).toEqual({
            run: {id, name: "Capitals v2", description: "Second pass", data: storedData},
        })
        expect(toast.success).toHaveBeenCalledWith("Evaluation run updated")
    })

    it("After save the title shows the new name", async () => {
        serveRun()
        await mount()
        await openEditor()
        await typeInto(NAME, "Capitals v2")
        await act(async () => buttonNamed("Save")?.click())
        await flush()
        expect(host.querySelector('[data-testid="title"]')?.textContent).toBe("Capitals v2")
        // The form closed and the card shows the saved name.
        expect(host.querySelector(NAME)).toBeNull()
        expect(host.textContent).toContain("Capitals v2")
    })

    it("An empty name cannot be saved", async () => {
        serveRun()
        await mount()
        await openEditor()
        await typeInto(NAME, "   ")
        const save = buttonNamed("Save") as HTMLButtonElement
        expect(save.disabled).toBe(true)
        await act(async () => save.click())
        expect(http.patch).not.toHaveBeenCalled()
    })

    it("A second Save click while saving sends no request", async () => {
        serveRun()
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => (release = resolve))
        const patch = http.patch.getMockImplementation()
        http.patch.mockImplementation(async (...args: unknown[]) => {
            await gate
            return patch?.(...(args as [string, {run: Record<string, unknown>}]))
        })
        await mount()
        await openEditor()
        await typeInto(NAME, "Capitals v2")
        const save = buttonNamed("Save") as HTMLButtonElement
        await act(async () => {
            save.click()
            save.click()
        })
        await act(async () => save.click())
        expect(http.patch).toHaveBeenCalledTimes(1)
        release()
        await flush()
        expect(http.patch).toHaveBeenCalledTimes(1)
    })

    it("A failed save shows Failed to update evaluation run and keeps the typed values", async () => {
        serveRun()
        http.patch.mockRejectedValue(new Error("Request failed with status code 500"))
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        await openEditor()
        await typeInto(NAME, "Capitals v2")
        await typeInto(DESCRIPTION, "Second pass")
        await act(async () => buttonNamed("Save")?.click())
        await flush()

        expect(toast.error).toHaveBeenCalledWith("Failed to update evaluation run")
        expect(toast.success).not.toHaveBeenCalled()
        // No raw error text reaches the reader.
        expect(host.textContent).not.toContain("status code 500")
        expect(host.querySelector<HTMLInputElement>(NAME)?.value).toBe("Capitals v2")
        expect(host.querySelector<HTMLTextAreaElement>(DESCRIPTION)?.value).toBe("Second pass")
        logged.mockRestore()
    })

    it("Cancel restores the saved name and description", async () => {
        serveRun()
        await mount()
        await openEditor()
        await typeInto(NAME, "Something else")
        await act(async () => buttonNamed("Cancel")?.click())
        expect(host.querySelector(NAME)).toBeNull()
        expect(host.textContent).toContain("Capitals check")
        await openEditor()
        expect(host.querySelector<HTMLInputElement>(NAME)?.value).toBe("Capitals check")
        expect(http.patch).not.toHaveBeenCalled()
    })

    it("Save stays disabled until the run has refreshed, so a slow refresh allows no second PATCH", async () => {
        serveRun()
        await mount()
        await openEditor()
        await typeInto(NAME, "Capitals v2")
        // From now on the run read is slow: the refresh after the save waits on the gate.
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => (release = resolve))
        const query = http.post.getMockImplementation()
        http.post.mockImplementation(async (...args: [string, ...unknown[]]) => {
            if (String(args[0]).endsWith("/evaluations/runs/query")) await gate
            return query?.(...args)
        })
        await act(async () => buttonNamed("Save")?.click())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
        expect(http.patch).toHaveBeenCalledTimes(1)
        const save = buttonNamed("Save") as HTMLButtonElement | undefined
        await act(async () => save?.click())
        expect(http.patch).toHaveBeenCalledTimes(1)
        release()
        await flush()
        expect(host.querySelector(NAME)).toBeNull()
    })

    it("A closed run has no Edit button", async () => {
        serveRun({flags: {is_live: false, is_active: false, is_closed: true}})
        await mount()
        expect(host.textContent).toContain("Capitals check")
        expect(buttonNamed("Edit")).toBeUndefined()
    })

    it("A reader without edit rights sees no Edit button", async () => {
        permission.allowed = false
        serveRun()
        await mount()
        expect(host.textContent).toContain("Capitals check")
        expect(buttonNamed("Edit")).toBeUndefined()
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
