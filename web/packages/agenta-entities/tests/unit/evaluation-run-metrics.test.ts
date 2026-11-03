import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: {post: postMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {
    buildRunMetricCatalog,
    evaluationRunQueryAtomFamily,
    runLevelMetricsQueryAtomFamily,
    runLevelMetricsQueryKey,
    runMetricCatalogAtomFamily,
    type EvaluationMetric,
    type EvaluationRun,
} from "../../src/evaluationRun"
import auto from "../fixtures/evaluationRun/auto-metrics.json"
import human from "../fixtures/evaluationRun/human-metrics.json"
import online from "../fixtures/evaluationRun/online-metrics.json"

const store = getDefaultStore()
const asRun = (run: unknown) => run as EvaluationRun
const asMetrics = (metrics: unknown) => metrics as EvaluationMetric[]

const ids = (entries: {id: string}[]) => entries.map((entry) => entry.id)

function serve(runs: {id: string; status?: string}[], metrics: unknown[]) {
    postMock.mockImplementation(async (url: string, body: {metrics?: {run_ids: string[]}}) => {
        if (url.endsWith("/evaluations/runs/query")) {
            return {data: {count: runs.length, runs}}
        }
        if (url.endsWith("/evaluations/metrics/query")) {
            const wanted = new Set(body.metrics?.run_ids)
            const rows = (metrics as {run_id: string}[]).filter((row) => wanted.has(row.run_id))
            return {data: {count: rows.length, metrics: rows}}
        }
        throw new Error(`unexpected request ${url}`)
    })
}

beforeEach(() => {
    postMock.mockReset()
    store.set(queryClientAtom, new QueryClient())
    store.set(projectIdAtom, "p1")
})

describe("run metric catalog", () => {
    it("Catalog lists evaluator metrics and the four invocation metrics", () => {
        const catalog = buildRunMetricCatalog(asRun(auto.run), asMetrics(auto.response.metrics))

        expect(ids(catalog)).toEqual([
            "evaluator-129eebd77337:attributes.ag.data.outputs.score",
            "evaluator-129eebd77337:attributes.ag.data.outputs.success",
            "evaluator-c4ef7ea123cf:attributes.ag.data.outputs.score",
            "evaluator-c4ef7ea123cf:attributes.ag.data.outputs.success",
            "cost",
            "duration",
            "tokens",
            "errors",
        ])
        expect(catalog[1]).toMatchObject({
            kind: "evaluator",
            label: "success",
            stepKey: "evaluator-129eebd77337",
            evaluatorSlug: auto.run.data.steps[2].references.evaluator?.slug,
            stats: {type: "binary"},
        })
        // Duration comes from the invocation step, not from the evaluators' own timing.
        const duration = catalog.find((entry) => entry.id === "duration")
        expect(duration?.stepKey).toBe("application-58b454a0668b")
        expect(duration?.stats?.type).toBe("numeric/continuous")
        // This app reports no cost: the entry stays, with no stats.
        expect(catalog.find((entry) => entry.id === "cost")?.stats).toBeNull()
    })

    it("String and json metrics are left out of the catalog", () => {
        const catalog = buildRunMetricCatalog(asRun(human.run), asMetrics(human.response.metrics))
        const evaluatorEntries = catalog.filter((entry) => entry.kind === "evaluator")

        expect(ids(evaluatorEntries)).toEqual(["evaluator-4d0a:attributes.ag.data.outputs.tone"])
        expect(evaluatorEntries[0].stats?.type).toBe("categorical/single")
    })

    it("Legacy stats without a type are kept when they have a mean", () => {
        const catalog = buildRunMetricCatalog(asRun(human.run), [
            {
                id: "m1",
                run_id: human.run.id,
                scenario_id: null,
                data: {
                    "evaluator-4d0a": {
                        "outputs.rating": {count: 3, mean: 4.2},
                        "outputs.note": {count: 3},
                    },
                },
            },
        ])
        const legacy = catalog.filter((entry) => entry.kind === "evaluator")

        expect(ids(legacy)).toEqual(["evaluator-4d0a:outputs.rating"])
        expect(legacy[0].label).toBe("rating")
    })

    it("Online run metrics carry their timestamped points", () => {
        const catalog = buildRunMetricCatalog(asRun(online.run), asMetrics(online.response.metrics))
        const success = catalog.find((entry) => entry.kind === "evaluator")

        expect(success?.temporal.map((point) => point.timestamp)).toEqual([
            Date.parse("2026-10-30T09:00:00+00:00"),
            Date.parse("2026-10-30T09:10:00+00:00"),
            Date.parse("2026-10-30T09:20:00+00:00"),
        ])
        // No static row: the stats are the latest point's.
        expect(success?.stats?.frequency).toEqual([
            {value: true, count: 3},
            {value: false, count: 1},
        ])
    })
})

describe("run metrics query", () => {
    it("The metrics query refreshes every five seconds until the run is terminal", async () => {
        const run = {...auto.run, id: "run-live", status: "running"}
        serve([run], [])
        const client = new QueryClient()
        store.set(queryClientAtom, client)

        const stopRun = store.sub(evaluationRunQueryAtomFamily(run.id), () => undefined)
        const stopMetrics = store.sub(runLevelMetricsQueryAtomFamily(run.id), () => undefined)
        await vi.waitFor(() =>
            expect(store.get(runLevelMetricsQueryAtomFamily(run.id)).isSuccess).toBe(true),
        )
        const query = client.getQueryCache().find({queryKey: runLevelMetricsQueryKey("p1", run.id)})
        const interval = () => {
            const option = query?.options.refetchInterval
            return typeof option === "function" ? option(query as never) : option
        }
        expect(interval()).toBe(5_000)

        // A metrics fetch while the run is running also refreshes the run, so the poll sees the
        // run finish and stops.
        serve([{...run, status: "success"}], [])
        await store.get(runLevelMetricsQueryAtomFamily(run.id)).refetch()
        await vi.waitFor(() =>
            expect(store.get(evaluationRunQueryAtomFamily(run.id)).data?.status).toBe("success"),
        )
        expect(interval()).toBe(false)

        stopMetrics()
        stopRun()
    })

    it("Two runs share one metrics request", async () => {
        const first = {...auto.run, id: "run-a"}
        const second = {...human.run, id: "run-b", status: "success"}
        serve(
            [first, second],
            [
                {...auto.response.metrics[0], run_id: "run-a"},
                {...human.response.metrics[0], run_id: "run-b"},
            ],
        )

        const stops = ["run-a", "run-b"].flatMap((runId) => [
            store.sub(evaluationRunQueryAtomFamily(runId), () => undefined),
            store.sub(runMetricCatalogAtomFamily(runId), () => undefined),
        ])
        await vi.waitFor(() => {
            expect(store.get(runLevelMetricsQueryAtomFamily("run-a")).isSuccess).toBe(true)
            expect(store.get(runLevelMetricsQueryAtomFamily("run-b")).isSuccess).toBe(true)
        })

        const metricCalls = postMock.mock.calls.filter((call) =>
            String(call[0]).endsWith("/metrics/query"),
        )
        expect(metricCalls).toHaveLength(1)
        expect(metricCalls[0][1]).toEqual({
            metrics: {run_ids: ["run-a", "run-b"], scenario_ids: false},
        })
        expect(store.get(runMetricCatalogAtomFamily("run-b")).map((entry) => entry.id)).toContain(
            "evaluator-4d0a:attributes.ag.data.outputs.tone",
        )
        stops.forEach((stop) => stop())
    })
})
