// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {activeUserIdAtom, projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only HTTP, the router and the toast are fake: the run, metric and scenario reads, the compare
// rules and the compared views are the real code.
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
        push: vi.fn(),
        back: vi.fn(),
    }),
}))
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn(), info: vi.fn()}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
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
// Counts the loads of the compared overview's module, which keeps its real code.
const compareModule = vi.hoisted(() => ({loads: 0}))
vi.mock("@/features/evaluation-run/compare/overview/CompareOverviewTab", async (original) => {
    compareModule.loads += 1
    return original()
})

import EvaluationRunPage from "@/pages/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const SUCCESS = "attributes.ag.data.outputs.success"
const DURATION = "attributes.ag.metrics.duration.cumulative"

const STEPS = [
    {key: "ts", type: "input", references: {testset: {id: "ts-1", slug: "capitals"}}},
    {key: "app", type: "invocation", references: {application: {id: "app-1", slug: "geo-bot"}}},
    {
        key: "ev",
        type: "annotation",
        origin: "auto",
        references: {evaluator: {id: "ev-1", slug: "exact-match"}},
    },
]
const MAPPINGS = [
    {column: {kind: "testset", name: "country"}, step: {key: "ts", path: "data.country"}},
    {column: {kind: "annotation", name: "success"}, step: {key: "ev", path: SUCCESS}},
]
const COUNTRIES: Record<string, string> = {"tc-1": "France", "tc-2": "Japan", "tc-3": "Peru"}

interface Scenario {
    id: string
    testcase: string
    success: boolean
}
interface ServedRun {
    id: string
    name: string
    status: string
    durationMs: number
    scenarios: Scenario[]
}

let counter = 0
let runs: ServedRun[] = []

/** A run on the same test set, app and evaluator; ids are new in each test (the caches keep runs). */
function addRun(name: string, spec: Partial<Omit<ServedRun, "id" | "name">> = {}): string {
    const id = `run-${++counter}`
    const scenarios = (spec.scenarios ?? []).map((scenario) => ({
        ...scenario,
        id: `${id}-${scenario.id}`,
    }))
    runs.push({id, name, status: "success", durationMs: 500, ...spec, scenarios})
    return id
}

const runBody = (run: ServedRun) => ({
    id: run.id,
    name: run.name,
    description: null,
    status: run.status,
    created_at: "2026-11-05T19:33:17Z",
    flags: {is_live: false, is_active: false, is_closed: false},
    data: {steps: STEPS, mappings: MAPPINGS},
})

const binary = (values: boolean[]) => ({
    type: "binary",
    count: values.length,
    freq: [
        {value: true, count: values.filter(Boolean).length},
        {value: false, count: values.filter((value) => !value).length},
    ],
})

const scenarioOf = (id: string) =>
    runs.flatMap((run) => run.scenarios.map((s) => ({run, s}))).find(({s}) => s.id === id)

/** The fields of the request bodies this server reads. */
interface RequestBody {
    run?: {ids?: string[]}
    metrics?: {run_ids?: string[]; scenario_ids?: string[] | false}
    scenario?: {run_ids?: string[]}
    result?: {scenario_ids?: string[]}
    testcase_ids?: string[]
}

