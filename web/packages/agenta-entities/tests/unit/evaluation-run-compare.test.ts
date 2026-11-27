/**
 * The compare rules the /m run page uses: which runs the URL compares, how the picker filters
 * candidates, how one metric is found in every run, the change of the newest run against the run
 * before it, the compare summary and evaluator rows, and how scenario rows and column groups of
 * compared runs line up.
 */
import {describe, expect, it} from "vitest"

import {
    buildCompareEvaluatorRows,
    buildCompareSummaryRows,
    compareChange,
    compareRoles,
    formatSigned,
    formatTileAmount,
    runTiles,
    type EvaluatorRow,
    type RunTile,
} from "../../src/evaluationRun/core/evaluatorRows"
import {normalizeMetricStats} from "../../src/evaluationRun/core/metricStats"
import {
    compareMetricKey,
    compareRunIds,
    compareStatusCounts,
    filterCompareRuns,
    matchCompareGroupKey,
    matchCompareRows,
    runConfigDiff,
    type RunConfigDiff,
    type RunConfigIdentity,
} from "../../src/evaluationRun/core/runCompare"

describe("compared runs from the URL", () => {
    it("drops the base run, repeats and blanks, and keeps at most 4", () => {
        expect(compareRunIds("b,base,b, ,c", "base")).toEqual(["b", "c"])
        expect(compareRunIds(["a,b", "c,d,e"], "base")).toEqual(["a", "b", "c", "d"])
        expect(compareRunIds(undefined, "base")).toEqual([])
    })
})

describe("compare picker filters", () => {
    const runs = [
        {name: "Capitals: verbose", status: "success"},
        {name: "Capitals: short", status: "evaluation_finished_with_errors"},
        {name: "Support tickets", status: "failure"},
        {name: "Capitals: draft", status: "cancelled"},
        {name: "Queued check", status: "running"},
    ]

    it("counts the runs of each status filter", () => {
        expect(compareStatusCounts(runs)).toEqual({
            all: 5,
            success: 1,
            running: 1,
            error: 2,
            other: 1,
        })
    })

    it("keeps the runs whose name holds the search, in any case, with the chosen status", () => {
        expect(
            filterCompareRuns(runs, {search: " CAPITALS ", status: "all"}).map((r) => r.name),
        ).toEqual(["Capitals: verbose", "Capitals: short", "Capitals: draft"])
        expect(filterCompareRuns(runs, {search: "capitals", status: "error"})).toEqual([runs[1]])
        expect(filterCompareRuns(runs, {search: "", status: "other"})).toEqual([runs[3]])
        expect(filterCompareRuns(runs, {search: "nothing", status: "all"})).toEqual([])
    })
})

describe("one metric across runs", () => {
    const metric = {
        id: "evaluator-exact-match:attributes.ag.data.outputs.success",
        kind: "evaluator" as const,
        stepKey: "evaluator-exact-match",
        metricKey: "attributes.ag.data.outputs.success",
        evaluatorId: "ev-1",
        evaluatorSlug: "exact-match",
    }

    it("finds an evaluator metric by its evaluator, not by the run's step key", () => {
        expect(compareMetricKey(metric)).toBe("ev-1:attributes.ag.data.outputs.success")
        expect(compareMetricKey({...metric, stepKey: "step-7"})).toBe(
            "ev-1:attributes.ag.data.outputs.success",
        )
        expect(compareMetricKey({...metric, evaluatorId: null})).toBe(
            "exact-match:attributes.ag.data.outputs.success",
        )
    })

    it("keeps the id of an invocation metric", () => {
        expect(
            compareMetricKey({...metric, id: "cost", kind: "invocation", evaluatorId: null}),
        ).toBe("cost")
    })
})

