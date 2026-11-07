// @vitest-environment jsdom
import {createElement, type ReactNode} from "react"

import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EvaluationsScreen} from "@/features/evaluations/list/EvaluationsScreen"
import {workspaceMembersListAtom} from "@/features/members/workspaceMembersListAtom"

import {page} from "./evaluationRunsFixtures"

const http = vi.hoisted(() => ({post: vi.fn(), delete: vi.fn()}))
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
const env = vi.hoisted(() => ({
    permissions: {} as Record<string, boolean>,
    query: {} as Record<string, string | undefined>,
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), projectIdAtom: atom("pr")}
})
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: env.query,
        pathname: "/evaluations",
        replace: vi.fn(),
        push: vi.fn(),
    }),
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => env.permissions[action] ?? false,
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@agenta/entities/testset", async (original) => {
    const {atom} = await import("jotai")
    const testset = atom({name: "Capitals"})
    return {...(await original<object>()), testsetMolecule: {selectors: {data: () => testset}}}
})
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const exact = atom({data: {name: "Exact Match"}, isPending: false})
    const none = atom({data: null, isPending: false})
    const variants = atom([])
    return {
        ...(await original<object>()),
        appWorkflowsListQueryStateAtom: atom({
            data: [{id: "app-1", name: "Capital finder", slug: "capital-finder"}],
            isPending: false,
            isError: false,
        }),
        workflowVariantsListDataAtomFamily: () => variants,
        workflowArtifactQueryAtomFamily: (id: string) => (id === "ev-exact" ? exact : none),
        workflowQueryAtomFamily: () => none,
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const SUCCESS = "attributes.ag.data.outputs.success"
const COST = "attributes.ag.metrics.costs.cumulative.total"

/** An auto run on a test set and an app, with one evaluator. */
const run = (id: string, name = `Run ${id}`): EvaluationRun =>
    ({
        id,
        name,
        status: "success",
        flags: {is_live: false},
        created_at: "2026-03-04T10:15:00Z",
        created_by_id: "user-1",
        data: {
            steps: [
                {
                    key: "testset-step",
                    type: "input",
                    origin: "auto",
                    references: {testset: {id: "ts-1"}},
                },
                {
                    key: "application-step",
                    type: "invocation",
                    origin: "auto",
                    references: {application: {id: "app-1"}},
                },
                {
                    key: "evaluator-exact",
                    type: "annotation",
                    origin: "auto",
                    references: {evaluator: {id: "ev-exact", slug: "exact-match"}},
                },
            ],
            mappings: [
                {
                    column: {kind: "annotation", name: "success"},
                    step: {key: "evaluator-exact", path: SUCCESS},
                },
            ],
        },
    }) as EvaluationRun

const metricsOf = (runId: string) => ({
    id: `metric-${runId}`,
    run_id: runId,
    scenario_id: null,
    timestamp: null,
    data: {
        "application-step": {[COST]: {type: "numeric/continuous", count: 4, mean: 0.0025}},
        "evaluator-exact": {
            [SUCCESS]: {
                type: "binary",
                count: 4,
                frequency: [
                    {value: true, count: 3},
                    {value: false, count: 1},
                ],
            },
        },
    },
})

/** The server: `runs` answers the list; the metrics answer for any run asked. */
let serverRuns: EvaluationRun[] = []
const route = () =>
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith("/evaluations/runs/query")) return page(serverRuns)
        if (url.endsWith("/evaluations/metrics/query")) {
            const ids = (body.metrics as {run_ids: string[]}).run_ids
            return {data: {count: ids.length, metrics: ids.map(metricsOf)}}
        }
        return {data: {}}
    })

const callsTo = (path: string) => http.post.mock.calls.filter(([url]) => String(url).endsWith(path))

// The batch fetchers wait about one frame (80 ms) before they send, so settle in real time.
const settle = async () => {
    for (let turn = 0; turn < 8; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
        })
    }
}