function answer(url: string, body: RequestBody | undefined) {
    if (url.endsWith("/evaluations/runs/query")) {
        const ids: string[] | undefined = body?.run?.ids
        const found = ids ? runs.filter((run) => ids.includes(run.id)) : runs
        return {data: {count: found.length, runs: found.map(runBody), windowing: {next: null}}}
    }
    if (url.endsWith("/evaluations/metrics/query")) {
        if (body?.metrics?.scenario_ids === false) {
            const ids = body.metrics.run_ids ?? []
            const metrics = runs
                .filter((run) => ids.includes(run.id))
                .map((run) => ({
                    id: `m-${run.id}`,
                    run_id: run.id,
                    scenario_id: null,
                    data: {
                        ev: {[SUCCESS]: binary(run.scenarios.map((s) => s.success))},
                        app: {
                            [DURATION]: {
                                type: "numeric/continuous",
                                count: 1,
                                mean: run.durationMs,
                            },
                        },
                    },
                }))
            return {data: {count: metrics.length, metrics}}
        }
        const scenarioIds = body?.metrics?.scenario_ids
        const ids = Array.isArray(scenarioIds) ? scenarioIds : []
        const metrics = ids.flatMap((id) => {
            const found = scenarioOf(id)
            return found
                ? [
                      {
                          id: `m-${id}`,
                          run_id: found.run.id,
                          scenario_id: id,
                          data: {ev: {[SUCCESS]: binary([found.s.success])}},
                      },
                  ]
                : []
        })
        return {data: {count: metrics.length, metrics}}
    }
    if (url.endsWith("/evaluations/scenarios/query")) {
        const run = runs.find((candidate) => candidate.id === body?.scenario?.run_ids?.[0])
        const scenarios = (run?.scenarios ?? []).map((s) => ({
            id: s.id,
            run_id: run?.id,
            status: "success",
            testcase_id: s.testcase,
        }))
        return {data: {count: scenarios.length, scenarios, windowing: {next: null}}}
    }
    if (url.endsWith("/evaluations/results/query")) {
        const ids = body?.result?.scenario_ids ?? []
        const results = ids.flatMap((id) => {
            const found = scenarioOf(id)
            return found
                ? [
                      {
                          id: `r-${id}`,
                          run_id: found.run.id,
                          scenario_id: id,
                          step_key: "ts",
                          status: "success",
                          testcase_id: found.s.testcase,
                      },
                  ]
                : []
        })
        return {data: {count: results.length, results}}
    }
    if (url.endsWith("/testcases/query")) {
        const ids = body?.testcase_ids ?? []
        return {
            data: {
                count: ids.length,
                testcases: ids.map((id) => ({id, data: {country: COUNTRIES[id]}})),
            },
        }
    }
    return {data: {count: 0}}
}

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root

/** The package batches run and metric reads for about 80 ms before it sends them. */
const flush = () =>
    act(async () => {
        for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    })

/** Waits until `ready` holds: the first load of a lazy view compiles it, which takes seconds. */
async function until(ready: () => boolean, label: string) {
    for (let i = 0; i < 150 && !ready(); i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
    }
    expect(ready(), label).toBe(true)
}

async function open(baseId: string, query: Record<string, string> = {}) {
    router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: baseId, ...query}
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

const buttonNamed = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.textContent?.trim() === name,
    )
const chips = () =>
    [...host.querySelectorAll('[data-testid="compare-chip"]')].map((chip) => chip.textContent)
const lastReplace = () => router.replace.mock.calls.at(-1)?.[0]
const runLevelMetricReads = () =>
    http.post.mock.calls.filter(
        ([url, body]) =>
            String(url).endsWith("/evaluations/metrics/query") &&
            body?.metrics?.scenario_ids === false,
    )

beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "evaluations")
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(activeUserIdAtom, "user-1")
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    runs = []
    Object.values(http).forEach((fn) => fn.mockReset())
    http.post.mockImplementation(async (url: string, body: RequestBody) => answer(url, body))
    http.get.mockResolvedValue({data: {}})
    router.replace.mockReset()
    toast.info.mockReset()
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe("compare picker", () => {
    it("Checking a run adds it to ?compare= and keeps the other query values", async () => {
        const base = addRun("Capitals: default")
        const verbose = addRun("Capitals: verbose")
        await open(base, {view: "overview"})

        await act(async () => buttonNamed("Compare")?.click())
        await until(
            () => Boolean(document.querySelector('[aria-label="Capitals: verbose"]')),
            "picker listed",
        )
        expect(document.body.textContent).toContain("Selected: 0/4")
        const checkbox = document.querySelector<HTMLButtonElement>(
            '[role="checkbox"][aria-label="Capitals: verbose"]',
        )
        await act(async () => checkbox?.click())

        expect(lastReplace()).toEqual({
            pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
            query: {
                workspace_id: "ws",
                project_id: "pr",
                evaluation_id: base,
                view: "overview",
                compare: verbose,
            },
        })
    })

    it("Search and the status filters narrow the list, with a count per filter", async () => {
        const base = addRun("Capitals: default")
        addRun("Capitals: verbose")
        addRun("Capitals: short", {status: "evaluation_finished_with_errors"})
        addRun("Support tickets", {status: "failure"})
        await open(base)
        await act(async () => buttonNamed("Compare")?.click())
        await until(
            () => Boolean(document.querySelector('[aria-label="Support tickets"]')),
            "picker listed",
        )

        const names = () =>
            [...document.querySelectorAll('[role="checkbox"]')].map((box) =>
                box.getAttribute("aria-label"),
            )
        expect(names()).toEqual(["Capitals: verbose", "Capitals: short", "Support tickets"])
        expect(buttonNamed("Errors (2)")).toBeDefined()

        await act(async () => buttonNamed("Errors (2)")?.click())
        expect(names()).toEqual(["Capitals: short", "Support tickets"])

        const search = document.querySelector<HTMLInputElement>('[aria-label="Search evaluations"]')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        await act(async () => {
            setter?.call(search, "CAPITALS")
            search?.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(names()).toEqual(["Capitals: short"])

        await act(async () => buttonNamed("Running (0)")?.click())
        expect(document.body.textContent).toContain("No matching evaluations")
    })

    it("A fifth run is not added and a message says why", async () => {
        const base = addRun("Capitals: default")
        const others = ["one", "two", "three", "four", "five"].map((n) => addRun(`Capitals: ${n}`))
        await open(base, {compare: others.slice(0, 4).join(",")})
        await until(() => Boolean(buttonNamed("Compare (4)")), "four runs compared")

        await act(async () => buttonNamed("Compare (4)")?.click())
        await until(
            () => Boolean(document.querySelector('[aria-label="Capitals: five"]')),
            "picker listed",
        )
        expect(document.body.textContent).toContain("Selected: 4/4")
        await act(async () =>
            document
                .querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="Capitals: five"]')
                ?.click(),
        )
        expect(router.replace).not.toHaveBeenCalled()
        expect(toast.info).toHaveBeenCalledWith("You can compare up to 4 runs at a time.")
    })
})

describe("compare chips", () => {
    it("Shows each compared run as a chip, and removing one takes it out of ?compare=", async () => {
        const base = addRun("Capitals: default")
        const verbose = addRun("Capitals: verbose")
        const short = addRun("Capitals: short")
        await open(base, {compare: `${verbose},${short}`})
        await until(() => !chips().includes("Loading…"), "compared runs loaded")

        expect(chips()).toEqual(["Capitals: verbose", "Capitals: short"])
        expect(buttonNamed("Compare (2)")).toBeDefined()

        await act(async () =>
            host
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Remove Capitals: verbose from the comparison"]',
                )
                ?.click(),
        )
        expect(lastReplace()?.query).toEqual({
            workspace_id: "ws",
            project_id: "pr",
            evaluation_id: base,
            compare: short,
        })

        await open(base, {compare: short})
        await until(() => chips()[0] === "Capitals: short", "one compared run")
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Remove Capitals: short from the comparison"]',
                )
                ?.click(),
        )
        // The last compared run removed: the parameter goes away.
        expect(lastReplace()?.query).toEqual({
            workspace_id: "ws",
            project_id: "pr",
            evaluation_id: base,
        })
    })

    it("Ignores the base run, repeats and a base run that cannot be compared", async () => {
        const base = addRun("Capitals: default")
        const verbose = addRun("Capitals: verbose")
        await open(base, {compare: `${base},${verbose},${verbose}`})
        await until(() => !chips().includes("Loading…"), "compared run loaded")
        expect(chips()).toEqual(["Capitals: verbose"])

        const running = addRun("Capitals: running", {status: "running"})
        await open(running, {compare: verbose})
        expect(chips()).toEqual([])
        expect(host.textContent).not.toContain("Capitals: verbose")
    })
})