describe("newest run and the run before it", () => {
    it("picks the latest createdAt and the run created just before it", () => {
        // The page's run is the oldest: the change uses the two other runs.
        expect(
            compareRoles(["2026-11-01T10:00:00Z", "2026-11-03T10:00:00Z", "2026-11-02T10:00:00Z"]),
        ).toEqual({newest: 1, before: 2})
        expect(compareRoles(["2026-11-03T10:00:00Z", "2026-11-01T10:00:00Z"])).toEqual({
            newest: 0,
            before: 1,
        })
    })

    it("keeps column order for runs created at the same time, and needs two dated runs", () => {
        const same = "2026-11-05T19:33:17Z"
        expect(compareRoles([same, same])).toEqual({newest: 1, before: 0})
        expect(compareRoles([same, null, "not a date"])).toBeNull()
    })
})

describe("change of the newest run", () => {
    it("reads pass rates in points, from the rounded percents", () => {
        // 7 of 9 against 6 of 9: 78% against 67%.
        expect(compareChange(7 / 9, 6 / 9, "rate")).toEqual({kind: "points", points: 11})
        expect(compareChange(1, 0.75, "rate")).toEqual({kind: "points", points: 25})
        // From a pass rate of 0, where a relative change has no value.
        expect(compareChange(0.5, 0, "rate")).toEqual({kind: "points", points: 50})
        expect(compareChange(0.501, 0.499, "rate")).toEqual({kind: "none"})
    })

    it("reads values on 0 to 1 with 2 decimals and other values with 3 significant digits", () => {
        expect(compareChange(0.75, 0.83, "unit")).toEqual({kind: "difference", delta: -0.08})
        expect(compareChange(0.751, 0.749, "unit")).toEqual({kind: "none"})
        expect(compareChange(565, 261, "number")).toEqual({kind: "difference", delta: 304})
        expect(compareChange(4.1234, 4.1199, "number")).toEqual({kind: "none"})
    })

    it("reads the difference of the values as shown, across a rounding boundary", () => {
        // Shown as 0.51 and 0.50: the change is +0.01, never a signed zero.
        expect(compareChange(0.506, 0.504, "unit")).toEqual({kind: "difference", delta: 0.01})
        // Shown as 0.35 and 0.33.
        expect(compareChange(0.346, 0.334, "unit")).toEqual({kind: "difference", delta: 0.02})
        // Shown as 4.12 and 4.11.
        expect(compareChange(4.1151, 4.1149, "number")).toEqual({kind: "difference", delta: 0.01})
        // Both shown as 0.61 (toFixed, as formatMean prints them).
        expect(compareChange(0.615, 0.614, "unit")).toEqual({kind: "none"})
    })

    it("reads each summary tile in its own format", () => {
        // Counts are exact: 1239 against 1234 test cases.
        expect(compareChange(1239, 1234, "count")).toEqual({kind: "difference", delta: 5})
        expect(compareChange(1004, 1001, "count")).toEqual({kind: "difference", delta: 3})
        // A cost of $1 or more has 2 decimals; under $1, 3 significant digits.
        expect(compareChange(1.234, 1.226, "cost")).toEqual({kind: "none"})
        expect(compareChange(0.0042, 0.0061, "cost")).toEqual({kind: "difference", delta: -0.0019})
        // A duration of 1 s or more is shown as N.NN s.
        expect(compareChange(12_346, 12_336, "duration")).toEqual({kind: "difference", delta: 10})
        expect(compareChange(12_341, 12_339, "duration")).toEqual({kind: "none"})
        // Tokens: 1.1K and 1.1K are the same shown value.
        expect(compareChange(1104, 1096, "tokens")).toEqual({kind: "none"})
    })

    it("is missing when either run has no value", () => {
        expect(compareChange(null, 0.5, "rate")).toEqual({kind: "missing"})
        expect(compareChange(0.5, undefined, "unit")).toEqual({kind: "missing"})
        expect(compareChange(Number.NaN, 1, "number")).toEqual({kind: "missing"})
    })

    it("prints a difference with a plus or a minus sign", () => {
        expect(formatSigned(-0.08, (value) => value.toFixed(2))).toBe("−0.08")
        expect(formatSigned(304, (value) => formatTileAmount("duration", value))).toBe("+304 ms")
        expect(formatSigned(0.002, (value) => formatTileAmount("cost", value))).toBe("+$0.002")
    })
})

