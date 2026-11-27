import {describe, expect, it} from "vitest"

import {
    buildEvaluatorRows,
    categorySegments,
    chartValue,
    formatMean,
    histogramBarsOf,
    isUnitScale,
    metricKind,
    passedTestCases,
    runFailures,
    runTiles,
    SCENARIO_METRICS_LIMIT,
    type EvaluatorRowMetricInput,
    type MetricStats,
    type RunTilesInput,
} from "../../src/evaluationRun"

const binary = (passed: number, failed: number): MetricStats => ({
    type: "binary",
    count: passed + failed,
    frequency: [
        {value: true, count: passed},
        {value: false, count: failed},
    ],
})

const entry = (
    stepKey: string,
    label: string,
    stats: MetricStats | null,
    statsAreRunWide = true,
): EvaluatorRowMetricInput => ({
    id: `${stepKey}:${label}`,
    kind: "evaluator",
    stepKey,
    metricKey: `attributes.ag.data.outputs.${label}`,
    label,
    stats,
    statsAreRunWide,
})

describe("metric kind and scale", () => {
    it("The kind follows the API type, and a legacy blob its shape", () => {
        expect(metricKind({type: "binary"})).toBe("binary")
        expect(metricKind({type: "numeric/continuous"})).toBe("numeric")
        expect(metricKind({type: "numeric/discrete"})).toBe("numeric")
        expect(metricKind({type: "categorical/single"})).toBe("categorical")
        expect(metricKind({type: "categorical/multiple"})).toBe("categorical")
        expect(metricKind({type: "string", count: 3})).toBe("text")
        expect(metricKind({type: "json", count: 3})).toBe("text")
        expect(metricKind({count: 2, frequency: [{value: true, count: 2}]})).toBe("binary")
        expect(metricKind({count: 2, mean: 0.4})).toBe("numeric")
        expect(metricKind({count: 2, frequency: [{value: "a", count: 2}]})).toBe("categorical")
        expect(metricKind({count: 2})).toBe("text")
    })

    it("A numeric metric is on 0 to 1 when its min is 0 or more and its max 1 or less", () => {
        expect(isUnitScale({min: 0, max: 1})).toBe(true)
        expect(isUnitScale({min: 0.2, max: 0.9})).toBe(true)
        expect(isUnitScale({min: 1, max: 5})).toBe(false)
        expect(isUnitScale({min: -0.1, max: 1})).toBe(false)
        expect(isUnitScale({mean: 0.5})).toBe(false)
    })

    it("The chart value is a pass rate or a mean on 0 to 1, else nothing", () => {
        expect(chartValue(binary(63, 5))).toBeCloseTo(63 / 68)
        expect(chartValue({type: "numeric/continuous", mean: 0.82, min: 0, max: 1})).toBe(0.82)
        expect(chartValue({type: "numeric/continuous", mean: 4, min: 1, max: 5})).toBeNull()
        expect(
            chartValue({type: "categorical/single", frequency: [{value: "a", count: 1}]}),
        ).toBeNull()
        expect(chartValue({type: "string", count: 1})).toBeNull()
        expect(chartValue(binary(0, 0))).toBeNull()
    })

    it("A mean on 0 to 1 has 2 decimals, any other mean 3 significant digits", () => {
        expect(formatMean(0.983, true)).toBe("0.98")
        expect(formatMean(4.2345, false)).toBe("4.23")
        expect(formatMean(1234.5, false)).toBe("1230")
    })
})

