// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {activeUserIdAtom, projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only the HTTP layer and the Fern edit call are fake: the run query, the edit request and its
// body builder, and the candidate rule are the real package code.
const fern = vi.hoisted(() => ({editSimpleEvaluation: vi.fn()}))
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<typeof import("@agenta/sdk/resources")>()),
    getEvaluationsClient: () => fern,
}))
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

const router = vi.hoisted(() => ({query: {} as Record<string, string>}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        asPath: "/w/ws/p/pr/evaluations/results/run",
        replace: vi.fn(),
        push: vi.fn(),
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

import EvaluationRunPage from "@/pages/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let runCounter = 0

const STEPS = [
    {
        key: "ts",
        type: "input",
        origin: "custom",
        references: {testset: {id: "ts-1"}, testset_revision: {id: "tsr-1", version: 3}},
    },
    {
        key: "app",
        type: "invocation",
        origin: "auto",
        references: {application: {id: "app-1"}, application_revision: {id: "rev-1"}},
    },
    {
        key: "ev",
        type: "annotation",
        origin: "auto",
        references: {evaluator: {id: "ev-1"}, evaluator_revision: {id: "evr-1"}},
    },
]

interface RunSpec {
    status?: string
    live?: boolean
    description?: string | null
    steps?: unknown[]
}

const makeRun = (id: string, name: string, spec: RunSpec = {}) => ({
    id,
    name,
    description: spec.description ?? null,
    status: spec.status ?? "success",
    created_at: "2026-11-05T19:33:17Z",
    flags: {is_live: Boolean(spec.live), is_active: Boolean(spec.live), is_closed: false},
    data: {steps: spec.steps ?? STEPS},
})

/**
 * Serve one run by id, and the project's runs for the Compare list. An edit renames the run, so
 * the reload after a save returns the new name.
 */
function serveRun(spec: RunSpec = {}, others: ReturnType<typeof makeRun>[] = []) {
    const id = `header-run-${++runCounter}`
    let run = makeRun(id, "Capitals check", spec)
    http.post.mockImplementation(async (url: string, body: {run?: {ids?: string[]}}) => {
        if (url.endsWith("/evaluations/runs/query")) {
            if (body?.run?.ids) return {data: {count: 1, runs: [run]}}
            const runs = [run, ...others]
            return {data: {count: runs.length, runs, windowing: {next: null}}}
        }
        if (url.endsWith("/evaluations/metrics/query")) return {data: {count: 0, metrics: []}}
        throw new Error(`unexpected request ${url}`)
    })
    fern.editSimpleEvaluation.mockImplementation(
        async (request: {
            evaluation_id: string
            evaluation: {name: string; description: string}
        }) => {
            if (request.evaluation_id !== id) throw new Error(`unexpected ${request.evaluation_id}`)
            run = {...run, ...request.evaluation}
            return {evaluation: {id}}
        },
    )
    router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: id}
    return id
}

/** The package batches run and metric requests for about 80 ms before it sends them. */
const flush = () =>
    act(async () => {
        for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 100))
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
}

const button = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.textContent?.trim() === name,
    )

const openRunMenu = async () => {
    const trigger = host.querySelector("[aria-label='Run actions']")
    await act(async () => {
        trigger?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
        )
    })
}

const clickMenuItem = async (label: string) => {
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
        (element) => element.textContent?.trim() === label,
    )
    expect(item, label).toBeDefined()
    await act(async () => item?.click())
}

const typeInto = async (field: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    const proto =
        field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    await act(async () => {
        setter?.call(field, text)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const openEditDialog = async () => {
    await openRunMenu()
    await clickMenuItem("Edit evaluation")
    const name = document.querySelector<HTMLInputElement>("#edit-evaluation-name")
    const description = document.querySelector<HTMLTextAreaElement>("#edit-evaluation-description")
    expect(name).not.toBeNull()
    expect(description).not.toBeNull()
    return {name: name as HTMLInputElement, description: description as HTMLTextAreaElement}
}

beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "evaluations")
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(activeUserIdAtom, "user-1")
    store.set(projectIdAtom, "pr")
    Object.values(http).forEach((fn) => fn.mockReset())
    fern.editSimpleEvaluation.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    permission.allowed = true
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllEnvs()
})