describe("compared overview", () => {
    it("Shows one summary column, one radar series and one bar per run, read in one metric request", async () => {
        const base = addRun("Capitals: default", {
            durationMs: 261,
            scenarios: [
                {id: "s1", testcase: "tc-1", success: true},
                {id: "s2", testcase: "tc-2", success: true},
            ],
        })
        const verbose = addRun("Capitals: verbose", {
            durationMs: 565,
            scenarios: [
                {id: "s1", testcase: "tc-1", success: false},
                {id: "s2", testcase: "tc-2", success: false},
            ],
        })
        await open(base, {compare: verbose})
        await until(
            () => Boolean(host.querySelector('section[aria-label="exact-match: success"]')),
            "compared overview shown",
        )

        await until(
            () =>
                host.querySelector('[data-testid="compare-summary-duration"]')?.textContent ===
                "Duration (Avg)261 ms565 ms",
            "both runs' metrics shown",
        )
        expect(compareModule.loads).toBe(1)
        // A poll left over from an earlier test may land here too: count this page's reads.
        const reads = runLevelMetricReads().filter(([, body]) =>
            (body as RequestBody).metrics?.run_ids?.includes(base),
        )
        expect(reads).toHaveLength(1)
        expect((reads[0][1] as RequestBody).metrics?.run_ids).toEqual([base, verbose])

        // The first table is the summary; the charts add their own data tables after it.
        const summary = host.querySelector("table")
        const columns = [...(summary?.querySelectorAll("thead th") ?? [])].map(
            (th) => th.textContent,
        )
        expect(columns).toEqual(["Field", "Capitals: default", "Capitals: verbose"])
        const cellsOf = (key: string) =>
            [...host.querySelectorAll(`[data-testid="compare-summary-${key}"] td`)].map(
                (td) => td.textContent,
            )
        expect(cellsOf("evaluation")).toEqual(["Capitals: default", "Capitals: verbose"])
        expect(cellsOf("duration")).toEqual(["261 ms", "565 ms"])
        expect(cellsOf(`ev-1:${SUCCESS}`)).toEqual(["100.00%", "0.00%"])

        const card = host.querySelector<HTMLElement>('section[aria-label="exact-match: success"]')
        expect(card?.textContent).toContain("100.00%")
        expect(card?.textContent).toContain("0.00%")
        expect(card?.textContent).toContain("-100%")
    })

    it("A run page without ?compare= does not load the compared overview", async () => {
        const base = addRun("Capitals: default")
        addRun("Capitals: verbose")
        const before = compareModule.loads
        await open(base)
        expect(compareModule.loads).toBe(before)
        expect(host.textContent).not.toContain("Field")
    })
})

describe("compared scenarios", () => {
    it("Follows each scenario with the compared run's scenario for the same test case", async () => {
        const base = addRun("Capitals: default", {
            scenarios: [
                {id: "s1", testcase: "tc-1", success: true},
                {id: "s2", testcase: "tc-2", success: true},
                {id: "s3", testcase: "tc-3", success: true},
            ],
        })
        // The compared run lists its scenarios in another order and has none for Peru.
        const verbose = addRun("Capitals: verbose", {
            scenarios: [
                {id: "s2", testcase: "tc-2", success: false},
                {id: "s1", testcase: "tc-1", success: false},
            ],
        })
        await open(base, {compare: verbose, view: "scenarios"})
        await until(
            () =>
                (host.textContent ?? "").includes("No matching scenario") &&
                !(host.textContent ?? "").includes("Loading…"),
            "compared scenarios shown",
        )

        const headers = [...host.querySelectorAll('[role="columnheader"]')].map(
            (h) => h.textContent,
        )
        expect(headers.slice(0, 3)).toEqual(["#", "Evaluation", "Status"])

        // Each row names its run in the Evaluation column.
        const rows = [...host.querySelectorAll<HTMLElement>("span")]
            .filter(
                (span) =>
                    span.children.length === 0 &&
                    /^Capitals: (default|verbose)$/.test(span.textContent ?? ""),
            )
            .filter((span) => span.parentElement?.parentElement?.textContent?.match(/^\d/))
            .map((span) => span.parentElement?.parentElement?.textContent ?? "")
        expect(rows).toHaveLength(6)
        const summary = rows.map((text) => [
            text.match(/^\d+/)?.[0],
            text.includes("Capitals: verbose") ? "verbose" : "default",
            text.match(/France|Japan|Peru/)?.[0] ?? null,
            text.match(/true|false/)?.[0] ??
                (text.includes("No matching scenario") ? "none" : null),
        ])
        expect(summary).toEqual([
            ["1", "default", "France", "true"],
            ["1", "verbose", "France", "false"],
            ["2", "default", "Japan", "true"],
            ["2", "verbose", "Japan", "false"],
            ["3", "default", "Peru", "true"],
            ["3", "verbose", null, "none"],
        ])
    })
})