describe("evaluator rows", () => {
    const steps = [
        {stepKey: "judge-a", evaluatorId: "ev-1", name: "Judge"},
        {stepKey: "judge-b", evaluatorId: "ev-1", name: "Judge"},
        {stepKey: "tone", evaluatorId: "ev-2", name: "Tone check"},
    ]

    it("One row per step, also two steps of one evaluator and a step with no values", () => {
        const rows = buildEvaluatorRows(steps, [
            entry("judge-a", "success", binary(3, 1)),
            entry("judge-b", "success", binary(1, 1)),
        ])

        expect(rows.map((row) => [row.stepKey, row.name, row.metrics.length])).toEqual([
            ["judge-a", "Judge", 1],
            ["judge-b", "Judge", 1],
            ["tone", "Tone check", 0],
        ])
    })

    it("Metrics are binary, numeric, then categorical, each by label; text metrics are left out", () => {
        const rows = buildEvaluatorRows(steps.slice(0, 1), [
            entry("judge-a", "reason", {type: "string", count: 4}),
            entry("judge-a", "tone", {
                type: "categorical/single",
                frequency: [{value: "x", count: 1}],
            }),
            entry("judge-a", "score", {type: "numeric/continuous", mean: 0.5}),
            entry("judge-a", "safe", binary(1, 0)),
            entry("judge-a", "accurate", binary(1, 0)),
            entry("judge-a", "clarity", {type: "numeric/discrete", mean: 3}),
        ])

        expect(rows[0].metrics.map((metric) => [metric.label, metric.kind])).toEqual([
            ["accurate", "binary"],
            ["safe", "binary"],
            ["clarity", "numeric"],
            ["score", "numeric"],
            ["tone", "categorical"],
        ])
    })

    it("A step with only text metrics has no row; a step with no metric yet keeps its row", () => {
        const rows = buildEvaluatorRows(steps, [
            entry("judge-a", "reason", {type: "string", count: 4}),
            entry("judge-a", "raw", {type: "json", count: 4}),
            entry("judge-b", "success", binary(1, 1)),
        ])

        expect(rows.map((row) => [row.stepKey, row.metrics.length])).toEqual([
            ["judge-b", 1],
            ["tone", 0],
        ])
    })

    it("Invocation entries stay out of the rows, and an unknown step gets its own row", () => {
        const rows = buildEvaluatorRows(steps.slice(0, 1), [
            {...entry("app", "cost", {mean: 1}), id: "cost", kind: "invocation"},
            entry("extra-step", "success", binary(1, 0)),
        ])

        expect(rows.map((row) => [row.stepKey, row.name, row.metrics.length])).toEqual([
            ["judge-a", "Judge", 0],
            ["extra-step", "extra-step", 1],
        ])
    })

    it("An online run keeps only run-wide stats; the kind still comes from the latest point", () => {
        const rows = buildEvaluatorRows(
            steps.slice(0, 1),
            [entry("judge-a", "success", binary(2, 1), false)],
            {runWideOnly: true},
        )

        expect(rows[0].metrics[0]).toMatchObject({kind: "binary", stats: null})
    })
})

describe("histogram bars and categories", () => {
    it("Bars are the server bins as they come, height over the metric count", () => {
        const bars = histogramBarsOf({
            type: "numeric/continuous",
            count: 68,
            distribution: [
                {interval: [0, 0.1], count: 0},
                {interval: [0.4, 0.5], count: 1},
                {interval: [0.9, 1], count: 67},
            ],
        })

        expect(bars).toEqual([
            {from: 0, to: 0.1, count: 0, share: 0},
            {from: 0.4, to: 0.5, count: 1, share: 1 / 68},
            {from: 0.9, to: 1, count: 67, share: 67 / 68},
        ])
    })

    it("Zero-width bins on one value draw as one full bar on that value", () => {
        const bars = histogramBarsOf({
            type: "numeric/continuous",
            count: 5,
            distribution: Array.from({length: 10}, (_, index) => ({
                interval: [7, 7] as const,
                count: index === 0 ? 5 : 0,
            })),
        })

        expect(bars).toEqual([{from: 7, to: 7, count: 5, share: 1}])
    })

    it("A discrete score with no bins gets one bar per value, ordered by value", () => {
        const bars = histogramBarsOf({
            type: "numeric/discrete",
            count: 68,
            frequency: [
                {value: 5, count: 38},
                {value: 3, count: 10},
                {value: 4, count: 20},
            ],
        })

        expect(bars.map((bar) => [bar.from, bar.to, bar.count])).toEqual([
            [3, 3, 10],
            [4, 4, 20],
            [5, 5, 38],
        ])
    })

    it("Categories are shares of all chosen values, most chosen first", () => {
        const segments = categorySegments({
            type: "categorical/single",
            frequency: [
                {value: "rude", count: 7},
                {value: "formal", count: 41},
                {value: "casual", count: 20},
            ],
        })

        expect(segments.map((s) => [s.label, Math.round(s.share * 100)])).toEqual([
            ["formal", 60],
            ["casual", 29],
            ["rude", 10],
        ])
    })
})

