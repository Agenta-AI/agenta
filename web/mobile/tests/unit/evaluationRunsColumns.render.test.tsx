// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EvaluationsScreen} from "@/features/evaluations/list/EvaluationsScreen"

import {page} from "./evaluationRunsFixtures"

const http = vi.hoisted(() => ({post: vi.fn(), delete: vi.fn()}))
const queries = vi.hoisted(() => ({queryQueryRevisions: vi.fn()}))
const env = vi.hoisted(() => ({
    wide: true,
    query: {} as Record<string, string | undefined>,
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<object>()),
    getQueriesClient: () => queries,
}))
vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), projectIdAtom: atom("pr")}
})
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
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => false,
}))
vi.mock("@/features/observability/ObservabilityAppFilter", () => ({
    ObservabilityAppFilter: () => null,
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => env.wide}))
vi.mock("@agenta/entities/shared", async (original) => ({
    ...(await original<object>()),
    UserAuthorLabel: () => createElement("span", null, "Alex Kim"),
}))
vi.mock("@agenta/entities/testset", async (original) => {
    const {atom} = await import("jotai")
    const testset = atom({name: "Capitals"})
    return {...(await original<object>()), testsetMolecule: {selectors: {data: () => testset}}}
})
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const names: Record<string, string> = {"ev-exact": "Exact Match", "ev-score": "Correctness"}
    const variants = atom([{id: "variant-1", name: "verbose", slug: "a1b2c3"}])
    const artifacts = new Map<string, ReturnType<typeof atom>>()
    const revisions = new Map<string, ReturnType<typeof atom>>()
    const once = (cache: Map<string, ReturnType<typeof atom>>, id: string, value: unknown) => {
        if (!cache.has(id)) cache.set(id, atom(value))
        return cache.get(id)
    }
    return {
        ...(await original<object>()),
        appWorkflowsListQueryStateAtom: atom({
            data: [{id: "app-1", name: "Capital finder", slug: "capital-finder"}],
            isPending: false,
            isError: false,
        }),
        workflowVariantsListDataAtomFamily: () => variants,
        workflowArtifactQueryAtomFamily: (id: string) =>
            once(artifacts, id, {data: names[id] ? {name: names[id]} : null, isPending: false}),
        // The correctness evaluator types its comment as text.
        workflowQueryAtomFamily: (id: string) =>
            once(revisions, id, {
                data:
                    id === "ev-score-rev"
                        ? {data: {schemas: {outputs: {properties: {comment: {type: "string"}}}}}}
                        : null,
                isPending: false,
            }),
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const SUCCESS = "attributes.ag.data.outputs.success"
const SCORE = "attributes.ag.data.outputs.score"
const COST = "attributes.ag.metrics.costs.cumulative.total"
const DURATION = "attributes.ag.metrics.duration.cumulative"

/** An auto run on test set revision v3 and app revision v5, with two evaluators. */
const autoRun = (id: string): EvaluationRun =>
    ({
        id,
        name: `Run ${id}`,
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
                    references: {
                        testset: {id: "ts-1"},
                        testset_revision: {id: "ts-rev-3", version: 3},
                    },
                },
                {
                    key: "application-step",
                    type: "invocation",
                    origin: "auto",
                    references: {
                        application: {id: "app-1"},
                        application_variant: {id: "variant-1"},
                        application_revision: {id: "app-rev-5", version: 5},
                    },
                },
                {
                    key: "evaluator-exact",
                    type: "annotation",
                    origin: "auto",
                    references: {evaluator: {id: "ev-exact", slug: "exact-match"}},
                },
                {
                    key: "evaluator-score",
                    type: "annotation",
                    origin: "auto",
                    references: {
                        evaluator: {id: "ev-score", slug: "correctness"},
                        evaluator_revision: {id: "ev-score-rev"},
                    },
                },
            ],
            mappings: [
                {
                    column: {kind: "annotation", name: "success"},
                    step: {key: "evaluator-exact", path: SUCCESS},
                },
                {
                    column: {kind: "annotation", name: "score"},
                    step: {key: "evaluator-score", path: SCORE},
                },
                {
                    column: {kind: "annotation", name: "comment"},
                    step: {key: "evaluator-score", path: "attributes.ag.data.outputs.comment"},
                },
            ],
        },
    }) as EvaluationRun

const liveRun = (id: string): EvaluationRun =>
    ({
        id,
        name: `Live ${id}`,
        status: "running",
        flags: {is_live: true, is_active: true},
        created_at: "2026-03-04T10:15:00Z",
        created_by_id: "user-1",
        data: {
            steps: [
                {
                    key: "query-step",
                    type: "input",
                    origin: "custom",
                    references: {query: {id: "q-1"}, query_revision: {id: "q-rev-1", version: 1}},
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
        "application-step": {
            [COST]: {type: "numeric/continuous", count: 10, sum: 0.0123, mean: 0.00123},
            [DURATION]: {type: "numeric/continuous", count: 10, mean: 522.3},
        },
        "evaluator-exact": {
            [SUCCESS]: {
                type: "binary",
                count: 10,
                frequency: [
                    {value: true, count: 7},
                    {value: false, count: 3},
                ],
            },
        },
        "evaluator-score": {[SCORE]: {type: "numeric/continuous", count: 10, mean: 0.85}},
    },
})

const route = (runs: EvaluationRun[]) =>
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith("/evaluations/runs/query")) return page(runs)
        if (url.endsWith("/evaluations/metrics/query")) {
            const ids = (body.metrics as {run_ids: string[]}).run_ids
            return {data: {count: ids.length, metrics: ids.map(metricsOf)}}
        }
        return {data: {}}
    })