const stats = (raw: Record<string, unknown>) => normalizeMetricStats(raw)
const binaryStats = (passed: number, failed: number) =>
    stats({
        type: "binary",
        count: passed + failed,
        freq: [
            {value: true, count: passed},
            {value: false, count: failed},
        ],
    })
const invocation = (id: string, mean: number) => ({
    id,
    stats: stats({type: "numeric/continuous", count: 9, mean, sum: mean * 9}),
    statsAreRunWide: true,
})
const tilesOf = (passed: {passed: number; total: number} | null, cost: number | null) =>
    runTiles({
        status: "success",
        online: false,
        invocation: [
            invocation("duration", 300),
            ...(cost === null ? [] : [invocation("cost", cost)]),
        ],
        binaryStats: passed ? [binaryStats(passed.passed, passed.total - passed.passed)] : [],
        passed: passed ? {status: "ready", ...passed} : {status: "unavailable"},
        metricsPending: false,
    })

describe("compare summary rows", () => {
    it("has one row per tile with the tile of each run and the change", () => {
        const rows = buildCompareSummaryRows(
            [tilesOf({passed: 6, total: 9}, 0.01), tilesOf({passed: 7, total: 9}, null)],
            {newest: 1, before: 0},
        )
        expect(rows.map((row) => row.id)).toEqual([
            "testCases",
            "passed",
            "cost",
            "duration",
            "tokens",
            "errors",
        ])
        const row = (id: RunTile["id"]) => rows.find((candidate) => candidate.id === id)
        expect(
            row("passed")?.tiles.map((tile) => (tile && tile !== "loading" ? tile.value : tile)),
        ).toEqual(["67%", "78%"])
        expect(row("passed")?.change).toEqual({kind: "points", points: 11})
        // One of the two runs has no cost.
        expect(row("cost")?.change).toEqual({kind: "missing"})
        expect(row("duration")?.change).toEqual({kind: "none"})
        expect(row("testCases")?.change).toEqual({kind: "none"})
    })

    it("has no Passed row when no run has a binary metric, and waits for a run that loads", () => {
        const rows = buildCompareSummaryRows([tilesOf(null, 0.01), null], {newest: 1, before: 0})
        expect(rows.map((row) => row.id)).not.toContain("passed")
        expect(rows[0].tiles[1]).toBe("loading")
        expect(rows[0].change).toEqual({kind: "missing"})
    })

    it("has no Passed tile, not a loading one, for a loaded run without a binary metric", () => {
        const rows = buildCompareSummaryRows(
            [tilesOf({passed: 6, total: 9}, 0.01), tilesOf(null, 0.01)],
            {newest: 1, before: 0},
        )
        const passed = rows.find((row) => row.id === "passed")
        expect(passed?.tiles[1]).toBeNull()
        expect(passed?.change).toEqual({kind: "missing"})
    })
})