describe("passed test cases", () => {
    const keys = [
        {stepKey: "a", metricKey: "ok"},
        {stepKey: "b", metricKey: "safe"},
        {stepKey: "b", metricKey: "kind"},
    ]
    const row = (scenario: string, values: Record<string, Record<string, unknown>>) => ({
        scenario_id: scenario,
        data: values,
    })
    const bool = (value: boolean) => ({
        type: "binary",
        count: 1,
        freq: [
            {value: true, count: value ? 1 : 0},
            {value: false, count: value ? 0 : 1},
        ],
    })

    it("A test case passes when every binary value it has is true; a missing value does not fail", () => {
        const result = passedTestCases(
            [
                row("s1", {a: {ok: bool(true)}, b: {safe: bool(true)}}),
                row("s2", {a: {ok: bool(true)}, b: {safe: bool(false), kind: bool(true)}}),
                row("s3", {a: {ok: bool(false)}}),
            ],
            keys,
        )

        expect(result).toEqual({passed: 1, total: 3})
    })

    it("A test case with no binary value is not counted", () => {
        const result = passedTestCases(
            [
                row("s1", {a: {ok: bool(true)}}),
                row("s2", {a: {score: {type: "numeric/continuous"}}}),
            ],
            keys,
        )

        expect(result).toEqual({passed: 1, total: 1})
    })

    it("Two rows of one test case count as one test case", () => {
        const result = passedTestCases(
            [row("s1", {a: {ok: bool(true)}}), row("s1", {b: {safe: bool(false)}})],
            keys,
        )

        expect(result).toEqual({passed: 0, total: 1})
    })

    it("A full page of rows means the count is not available", () => {
        const rows = Array.from({length: SCENARIO_METRICS_LIMIT}, (_, index) =>
            row(`s${index}`, {a: {ok: bool(true)}}),
        )

        expect(passedTestCases(rows, keys)).toBeNull()
    })
})

describe("run tiles", () => {
    const invocation = [
        {id: "cost", stats: {mean: 0.021, count: 9}},
        {id: "duration", stats: {mean: 1500, count: 9}},
        {id: "tokens", stats: {mean: 950, count: 9}},
        {id: "errors", stats: {sum: 2, count: 9}},
    ]
    const base: RunTilesInput = {
        status: "success",
        online: false,
        invocation,
        binaryStats: [binary(60, 40), binary(32, 6)],
        passed: {status: "ready", passed: 1, total: 9},
        metricsPending: false,
    }

    it("A finished run shows the six tiles in order with their values", () => {
        const tiles = runTiles(base)

        expect(tiles.map((tile) => [tile.id, tile.value])).toEqual([
            ["testCases", "9"],
            ["passed", "11%"],
            ["cost", "$0.021"],
            ["duration", "1.50 s"],
            ["tokens", "950"],
            ["errors", "2"],
        ])
        expect(tiles[0].detail).toEqual({kind: "allFinished"})
        expect(tiles[1].detail).toEqual({
            kind: "testCasesPassed",
            passed: 1,
            total: 9,
            thatRan: false,
        })
        expect(tiles[1].assertions).toEqual({passed: 92, total: 138})
        expect(tiles[2].detail).toEqual({kind: "perCase"})
        expect(tiles[5].detail).toEqual({kind: "total"})
    })

    it("A run with no binary metric has no Passed tile", () => {
        const tiles = runTiles({...base, binaryStats: []})

        expect(tiles.map((tile) => tile.id)).toEqual([
            "testCases",
            "cost",
            "duration",
            "tokens",
            "errors",
        ])
    })

    it("Without the per-test-case rows the Passed tile shows a dash and only the assertions", () => {
        const [, passed] = runTiles({...base, passed: {status: "unavailable"}})

        expect(passed).toMatchObject({
            value: "—",
            detail: null,
            assertions: {passed: 92, total: 138},
        })
    })

    it("While metrics load each tile shows the loading mark, never 0", () => {
        const tiles = runTiles({
            ...base,
            invocation: [],
            binaryStats: [binary(0, 0)],
            passed: {status: "pending"},
            metricsPending: true,
        })

        expect(tiles.map((tile) => tile.value)).toEqual(["…", "…", "…", "…", "…", "…"])
    })

    it("An errors status names the failed test cases; an online run counts per trace", () => {
        expect(runTiles({...base, status: "errors"})[0].detail).toEqual({kind: "someFailed"})
        expect(runTiles({...base, status: "running"})[0].detail).toBeNull()
        expect(runTiles({...base, online: true})[2].detail).toEqual({kind: "perTrace"})
    })

    it("An online run uses only run-wide invocation stats, not its latest time bucket", () => {
        const bucketOnly = invocation.map((entry) => ({...entry, statsAreRunWide: false}))

        const online = runTiles({...base, online: true, binaryStats: [], invocation: bucketOnly})
        expect(online.map((tile) => tile.value)).toEqual(["—", "—", "—", "—", "—"])
        const offline = runTiles({...base, binaryStats: [], invocation: bucketOnly})
        expect(offline[0].value).toBe("9")
    })
})

