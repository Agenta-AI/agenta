import {vi} from "vitest"

/** One neutral run: a test set with a country column, an app, and one evaluator with a success score. */
export const COLUMN_PATH = "attributes.ag.data.outputs.success"

export interface ScenarioServerState {
    runStatus: string
    live: boolean
    /** Status of every scenario, by id. */
    statuses: Record<string, string>
    /** The scenarios in the order the API returns them. */
    ids: string[]
    pageSize: number
    failScenarios: boolean
    /** False: the evaluator has not scored any scenario yet. */
    scored: boolean
    /** True: the metrics request fails. */
    failMetrics: boolean
    /** True: results point at traces, and the traces request fails. */
    failTraces: boolean
    /** Scenarios the evaluator scored false; the others score true. */
    failing: string[]
    /** True: each scenario's metrics hold the cost, duration, tokens and errors of the app call. */
    appMetrics: boolean
    calls: {url: string; body: unknown}[]
}

export function newServerState(patch: Partial<ScenarioServerState> = {}): ScenarioServerState {
    return {
        runStatus: "evaluation_finished",
        live: false,
        statuses: {},
        ids: ["sc-1", "sc-2", "sc-3"],
        pageSize: 50,
        failScenarios: false,
        scored: true,
        failMetrics: false,
        failTraces: false,
        failing: [],
        appMetrics: false,
        calls: [],
        ...patch,
    }
}

const one = (value: number) => ({type: "numeric/continuous", count: 1, mean: value, sum: value})

/** The app call's metrics of every scenario: $0.000012, 522 ms, 128 tokens, no error. */
export const APP_METRICS = {
    "attributes.ag.metrics.costs.cumulative.total": one(0.000012),
    "attributes.ag.metrics.duration.cumulative": one(522),
    "attributes.ag.metrics.tokens.cumulative.total": one(128),
    "attributes.ag.metrics.errors.cumulative": one(0),
}

export const countries = ["France", "Japan", "Chile", "Kenya", "Peru", "Norway"]

/** The HTTP answers of the evaluation API for one run. */
export function answerRequest(
    runId: string,
    state: ScenarioServerState,
    url: string,
    body: Record<string, unknown> | undefined,
) {
    state.calls.push({url, body})
    if (url.endsWith("/evaluations/runs/query")) {
        return {
            data: {
                count: 1,
                runs: [
                    {
                        id: runId,
                        name: "Capitals check",
                        status: state.runStatus,
                        flags: {is_live: state.live, is_active: false, is_closed: false},
                        data: {
                            steps: [
                                {
                                    key: "ts",
                                    type: "input",
                                    references: {testset: {id: "ts-1", slug: "capitals"}},
                                },
                                {
                                    key: "app",
                                    type: "invocation",
                                    references: {application: {id: "app-1", slug: "geo-bot"}},
                                },
                                {
                                    key: "ev",
                                    type: "annotation",
                                    origin: "auto",
                                    references: {evaluator: {id: "ev-1", slug: "exact-match"}},
                                },
                            ],
                            mappings: [
                                {
                                    column: {kind: "testset", name: "country"},
                                    step: {key: "ts", path: "data.country"},
                                },
                                {
                                    column: {kind: "annotation", name: "success"},
                                    step: {key: "ev", path: COLUMN_PATH},
                                },
                            ],
                        },
                    },
                ],
            },
        }
    }
    if (url.endsWith("/evaluations/scenarios/query")) {
        if (state.failScenarios) throw new Error("Request failed with status code 500")
        const windowing = (body?.windowing ?? {}) as {limit: number; next?: string}
        // The cursor names the last row of the page before, as the API's cursors do.
        const start = windowing.next ? state.ids.indexOf(windowing.next) + 1 : 0
        const end = Math.min(start + state.pageSize, state.ids.length)
        return {
            data: {
                count: end - start,
                scenarios: state.ids.slice(start, end).map((id) => ({
                    id,
                    run_id: runId,
                    status: state.statuses[id] ?? "success",
                    testcase_id: `tc-${id}`,
                })),
                windowing: {next: end < state.ids.length ? state.ids[end - 1] : null},
            },
        }
    }
    if (url.endsWith("/evaluations/results/query")) {
        const ids = ((body?.result as {scenario_ids?: string[]})?.scenario_ids ?? []) as string[]
        return {
            data: {
                count: ids.length,
                results: ids.map((id) => ({
                    id: `res-${id}`,
                    run_id: runId,
                    scenario_id: id,
                    step_key: "ts",
                    status: "success",
                    testcase_id: `tc-${id}`,
                    ...(state.failTraces ? {trace_id: `trace-${id}`} : {}),
                })),
            },
        }
    }
    if (url.endsWith("/evaluations/metrics/query")) {
        if (state.failMetrics) throw new Error("Request failed with status code 500")
        const ids = ((body?.metrics as {scenario_ids?: string[]})?.scenario_ids ?? []) as string[]
        return {
            data: {
                count: ids.length,
                metrics: (state.scored ? ids : []).map((id) => ({
                    id: `met-${id}`,
                    run_id: runId,
                    scenario_id: id,
                    data: {
                        ev: {
                            [COLUMN_PATH]: {
                                type: "binary",
                                count: 1,
                                freq: [{value: !state.failing.includes(id), count: 1}],
                            },
                        },
                        ...(state.appMetrics ? {app: APP_METRICS} : {}),
                    },
                })),
            },
        }
    }
    if (url.endsWith("/testcases/query")) {
        const ids = ((body?.testcase_ids ?? []) as string[]).filter(Boolean)
        return {
            data: {
                count: ids.length,
                testcases: ids.map((id) => ({
                    id,
                    data: {country: countries[state.ids.indexOf(id.replace("tc-", "")) % 6]},
                })),
            },
        }
    }
    throw new Error(`unexpected request ${url}`)
}

export const makeHttp = () => ({
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
})