let host: HTMLDivElement
let root: Root

// The batch fetchers wait about one frame (80 ms) before they send, so settle in real time.
const settle = async () => {
    for (let turn = 0; turn < 8; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
        })
    }
}

const mount = async () => {
    // One client for the hooks and the entity atoms, as in the app.
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    getDefaultStore().set(queryClientAtom, client)
    await act(async () =>
        root.render(
            createElement(
                QueryClientProvider,
                {client},
                createElement(EvaluationsScreen, {workspaceId: "ws", projectId: "pr"}),
            ),
        ),
    )
    await settle()
}

// The select-all checkbox has a header cell of its own, with no name.
const headers = () =>
    [...host.querySelectorAll("[role=columnheader]")]
        .filter((header) => !header.querySelector("[role=checkbox]"))
        .map((header) => header.textContent)
const text = () => host.textContent ?? ""
const callsTo = (path: string) => http.post.mock.calls.filter(([url]) => String(url).endsWith(path))

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    http.post.mockReset()
    queries.queryQueryRevisions.mockReset()
    queries.queryQueryRevisions.mockResolvedValue({
        query_revisions: [
            {
                id: "q-rev-1",
                version: "1",
                data: {
                    filtering: {
                        operator: "and",
                        conditions: [{field: "trace_type", operator: "is", value: "invocation"}],
                    },
                },
            },
        ],
    })
    env.wide = true
    env.query = {}
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("evaluation runs list columns", () => {
    it("The Auto tab shows the test set, the app, one column per evaluator metric, cost and duration", async () => {
        env.query = {kind: "auto"}
        route([autoRun("a")])
        await mount()
        expect(headers()).toEqual([
            "Status",
            "Name",
            "Test set",
            "Application",
            "Correctness · Score",
            "Exact Match · Success",
            "Cost",
            "Duration",
            "Tokens",
            "Errors",
            "Created on",
            "Created by",
            "Actions",
        ])
    })

    it("A metric the evaluator types as text gets no column", async () => {
        env.query = {kind: "auto"}
        route([autoRun("a")])
        await mount()
        expect(headers()).not.toContain("Correctness · Comment")
    })

    it("A metric cell shows the same text as the old list", async () => {
        env.query = {kind: "auto"}
        route([autoRun("a")])
        await mount()
        expect(text()).toContain("0.85")
        expect(text()).toContain("70.0%")
        expect(text()).toContain("$0.0012")
        expect(text()).toContain("522ms")
    })

    it("The metrics of every row on screen come in one request", async () => {
        env.query = {kind: "auto"}
        route([autoRun("a"), autoRun("b"), autoRun("c")])
        await mount()
        const calls = callsTo("/evaluations/metrics/query")
        expect(calls).toHaveLength(1)
        expect((calls[0][1] as {metrics: {run_ids: string[]}}).metrics.run_ids).toEqual([
            "a",
            "b",
            "c",
        ])
    })

    it("The test set shows its revision and the app its variant and revision", async () => {
        env.query = {kind: "auto"}
        route([autoRun("a")])
        await mount()
        expect(text()).toContain("Capitalsv3")
        expect(text()).toContain("Capital finderverbosev5")
    })

    it("The Live tab shows the query a run watches instead of the test set and app", async () => {
        env.query = {kind: "online"}
        route([liveRun("l")])
        await mount()
        expect(headers()).toContain("Query")
        expect(headers()).not.toContain("Test set")
        expect(headers()).not.toContain("Application")
        expect(headers()).not.toContain("Kind")
        expect(text()).toContain("Trace Type is invocation")
        expect(queries.queryQueryRevisions).toHaveBeenCalledTimes(1)
        expect(queries.queryQueryRevisions).toHaveBeenCalledWith(
            {query_revision_refs: [{id: "q-rev-1"}], include_archived: true},
            {queryParams: {project_id: "pr"}},
        )
    })

    it("The All tab adds the Kind column and the references of every run", async () => {
        route([autoRun("a"), liveRun("l")])
        await mount()
        const all = headers()
        expect(all.slice(0, 6)).toEqual([
            "Status",
            "Name",
            "Kind",
            "Test set",
            "Query",
            "Application",
        ])
    })

    it("Phones keep status, name and the menu, and load no metrics", async () => {
        env.wide = false
        env.query = {kind: "auto"}
        route([autoRun("a")])
        await mount()
        expect(headers()).toEqual(["Status", "Name", "Actions"])
        expect(callsTo("/evaluations/metrics/query")).toHaveLength(0)
    })
})