const mount = async () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    getDefaultStore().set(queryClientAtom, client)
    render(
        createElement(
            QueryClientProvider,
            {client},
            createElement(EvaluationsScreen, {workspaceId: "ws", projectId: "pr"}),
        ),
    )
    await settle()
    getDefaultStore().set(workspaceMembersListAtom, [
        {
            user: {
                id: "user-1",
                username: "alex",
                email: "alex@example.com",
                status: "member",
                created_at: "2026-01-01T00:00:00Z",
            },
            roles: [],
        },
    ])
}

const select = (name: string) => fireEvent.click(screen.getByRole("checkbox", {name}))
const bulkBar = () => screen.getByRole("status")
const confirmDialog = () => screen.getByRole("alertdialog")
const confirmDelete = () =>
    act(async () => {
        fireEvent.click(within(confirmDialog()).getByRole("button", {name: "Delete"}))
    })

/** The CSV text the last export saved. */
const savedCsv = async () => {
    const calls = vi.mocked(URL.createObjectURL).mock.calls
    const blob = calls[calls.length - 1][0] as Blob
    const text = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blob)
    })
    return text.replace(/^\uFEFF/, "")
}

const exportCsv = async () => {
    await act(async () => {
        fireEvent.click(screen.getByRole("button", {name: "Export CSV"}))
    })
    await settle()
}