describe("compare evaluator rows", () => {
    const row = (
        evaluatorId: string,
        metrics: {id: string; label: string; stats: ReturnType<typeof stats>}[],
    ): EvaluatorRow => ({
        stepKey: `step-${evaluatorId}`,
        evaluatorId,
        name: evaluatorId === "ev-1" ? "Exact Match" : "Tone",
        metrics: metrics.map((entry) => ({
            ...entry,
            stepKey: `step-${evaluatorId}`,
            metricKey: entry.id,
            kind: entry.stats?.type?.startsWith("categorical")
                ? "categorical"
                : entry.stats?.type === "binary"
                  ? "binary"
                  : "numeric",
        })),
    })

    it("matches evaluators and metrics across runs, with one value per run and the change", () => {
        const older = [
            row("ev-1", [
                {id: "ev-1:success", label: "success", stats: binaryStats(3, 1)},
                {
                    id: "ev-1:score",
                    label: "score",
                    stats: stats({type: "numeric/continuous", mean: 0.83, min: 0, max: 1}),
                },
            ]),
        ]
        const newest = [
            row("ev-1", [
                {id: "ev-1:success", label: "success", stats: binaryStats(4, 0)},
                {
                    id: "ev-1:score",
                    label: "score",
                    stats: stats({type: "numeric/continuous", mean: 0.75, min: 0.5, max: 1}),
                },
            ]),
            row("ev-2", [
                {
                    id: "ev-2:tone",
                    label: "tone",
                    stats: stats({type: "categorical/single", freq: [{value: "formal", count: 2}]}),
                },
            ]),
        ]
        const rows = buildCompareEvaluatorRows([older, newest], {newest: 1, before: 0})
        expect(rows.map((entry) => [entry.key, entry.name])).toEqual([
            ["ev-1", "Exact Match"],
            ["ev-2", "Tone"],
        ])
        const [success, score] = rows[0].metrics
        expect(success.id).toBe("ev-1:success")
        expect(success.change).toEqual({kind: "points", points: 25})
        expect(score.unitScale).toBe(true)
        expect(score.change).toEqual({kind: "difference", delta: -0.08})
        // A run without the metric has no stats; a categorical metric has no change.
        const tone = rows[1].metrics[0]
        expect(tone.stats[0]).toBeNull()
        expect(tone.change).toBeNull()
    })

    it("reads a score off the 0 to 1 scale in any run with 3 significant digits", () => {
        const rating = (mean: number, max: number) => [
            row("ev-1", [
                {
                    id: "ev-1:rating",
                    label: "rating",
                    stats: stats({type: "numeric/continuous", mean, min: 0, max}),
                },
            ]),
        ]
        const [metricRow] = buildCompareEvaluatorRows([rating(0.9, 1), rating(3.5, 5)], {
            newest: 1,
            before: 0,
        })
        expect(metricRow.metrics[0].unitScale).toBe(false)
        const change = metricRow.metrics[0].change
        expect(change?.kind).toBe("difference")
        expect(change?.kind === "difference" && change.delta).toBeCloseTo(2.6)
    })
})

describe("scenario rows of compared runs", () => {
    interface Row {
        id: string
        testcase: string | null
        index: number
    }
    const row = (id: string, testcase: string | null, index: number): Row => ({id, testcase, index})
    const options = {testcaseOf: (r: Row) => r.testcase, indexOf: (r: Row) => r.index}

    it("puts each base row first, then the row of each compared run with the same test case", () => {
        const base = [row("a1", "tc-1", 1), row("a2", "tc-2", 2)]
        const other = [row("b2", "tc-2", 1), row("b1", "tc-1", 2)]
        expect(
            matchCompareRows(base, [{runId: "run-b", rows: other}], options).map((entry) => [
                entry.runId,
                entry.slot,
                entry.row?.id ?? null,
            ]),
        ).toEqual([
            [null, 0, "a1"],
            ["run-b", 1, "b1"],
            [null, 0, "a2"],
            ["run-b", 1, "b2"],
        ])
    })

    it("falls back to the position, and leaves the row empty when nothing matches", () => {
        const base = [row("a1", null, 1), row("a2", "tc-2", 2)]
        const other = [row("b1", "tc-9", 1)]
        const third = [] as Row[]
        expect(
            matchCompareRows(
                base,
                [
                    {runId: "run-b", rows: other},
                    {runId: "run-c", rows: third},
                ],
                options,
            ).map((entry) => entry.row?.id ?? null),
        ).toEqual(["a1", "b1", null, "a2", null, null])
    })
})