describe("failed test cases", () => {
    const errors = (sum: number) => ({
        "attributes.ag.metrics.errors.cumulative": {type: "numeric/continuous", count: 1, sum},
    })
    const keys = {invocationStepKeys: ["app"], evaluatorStepKeys: ["judge", "tone"]}

    it("An application error means the test case did not run; an evaluator error is counted per step", () => {
        const failures = runFailures(
            [
                {scenario_id: "s1", data: {app: errors(1)}},
                {scenario_id: "s2", data: {app: errors(0), judge: errors(1), tone: errors(1)}},
                {scenario_id: "s3", data: {app: errors(0), judge: errors(1)}},
                {scenario_id: "s4", data: {app: errors(0)}},
            ],
            keys,
        )

        expect(failures).toEqual({
            total: 4,
            notRun: 1,
            evaluatorFailed: 2,
            byStep: {judge: 2, tone: 1},
        })
    })

    it("An evaluator with no value and no error did not apply, and is not a failure", () => {
        const failures = runFailures([{scenario_id: "s1", data: {app: errors(0), tone: {}}}], keys)

        expect(failures).toEqual({total: 1, notRun: 0, evaluatorFailed: 0, byStep: {}})
    })

    it("A full page of rows means the failures are not available", () => {
        const rows = Array.from({length: SCENARIO_METRICS_LIMIT}, (_, index) => ({
            scenario_id: `s${index}`,
            data: {},
        }))

        expect(runFailures(rows, keys)).toBeNull()
    })

    it("Failures change the test cases, passed and errors tiles", () => {
        const tiles = runTiles({
            status: "errors",
            online: false,
            invocation: [{id: "duration", stats: {mean: 1, count: 94}}],
            binaryStats: [binary(20, 74)],
            passed: {status: "ready", passed: 16, total: 94},
            metricsPending: false,
            failures: {total: 100, notRun: 6, evaluatorFailed: 3, byStep: {judge: 3}},
        })
        const byId = Object.fromEntries(tiles.map((tile) => [tile.id, tile]))

        expect(byId.testCases).toMatchObject({
            value: "94 of 100",
            detail: {kind: "notRun", count: 6},
        })
        expect(byId.passed.detail).toEqual({
            kind: "testCasesPassed",
            passed: 16,
            total: 94,
            thatRan: true,
        })
        expect(byId.errors).toMatchObject({
            value: "9",
            detail: {kind: "errorsSplit", runs: 6, evaluator: 3},
        })
    })
})
