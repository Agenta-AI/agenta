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
    evaluationRunQueryKey,
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

describe("errors of a run with no invocation step", () => {
    // Captured from a live run whose evaluator failed on all three traces (2026-11-05).
    const errorsStats = {type: "numeric/continuous", count: 3, sum: 3, mean: 1.0}
    const durationStats = {type: "numeric/continuous", count: 3, sum: 6.095, mean: 2.03}

    it("A live run counts the errors its evaluators report", () => {
        const catalog = buildRunMetricCatalog(asRun(online.run), [
            {
                id: "m-errors",
                run_id: online.run.id,
                scenario_id: null,
                data: {
                    "evaluator-7c2d": {
                        "attributes.ag.metrics.duration.cumulative": durationStats,
                        "attributes.ag.metrics.errors.cumulative": errorsStats,
                    },
                },
            },
        ])
        const errors = catalog.find((entry) => entry.id === "errors")

        expect(errors?.stepKey).toBe("evaluator-7c2d")
        expect(errors?.stats).toMatchObject({sum: 3, count: 3})
        // Only errors read the evaluator step: duration stays the app's, and a live run has none.
        expect(catalog.find((entry) => entry.id === "duration")?.stats).toBeNull()
    })

    it("Two evaluators that fail add up their errors", () => {
        const run = asRun({
            ...online.run,
            data: {
                ...online.run.data,
                steps: [
                    ...online.run.data.steps,
                    {...online.run.data.steps[1], key: "evaluator-second"},
                ],
            },
        })
        const catalog = buildRunMetricCatalog(run, [
            {
                id: "m-errors",
                run_id: online.run.id,
                scenario_id: null,
                data: {
                    "evaluator-7c2d": {"attributes.ag.metrics.errors.cumulative": errorsStats},
                    "evaluator-second": {
                        "attributes.ag.metrics.errors.cumulative": {count: 2, sum: 1, mean: 0.5},
                    },
                },
            },
        ])

        // Only what adds up: one evaluator's mean must not stand for the total.
        expect(catalog.find((entry) => entry.id === "errors")?.stats).toEqual({
            type: "numeric/continuous",
            sum: 4,
            count: 5,
        })
    })

    it("Two evaluators that fail add up their error points per time", () => {
        const run = asRun({
            ...online.run,
            data: {
                ...online.run.data,
                steps: [
                    ...online.run.data.steps,
                    {...online.run.data.steps[1], key: "evaluator-second"},
                ],
            },
        })
        const point = (timestamp: string, first: number, second: number) => ({
            id: `m-${timestamp}`,
            run_id: online.run.id,
            scenario_id: null,
            timestamp,
            data: {
                "evaluator-7c2d": {
                    "attributes.ag.metrics.errors.cumulative": {count: first, sum: first},
                },
                "evaluator-second": {
                    "attributes.ag.metrics.errors.cumulative": {count: second, sum: second},
                },
            },
        })
        const catalog = buildRunMetricCatalog(run, [
            point("2026-11-05T10:00:00Z", 1, 2),
            point("2026-11-05T10:10:00Z", 3, 1),
        ])
        const errors = catalog.find((entry) => entry.id === "errors")

        expect(errors?.temporal.map((entry) => entry.stats.sum)).toEqual([3, 4])
        expect(errors?.stats).toMatchObject({sum: 4, count: 4})
    })

    it("A run with an invocation step keeps counting only the app's errors", () => {
        const catalog = buildRunMetricCatalog(asRun(auto.run), [
            {
                id: "m-errors",
                run_id: auto.run.id,
                scenario_id: null,
                data: {
                    "evaluator-129eebd77337": {
                        "attributes.ag.metrics.errors.cumulative": errorsStats,
                    },
                },
            },
        ])

        expect(catalog.find((entry) => entry.id === "errors")?.stats).toBeNull()
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
        const interval = () =>
            client.getQueryCache().find({queryKey: runLevelMetricsQueryKey("p1", run.id)})
                ?.observers[0]?.options.refetchInterval
        await vi.waitFor(() => expect(interval()).toBe(5_000))

        // A metrics fetch while the run is running also refreshes the run, so the poll sees the
        // run finish and stops.
        serve([{...run, status: "success"}], [])
        await store.get(runLevelMetricsQueryAtomFamily(run.id)).refetch()
        await vi.waitFor(() => expect(interval()).toBe(false))

        // Resumed: the run is running again, and the poll starts again.
        serve([run], [])
        await client.invalidateQueries({queryKey: evaluationRunQueryKey(run.id)})
        await vi.waitFor(() => expect(interval()).toBe(5_000))

        stopMetrics()
        stopRun()
    })

    it("The metrics query fetches once more after the run turns terminal", async () => {
        const run = {...auto.run, id: "run-finishing", status: "running"}
        const row = (count: number) => ({
            ...auto.response.metrics[0],
            id: `m-${count}`,
            run_id: run.id,
            marker: count,
        })
        let finished = false
        postMock.mockImplementation(async (url: string) => {
            if (url.endsWith("/evaluations/runs/query")) {
                // The run finishes between two metrics fetches.
                finished = true
                return {data: {count: 1, runs: [{...run, status: "success"}]}}
            }
            if (url.endsWith("/evaluations/metrics/query")) {
                const rows = [row(finished ? 2 : 1)]
                return {data: {count: 1, metrics: rows}}
            }
            throw new Error(`unexpected request ${url}`)
        })
        // The first run fetch happens before the metrics fetch and sees the running run.
        const client = new QueryClient()
        client.setQueryData(evaluationRunQueryKey(run.id), run)
        store.set(queryClientAtom, client)

        const stopRun = store.sub(evaluationRunQueryAtomFamily(run.id), () => undefined)
        const stopMetrics = store.sub(runLevelMetricsQueryAtomFamily(run.id), () => undefined)
        await vi.waitFor(() =>
            expect(
                (
                    store.get(runLevelMetricsQueryAtomFamily(run.id)).data as
                        | {id: string}[]
                        | undefined
                )?.[0]?.id,
            ).toBe("m-2"),
        )

        stopMetrics()
        stopRun()
    })

    it("The final fetch also happens when the run finished while the request was in flight", async () => {
        const run = {...auto.run, id: "run-racing", status: "running"}
        const client = new QueryClient()
        client.setQueryData(evaluationRunQueryKey(run.id), run)
        store.set(queryClientAtom, client)
        let metricCalls = 0
        postMock.mockImplementation(async (url: string) => {
            if (url.endsWith("/evaluations/runs/query")) {
                return {data: {count: 1, runs: [{...run, status: "success"}]}}
            }
            if (url.endsWith("/evaluations/metrics/query")) {
                metricCalls += 1
                // Another refresh stores the finished run while this request is in flight.
                client.setQueryData(evaluationRunQueryKey(run.id), {...run, status: "success"})
                return {
                    data: {
                        count: 1,
                        metrics: [
                            {...auto.response.metrics[0], id: `m-${metricCalls}`, run_id: run.id},
                        ],
                    },
                }
            }
            throw new Error(`unexpected request ${url}`)
        })

        const stopRun = store.sub(evaluationRunQueryAtomFamily(run.id), () => undefined)
        const stopMetrics = store.sub(runLevelMetricsQueryAtomFamily(run.id), () => undefined)
        await vi.waitFor(() =>
            expect(
                (
                    store.get(runLevelMetricsQueryAtomFamily(run.id)).data as
                        | {id: string}[]
                        | undefined
                )?.[0]?.id,
            ).toBe("m-2"),
        )
        stopMetrics()
        stopRun()
    })

    it("The metrics query stops polling when the run is gone", async () => {
        serve([], [])
        const client = new QueryClient()
        store.set(queryClientAtom, client)

        const stopRun = store.sub(evaluationRunQueryAtomFamily("run-gone"), () => undefined)
        const stopMetrics = store.sub(runLevelMetricsQueryAtomFamily("run-gone"), () => undefined)
        await vi.waitFor(() =>
            expect(store.get(evaluationRunQueryAtomFamily("run-gone")).isSuccess).toBe(true),
        )
        const query = client
            .getQueryCache()
            .find({queryKey: runLevelMetricsQueryKey("p1", "run-gone")})
        await vi.waitFor(() => expect(query?.observers[0]?.options.refetchInterval).toBe(false))

        stopMetrics()
        stopRun()
    })

    it("The metrics query waits for the project and keys its result by it", async () => {
        store.set(projectIdAtom, null)
        const run = {...auto.run, id: "run-late-project"}
        serve(
            [run],
            auto.response.metrics.map((row) => ({...row, run_id: run.id})),
        )
        const client = new QueryClient()
        store.set(queryClientAtom, client)

        const stopMetrics = store.sub(runLevelMetricsQueryAtomFamily(run.id), () => undefined)
        await new Promise((resolve) => setTimeout(resolve, 150))
        expect(
            postMock.mock.calls.filter((call) => String(call[0]).endsWith("/metrics/query")),
        ).toHaveLength(0)

        store.set(projectIdAtom, "p2")
        await vi.waitFor(() =>
            expect(store.get(runLevelMetricsQueryAtomFamily(run.id)).isSuccess).toBe(true),
        )
        const metricsCall = postMock.mock.calls.find((call) =>
            String(call[0]).endsWith("/metrics/query"),
        )
        expect(metricsCall?.[2]).toEqual({params: {project_id: "p2"}})
        expect(client.getQueryData(runLevelMetricsQueryKey("p2", run.id))).toHaveLength(1)
        stopMetrics()
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

        // Earlier tests may still have a poll in flight: count only the calls for these runs.
        const metricCalls = postMock.mock.calls.filter(
            (call) =>
                String(call[0]).endsWith("/metrics/query") &&
                call[1].metrics.run_ids.some((id: string) => id === "run-a" || id === "run-b"),
        )
        expect(metricCalls).toHaveLength(1)
        expect(metricCalls[0][1].metrics.run_ids).toEqual(
            expect.arrayContaining(["run-a", "run-b"]),
        )
        expect(metricCalls[0][1].metrics.scenario_ids).toBe(false)
        await vi.waitFor(() =>
            expect(
                store.get(runMetricCatalogAtomFamily("run-b")).map((entry) => entry.id),
            ).toContain("evaluator-4d0a:attributes.ag.data.outputs.tone"),
        )
        stops.forEach((stop) => stop())
    })
})