describe("run header: edit evaluation", () => {
    it("Update sends the new name and description with the run's steps, then shows the new name", async () => {
        const id = serveRun({description: "First pass"})
        await mount()
        expect(host.querySelector("h1")?.textContent).toBe("Capitals check")

        const fields = await openEditDialog()
        expect(fields.name.value).toBe("Capitals check")
        expect(fields.description.value).toBe("First pass")
        expect(button("Update")?.disabled).toBe(true)

        await typeInto(fields.name, "  Capitals, second pass  ")
        await typeInto(fields.description, "With the new prompt")
        await act(async () => button("Update")?.click())
        await flush()

        expect(fern.editSimpleEvaluation).toHaveBeenCalledTimes(1)
        expect(fern.editSimpleEvaluation).toHaveBeenCalledWith(
            {
                evaluation_id: id,
                evaluation: {
                    id,
                    name: "Capitals, second pass",
                    description: "With the new prompt",
                    data: {
                        testset_steps: {"tsr-1": "custom"},
                        application_steps: {"rev-1": "auto"},
                        evaluator_steps: {"evr-1": "auto"},
                    },
                },
            },
            {queryParams: {project_id: "pr"}},
        )
        expect(http.patch).not.toHaveBeenCalled()
        expect(toast.success).toHaveBeenCalledWith("Evaluation updated")
        expect(document.querySelector("#edit-evaluation-name")).toBeNull()
        expect(host.querySelector("h1")?.textContent).toBe("Capitals, second pass")
    })

    it("A failed save keeps the dialog open with the draft and says so", async () => {
        serveRun()
        await mount()
        fern.editSimpleEvaluation.mockRejectedValue(new Error("Request failed"))

        const fields = await openEditDialog()
        await typeInto(fields.name, "Renamed")
        await act(async () => button("Update")?.click())
        await flush()

        expect(toast.error).toHaveBeenCalledWith("Failed to update evaluation. Please try again.")
        expect(document.querySelector<HTMLInputElement>("#edit-evaluation-name")?.value).toBe(
            "Renamed",
        )
        expect(host.querySelector("h1")?.textContent).toBe("Capitals check")
    })

    it("A blank name cannot be saved", async () => {
        serveRun()
        await mount()
        const fields = await openEditDialog()
        await typeInto(fields.name, "   ")
        expect(button("Update")?.disabled).toBe(true)
    })

    it("A live run and a reader without edit rights get no run menu", async () => {
        serveRun({live: true, status: "running"})
        await mount()
        expect(host.querySelector("h1")?.textContent).toBe("Capitals check")
        expect(host.querySelector("[aria-label='Run actions']")).toBeNull()

        permission.allowed = false
        serveRun()
        await mount()
        expect(host.querySelector("h1")?.textContent).toBe("Capitals check")
        expect(host.querySelector("[aria-label='Run actions']")).toBeNull()
    })
})

describe("run header: chips and Compare", () => {
    it("Shows the run as the pinned chip next to Evaluations:", async () => {
        serveRun()
        await mount()
        expect(host.textContent).toContain("Evaluations:")
        expect(host.querySelector('[data-testid="run-chip"]')?.textContent).toBe("Capitals check")
    })

    it("A run that has not finished shows Compare disabled", async () => {
        serveRun({status: "running"})
        await mount()
        expect(button("Compare")?.disabled).toBe(true)
        // The focusable wrapper names the action and why it is off, for keyboard and screen readers.
        const wrapper = host.querySelector('[role="button"][aria-disabled="true"]')
        expect(wrapper?.getAttribute("aria-label")).toBe(
            "Compare. Comparison is only available for completed evaluation runs.",
        )
    })

    it("A finished run lists the runs that share its test set and evaluator", async () => {
        const id = serveRun({}, [
            makeRun("run-same", "Capitals: verbose", {description: "Longer prompt"}),
            makeRun("run-other-set", "Support tickets", {
                steps: [{key: "ts", type: "input", references: {testset: {id: "ts-9"}}}, STEPS[2]],
            }),
            makeRun("run-running", "Capitals: in progress", {status: "running"}),
        ])
        await mount()
        const compare = button("Compare")
        expect(compare?.disabled).toBe(false)
        // The list is read only once the picker opens.
        const listReads = () =>
            http.post.mock.calls.filter(
                ([url, body]) => String(url).endsWith("/evaluations/runs/query") && !body?.run?.ids,
            ).length
        expect(listReads()).toBe(0)

        await act(async () => compare?.click())
        await flush()

        expect(listReads()).toBe(1)
        const rows = [...document.querySelectorAll<HTMLAnchorElement>("li a")]
        expect(rows.map((row) => row.getAttribute("href"))).toEqual([
            "/w/ws/p/pr/evaluations/results/run-same",
        ])
        expect(rows[0].textContent).toContain("Capitals: verbose")
        expect(rows[0].textContent).toContain("Longer prompt")
        expect(document.body.textContent).not.toContain(`results/${id}`)
    })

    it("A finished run with nothing to compare shows the old app's empty message", async () => {
        serveRun()
        await mount()
        await act(async () => button("Compare")?.click())
        await flush()
        expect(document.body.textContent).toContain("No evaluations to compare")
    })
})
