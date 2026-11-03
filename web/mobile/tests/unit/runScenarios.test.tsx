// @vitest-environment jsdom
import {act, createElement} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only the HTTP layer is fake: the run, the pages, the hydration and the caches are package code.
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

import {useRunScenarios} from "@/features/evaluation-run/scenarios/useRunScenarios"

import {answerRequest, newServerState, type ScenarioServerState} from "./runScenariosFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let state: ScenarioServerState
let latest: ReturnType<typeof useRunScenarios>

const Probe = ({runId}: {runId: string}) => {
    latest = useRunScenarios(runId)
    return null
}

const scenarioCalls = () =>
    state.calls.filter((call) => call.url.endsWith("/evaluations/scenarios/query"))

const settle = (ms = 300) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

async function mount(patch: Partial<ScenarioServerState> = {}) {
    const runId = `run-${++counter}`
    state = newServerState(patch)
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) =>
        answerRequest(runId, state, url, body),
    )
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(QueryClientProvider, {client}, createElement(Probe, {runId})),
            ),
        )
    })
    await settle(1000)
    await settle(1000)
    return runId
}

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    Object.values(http).forEach((fn) => fn.mockReset())
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe("useRunScenarios", () => {
    it("First page asks for fifty scenarios of the run in ascending order", async () => {
        const runId = await mount()
        expect(scenarioCalls()).toHaveLength(1)
        expect(scenarioCalls()[0].body).toEqual({
            scenario: {run_ids: [runId]},
            windowing: {limit: 50, order: "ascending"},
        })
        expect(latest.rows.map((row) => row.index)).toEqual([1, 2, 3])
    })

    it("An online run asks for the newest scenarios first", async () => {
        await mount({live: true, runStatus: "running"})
        expect((scenarioCalls()[0].body as {windowing: {order: string}}).windowing.order).toBe(
            "descending",
        )
    })

    it("Load more sends the cursor from the previous page", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3", "sc-4"], pageSize: 3})
        expect(latest.hasMore).toBe(true)
        await act(async () => latest.loadMore())
        await settle()
        expect(scenarioCalls()).toHaveLength(2)
        expect((scenarioCalls()[1].body as {windowing: unknown}).windowing).toEqual({
            limit: 50,
            order: "ascending",
            next: "sc-3",
        })
        expect(latest.rows.map((row) => row.scenario.id)).toEqual(["sc-1", "sc-2", "sc-3", "sc-4"])
        expect(latest.hasMore).toBe(false)
    })

    it("Rows carry test set inputs and evaluator scores", async () => {
        await mount()
        const [first] = latest.rows
        expect(latest.columnGroups.map((entry) => entry.group.key)).toEqual([
            "testset:capitals",
            "evaluator:exact-match",
        ])
        expect(first.cells["testset:capitals"]).toMatchObject([{name: "country", value: "France"}])
        expect(first.cells["evaluator:exact-match"][0].value).toMatchObject({type: "binary"})
    })

    it("Running scenarios refresh every five seconds until the run finishes", async () => {
        await mount({runStatus: "running", statuses: {"sc-2": "running"}})
        expect(scenarioCalls()).toHaveLength(1)

        await settle(5000)
        expect(scenarioCalls()).toHaveLength(2)

        // The scenario and the run finish: one last read, then no more.
        state.statuses = {}
        state.runStatus = "evaluation_finished"
        await settle(5000)
        await settle(300)
        const afterFinish = scenarioCalls().length
        expect(afterFinish).toBeGreaterThanOrEqual(3)
        expect(latest.rows.map((row) => row.scenario.status)).toEqual([
            "success",
            "success",
            "success",
        ])
        await settle(20000)
        expect(scenarioCalls()).toHaveLength(afterFinish)
    })

    it("A failed first page reports an error instead of skeletons", async () => {
        await mount({failScenarios: true})
        expect(latest.isError).toBe(true)
        expect(latest.isPending).toBe(false)
        expect(latest.rows).toEqual([])
    })

    it("A failed values request is an error, not a row with empty values", async () => {
        await mount({failMetrics: true})
        expect(latest.isError).toBe(true)
        expect(latest.rows).toEqual([])
    })

    it("Results read while a scenario ran are read again when the tab opens later", async () => {
        const runId = await mount({scored: false})
        expect(latest.rows[0].cells["evaluator:exact-match"][0].value).toBeUndefined()
        const resultCalls = () =>
            state.calls.filter((call) => call.url.endsWith("/evaluations/results/query")).length
        const before = resultCalls()
        state.scored = true
        // A new visit of the tab: the same run, a new page load.
        await act(async () => {
            latest.refetch()
        })
        await settle()
        expect(resultCalls()).toBeGreaterThan(before)
        expect(latest.rows[0].cells["evaluator:exact-match"][0].value).toMatchObject({
            type: "binary",
        })
        void runId
    })

    it("A new scenario of an online run appears at the top once the rows loaded are done", async () => {
        await mount({live: true, runStatus: "running", ids: ["sc-2", "sc-1"]})
        expect(latest.rows.map((row) => row.scenario.id)).toEqual(["sc-2", "sc-1"])
        state.ids = ["sc-3", "sc-2", "sc-1"]
        await settle(5000)
        await settle(300)
        expect(latest.rows.map((row) => row.scenario.id)).toEqual(["sc-3", "sc-2", "sc-1"])
    })

    it("Pages after a page that now ends elsewhere are dropped and load again on demand", async () => {
        await mount({
            live: true,
            runStatus: "running",
            ids: ["sc-4", "sc-3", "sc-2", "sc-1"],
            pageSize: 2,
        })
        await act(async () => latest.loadMore())
        await settle()
        expect(latest.rows.map((row) => row.scenario.id)).toEqual(["sc-4", "sc-3", "sc-2", "sc-1"])
        state.ids = ["sc-5", "sc-4", "sc-3", "sc-2", "sc-1"]
        await settle(5000)
        await settle(300)
        // The first page now ends at sc-4; sc-3 would be lost if the old second page stayed.
        expect(latest.rows.map((row) => row.scenario.id)).toEqual(["sc-5", "sc-4"])
        expect(latest.hasMore).toBe(true)
        await act(async () => latest.loadMore())
        await settle()
        expect(latest.rows.map((row) => row.scenario.id)).toEqual(["sc-5", "sc-4", "sc-3", "sc-2"])
    })
})