describe("column groups of compared runs", () => {
    const groups = [
        {kind: "testset", key: "testset:capitals"},
        {kind: "application", key: "application:geo-bot-2"},
        {kind: "evaluator", key: "evaluator:exact-match"},
        {kind: "evaluator", key: "evaluator:starts-uppercase"},
    ]

    const baseGroups = [
        {kind: "testset", key: "testset:capitals"},
        {kind: "application", key: "application:geo-bot"},
        {kind: "evaluator", key: "evaluator:answer-correctness"},
    ]

    it("uses the same group, else the only group of the same kind", () => {
        expect(
            matchCompareGroupKey({kind: "testset", key: "testset:capitals"}, groups, baseGroups),
        ).toBe("testset:capitals")
        expect(
            matchCompareGroupKey(
                {kind: "application", key: "application:geo-bot"},
                groups,
                baseGroups,
            ),
        ).toBe("application:geo-bot-2")
        expect(
            matchCompareGroupKey(
                {kind: "evaluator", key: "evaluator:answer-correctness"},
                groups,
                baseGroups,
            ),
        ).toBeNull()
    })

    it("does not give one compared group to two base groups of the same kind", () => {
        const base = [
            {kind: "evaluator", key: "evaluator:a"},
            {kind: "evaluator", key: "evaluator:b"},
        ]
        const compared = [{kind: "evaluator", key: "evaluator:a"}]
        expect(matchCompareGroupKey(base[0], compared, base)).toBe("evaluator:a")
        expect(matchCompareGroupKey(base[1], compared, base)).toBeNull()
    })
})

describe("configuration differences against the base run", () => {
    const base: RunConfigIdentity = {
        testsets: [{testsetId: "ts-1", revisionId: "tsr-1"}],
        applicationId: "app-1",
        revisionId: "rev-1",
        revisionVersion: 3,
        evaluators: [
            {id: "ev-1", version: 1},
            {id: "ev-2", version: 4},
        ],
    }
    const NONE = {testset: false, app: false, variant: false, evaluatorsMissing: false}

    it.each<[string, Partial<RunConfigIdentity>, Partial<RunConfigDiff>]>([
        ["the same configuration", {}, {...NONE, evaluators: {"ev-1": false, "ev-2": false}}],
        [
            "evaluators listed in another order",
            {
                evaluators: [
                    {id: "ev-2", version: 4},
                    {id: "ev-1", version: 1},
                ],
            },
            {...NONE, evaluators: {"ev-1": false, "ev-2": false}},
        ],
        ["another app", {applicationId: "app-2"}, {app: true, variant: false}],
        // A changed prompt is a new app revision.
        ["another prompt revision", {revisionId: "rev-2", revisionVersion: 4}, {variant: true}],
        ["another test set", {testsets: [{testsetId: "ts-2", revisionId: null}]}, {testset: true}],
        [
            "another revision of the same test set",
            {testsets: [{testsetId: "ts-1", revisionId: "tsr-2"}]},
            {testset: true},
        ],
        [
            "a test set revision missing on one side",
            {testsets: [{testsetId: "ts-1", revisionId: null}]},
            {testset: false},
        ],
        [
            "another evaluator version",
            {
                evaluators: [
                    {id: "ev-1", version: 2},
                    {id: "ev-2", version: 4},
                ],
            },
            {evaluators: {"ev-1": true, "ev-2": false}, evaluatorsMissing: false},
        ],
        [
            "an evaluator the base run lacks, and one this run lacks",
            {
                evaluators: [
                    {id: "ev-1", version: 1},
                    {id: "ev-3", version: 1},
                ],
            },
            {evaluators: {"ev-1": false, "ev-3": true}, evaluatorsMissing: true},
        ],
    ])("%s", (_label, patch, expected) => {
        expect(runConfigDiff({...base, ...patch}, base)).toMatchObject(expected)
    })
})
