/**
 * The compare rules the /m run page uses: which runs the URL compares, how the picker filters
 * candidates, how one metric is found in every run, the delta under a compared value, how bars of
 * several runs share a chart, and how scenario rows and column groups of compared runs line up.
 */
import {describe, expect, it} from "vitest"

import {
    compareDelta,
    compareMetricKey,
    compareRunIds,
    compareStatusCounts,
    filterCompareRuns,
    matchCompareGroupKey,
    matchCompareRows,
    mergeCompareBars,
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

describe("delta against the base run", () => {
    it.each([
        [0, 100, "-100%", "negative"],
        [100, 100, "0%", "neutral"],
        [56.5, 50, "+13%", "positive"],
        [10, 0, "-", "neutral"],
        [null, 100, "-", "neutral"],
        [50, undefined, "-", "neutral"],
    ])("%s against %s reads %s", (value, base, text, tone) => {
        expect(compareDelta(value, base)).toEqual({text, tone})
    })
})

describe("bars of several runs", () => {
    it("puts each category once with the value of every run", () => {
        expect(
            mergeCompareBars([
                [
                    {category: "True", values: {a: 100}},
                    {category: "False", values: {a: 0}},
                ],
                [
                    {category: "True", values: {b: 0}},
                    {category: "False", values: {b: 100}},
                ],
            ]),
        ).toEqual([
            {category: "True", values: {a: 100, b: 0}},
            {category: "False", values: {a: 0, b: 100}},
        ])
    })

    it("sorts numeric ranges by their start and keeps other labels in first-seen order", () => {
        expect(
            mergeCompareBars([
                [{category: "0.5–1", values: {a: 2}}],
                [
                    {category: "0–0.5", values: {b: 1}},
                    {category: "0.5–1", values: {b: 3}},
                ],
            ]).map((datum) => datum.category),
        ).toEqual(["0–0.5", "0.5–1"])
        expect(
            mergeCompareBars([
                [{category: "Paris", values: {a: 2}}],
                [{category: "Lyon", values: {b: 1}}],
            ]).map((datum) => datum.category),
        ).toEqual(["Paris", "Lyon"])
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

    it("uses the same group, else the only group of the same kind", () => {
        expect(matchCompareGroupKey({kind: "testset", key: "testset:capitals"}, groups)).toBe(
            "testset:capitals",
        )
        expect(
            matchCompareGroupKey({kind: "application", key: "application:geo-bot"}, groups),
        ).toBe("application:geo-bot-2")
        expect(
            matchCompareGroupKey({kind: "evaluator", key: "evaluator:answer-correctness"}, groups),
        ).toBeNull()
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