beforeEach(() => {
    http.post.mockReset()
    http.delete.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    env.permissions = {edit_evaluation_runs: true, view_api_keys: true, edit_api_keys: true}
    env.query = {kind: "auto"}
    serverRuns = [run("a", "Alpha"), run("b", "Beta"), run("c", "Gamma")]
    route()
    URL.createObjectURL = vi.fn(() => "blob:runs")
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    window.localStorage.clear()
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe("bulk delete", () => {
    it("Deleting two selected runs sends one DELETE with both ids after one confirm, then reloads the list", async () => {
        http.delete.mockResolvedValue({data: {run_ids: ["a", "b"]}})
        await mount()
        select("Select Alpha")
        select("Select Beta")
        expect(bulkBar().textContent).toContain("2 selected")
        fireEvent.click(within(bulkBar()).getByRole("button", {name: "Delete"}))
        expect(http.delete).not.toHaveBeenCalled()
        const dialog = confirmDialog().textContent
        expect(dialog).toContain("The selected 2 evaluations will be permanently deleted.")
        expect(dialog).toContain("• Alpha")
        expect(dialog).toContain("• Beta")
        expect(dialog).not.toContain("Gamma")

        serverRuns = [run("c", "Gamma")]
        const listCalls = callsTo("/evaluations/runs/query").length
        await confirmDelete()
        await settle()

        expect(http.delete).toHaveBeenCalledTimes(1)
        expect(http.delete).toHaveBeenCalledWith("https://api.test/evaluations/runs/", {
            params: {project_id: "pr"},
            data: {run_ids: ["a", "b"]},
        })
        expect(toast.success).toHaveBeenCalledWith("Deleted successfully")
        expect(callsTo("/evaluations/runs/query").length).toBeGreaterThan(listCalls)
        expect(screen.queryByText("Alpha")).toBeNull()
        expect(screen.getByText("Gamma")).toBeTruthy()
        expect(screen.queryByRole("status")).toBeNull()
    })

    it("A second Delete press while the delete runs sends nothing more", async () => {
        let finish: (value: unknown) => void = () => undefined
        http.delete.mockReturnValue(new Promise((resolve) => (finish = resolve)))
        await mount()
        select("Select Alpha")
        select("Select Beta")
        fireEvent.click(within(bulkBar()).getByRole("button", {name: "Delete"}))
        const confirm = within(confirmDialog()).getByRole("button", {name: "Delete"})
        await act(async () => fireEvent.click(confirm))
        await act(async () => fireEvent.click(confirm))
        expect(http.delete).toHaveBeenCalledTimes(1)
        await act(async () => finish({data: {run_ids: ["a", "b"]}}))
        await settle()
        expect(http.delete).toHaveBeenCalledTimes(1)
    })

    it("A failed delete keeps the confirm open with the error, and keeps the runs and the selection", async () => {
        http.delete.mockRejectedValue(new Error("boom"))
        await mount()
        select("Select Alpha")
        select("Select Beta")
        fireEvent.click(within(bulkBar()).getByRole("button", {name: "Delete"}))
        await confirmDelete()
        await settle()
        expect(confirmDialog().textContent).toContain("Failed to delete evaluations")
        expect(toast.success).not.toHaveBeenCalled()
        // The open dialog hides the page from the accessibility tree; the page is still there.
        expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0)
        expect(screen.getByRole("status", {hidden: true}).textContent).toContain("2 selected")
    })

    it("A selected run that leaves the list no longer counts as selected", async () => {
        await mount()
        select("Select Alpha")
        select("Select Beta")
        serverRuns = [run("b", "Beta"), run("c", "Gamma")]
        await act(async () => {
            await getDefaultStore().get(queryClientAtom).invalidateQueries()
        })
        await settle()
        expect(bulkBar().textContent).toContain("1 selected")
    })

    it("A reader without edit rights can select runs to export but gets no Delete", async () => {
        env.permissions = {view_api_keys: true, edit_api_keys: true}
        await mount()
        select("Select Alpha")
        expect(within(bulkBar()).queryByRole("button", {name: "Delete"})).toBeNull()
        expect(screen.getByRole("button", {name: "Export CSV"})).toBeTruthy()
    })

    it("A reader who may neither delete nor export gets no checkboxes and no Export CSV", async () => {
        env.permissions = {}
        await mount()
        expect(screen.queryByRole("checkbox", {name: "Select Alpha"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Export CSV"})).toBeNull()
    })
})

describe("CSV export", () => {
    const HEADER =
        "Status,Name,Test set,Application,Exact Match • Success," +
        "Invocation • Cost,Invocation • Duration,Invocation • Tokens,Invocation • Errors," +
        "Created on,Created by"
    const line = (name: string) =>
        // "true": the most frequent value, what the old export writes for a true/false metric.
        `success,${name},Capitals,Capital finder,true,$0.0025,—,—,—,2026-03-04T10:15:00.000Z,alex`

    it("With nothing selected, Export CSV saves every run with the columns on screen", async () => {
        await mount()
        await exportCsv()
        expect(await savedCsv()).toBe(
            [HEADER, line("Alpha"), line("Beta"), line("Gamma")].join("\n"),
        )
    })

    it("With runs selected, Export CSV saves only those, with metrics fetched in one request", async () => {
        await mount()
        select("Select Gamma")
        select("Select Alpha")
        const before = callsTo("/evaluations/metrics/query").length
        await exportCsv()
        expect(await savedCsv()).toBe([HEADER, line("Alpha"), line("Gamma")].join("\n"))
        const calls = callsTo("/evaluations/metrics/query").slice(before)
        expect(calls).toHaveLength(1)
        expect(calls[0][1]).toEqual({metrics: {run_ids: ["a", "c"], scenario_ids: false}})
    })

    it("A column hidden in the column menu leaves the table and the export", async () => {
        await mount()
        await act(async () => {
            screen.getByRole("button", {name: "Columns"}).dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "ArrowDown",
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })
        await act(async () => {
            fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Tokens"}))
        })
        expect(
            screen.getAllByRole("columnheader", {hidden: true}).map((header) => header.textContent),
        ).not.toContain("Tokens")
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        await exportCsv()
        const [header] = (await savedCsv()).split("\n")
        expect(header).not.toContain("Tokens")
        expect(header).toContain("Invocation • Cost")
    })

    it("A run name that starts like a formula is saved as text", async () => {
        serverRuns = [run("a", "=HYPERLINK(1)")]
        await mount()
        await exportCsv()
        expect((await savedCsv()).split("\n")[1]).toContain(",'=HYPERLINK(1),")
    })

    it("A failed export says so and saves nothing", async () => {
        await mount()
        http.post.mockRejectedValue(new Error("boom"))
        await exportCsv()
        expect(toast.error).toHaveBeenCalledWith("Couldn't export the evaluations")
        expect(URL.createObjectURL).not.toHaveBeenCalled()
    })
})
