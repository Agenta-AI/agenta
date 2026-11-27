import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {describe, expect, it} from "vitest"

import {rowNounKey} from "@/features/evaluation-run/focus/scenarioNoun"
import type {ScenarioCell, ScenarioRow} from "@/features/evaluation-run/scenarios/scenarioColumns"
import {
    evaluatorFailures,
    scenarioColumnModel,
    sortScenarioRows,
} from "@/features/evaluation-run/scenarios/scenarioTableColumns"
import {
    DEFAULT_SCENARIO_VIEW,
    defaultHiddenKeys,
    hiddenKeys,
    labelColumnKey,
    moveKey,
    orderedByKeys,
    parseScenarioView,
    setColumnsHidden,
    withDensity,
} from "@/features/evaluation-run/scenarios/scenarioViewDefaults"

const group = (
    kind: "testset" | "application" | "evaluator",
    key: string,
    names: string[],
): RunColumnGroup =>
    ({
        group: {kind, key, label: key, slug: key, refs: null},
        columns: names.map((name) => ({name, kind, groupSlug: key})),
    }) as unknown as RunColumnGroup

const GROUPS = [
    group("testset", "ts", ["website_text", "company", "country"]),
    group("application", "app", ["outputs"]),
    group("evaluator", "tone", ["success", "score", "reason"]),
    group("evaluator", "facts", ["success"]),
]

const LONG = Array.from({length: 20}, (_, line) => `Line ${line} of the scraped page.`).join("\n")

let next = 0
function row(values: {
    company?: string | null
    tone?: boolean
    score?: number | null
    facts?: boolean
}): ScenarioRow {
    next += 1
    const cell = (kind: ScenarioCell["kind"], name: string, value: unknown): ScenarioCell => ({
        name,
        kind,
        path: name,
        value,
    })
    return {
        index: next,
        scenario: {id: `sc-${next}`, status: "success"},
        testcaseId: null,
        testsetId: null,
        cells: {
            ts: [
                cell("testset", "website_text", LONG),
                cell("testset", "company", values.company ?? null),
                cell("testset", "country", "France"),
            ],
            app: [cell("application", "outputs", {recommendation: "see"})],
            tone: [
                cell("evaluator", "success", values.tone ?? null),
                cell("evaluator", "score", values.score ?? null),
                cell("evaluator", "reason", "The tone fits."),
            ],
            facts: [cell("evaluator", "success", values.facts ?? null)],
        },
        valuesFailed: false,
        invocation: null,
        errors: {},
        otherErrors: [],
        columns: [],
        metrics: {},
        steps: {},
    } as unknown as ScenarioRow
}

const rows = [
    row({company: "Nimbusly", tone: true, score: 0.4, facts: false}),
    row({company: "Halcyon", tone: false, score: null, facts: false}),
    row({company: "Vantor", tone: true, score: 0.9, facts: true}),
]
const model = scenarioColumnModel(GROUPS, rows, {})

describe("scenario table columns", () => {
    it("Names the shape of each value column and the kind of each metric from the loaded rows", () => {
        expect(model.fields.map((column) => [column.name, column.section, column.shape])).toEqual([
            ["website_text", "testcase", "text-long"],
            ["company", "testcase", "text-short"],
            ["country", "testcase", "text-short"],
            ["outputs", "output", "object-flat"],
        ])
        // The one output of an app has no name of its own: the table calls it "Output".
        expect(model.fields[3].label).toBeNull()
        expect(model.evaluators[0].columns.map((column) => column.metricKind)).toEqual([
            "binary",
            "numeric",
            "text",
        ])
        expect(model.metrics.map((column) => column.label)).toEqual([
            "Cost",
            "Duration",
            "Tokens",
            "Errors",
        ])
    })

    it("The default label column is the first short text column of the test case", () => {
        expect(labelColumnKey(model, DEFAULT_SCENARIO_VIEW)).toBe("ts::company")
        expect(labelColumnKey(model, {...DEFAULT_SCENARIO_VIEW, label: "ts::country"})).toBe(
            "ts::country",
        )
        expect(labelColumnKey(model, {...DEFAULT_SCENARIO_VIEW, label: null})).toBeNull()
        // A saved label that is no longer a column falls back to the default.
        expect(labelColumnKey(model, {...DEFAULT_SCENARIO_VIEW, label: "ts::gone"})).toBe(
            "ts::company",
        )
    })

    it("Text metrics are hidden by default; Compact also hides long text and the output", () => {
        expect([...defaultHiddenKeys(model, "comfortable")]).toEqual(["tone::reason"])
        expect([...defaultHiddenKeys(model, "compact")].sort()).toEqual([
            "app::outputs",
            "tone::reason",
            "ts::website_text",
        ])
    })

    it("Hiding and showing keeps only the changes to the defaults", () => {
        let view = setColumnsHidden(DEFAULT_SCENARIO_VIEW, model, ["tone::reason"], false)
        view = setColumnsHidden(view, model, ["facts::success"], true)
        expect(view.show).toEqual(["tone::reason"])
        expect(view.hide).toEqual(["facts::success"])
        expect(hiddenKeys(model, view).has("tone::reason")).toBe(false)
        expect(hiddenKeys(model, view).has("facts::success")).toBe(true)
        // Back to the default: nothing left to keep.
        view = setColumnsHidden(view, model, ["tone::reason", "facts::success"], true)
        view = setColumnsHidden(view, model, ["facts::success"], false)
        expect(view.show).toEqual([])
        expect(view.hide).toEqual([])
    })

    it("A new density resets the widths and lets long text and outputs follow it again", () => {
        const shown = setColumnsHidden(
            {...DEFAULT_SCENARIO_VIEW, widths: {"ts::company": 300}},
            model,
            ["app::outputs", "facts::success"],
            false,
        )
        const hidden = setColumnsHidden(shown, model, ["facts::success"], true)
        const comfortable = withDensity(hidden, model, "comfortable")
        expect(comfortable.widths).toEqual({})
        expect(comfortable.show).toEqual([])
        expect(comfortable.hide).toEqual(["facts::success"])
        expect(hiddenKeys(model, comfortable).has("app::outputs")).toBe(false)
        expect(
            hiddenKeys(model, withDensity(comfortable, model, "compact")).has("app::outputs"),
        ).toBe(true)
    })

    it("A saved view is read field by field; anything unknown takes the default", () => {
        expect(parseScenarioView("nonsense")).toEqual(DEFAULT_SCENARIO_VIEW)
        expect(
            parseScenarioView({
                density: "comfortable",
                rowHeight: "tall",
                label: null,
                hide: ["a", 3],
                widths: {a: 120, b: "wide", c: -4},
                orderByFailures: true,
            }),
        ).toEqual({
            ...DEFAULT_SCENARIO_VIEW,
            density: "comfortable",
            rowHeight: "tall",
            label: null,
            hide: ["a"],
            widths: {a: 120},
            orderByFailures: true,
        })
        expect(parseScenarioView({density: "huge"}).density).toBe("compact")
    })

    it("Columns follow the saved order; columns the order does not name keep their own order", () => {
        const items = [{key: "a"}, {key: "b"}, {key: "c"}, {key: "d"}]
        expect(orderedByKeys(items, ["c", "a"]).map((item) => item.key)).toEqual([
            "c",
            "a",
            "b",
            "d",
        ])
        expect(moveKey(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"])
        expect(moveKey(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"])
    })

    it("Sorting orders the loaded rows; rows with no value stay last both ways", () => {
        const score = model.evaluators[0].columns[1]
        expect(sortScenarioRows(rows, score, "descending").map((entry) => entry.index)).toEqual([
            rows[2].index,
            rows[0].index,
            rows[1].index,
        ])
        expect(sortScenarioRows(rows, score, "ascending").map((entry) => entry.index)).toEqual([
            rows[0].index,
            rows[2].index,
            rows[1].index,
        ])
        const company = model.fields[1]
        expect(
            sortScenarioRows(rows, company, "ascending").map((entry) => entry.cells.ts[1].value),
        ).toEqual(["Halcyon", "Nimbusly", "Vantor"])
    })

    it("An evaluator's failures count the rows where one of its true or false metrics is false", () => {
        expect(evaluatorFailures(rows, model.evaluators[0])).toBe(1)
        expect(evaluatorFailures(rows, model.evaluators[1])).toBe(2)
    })

    it("The row word of a sentence follows the run kind", () => {
        expect(rowNounKey("auto")).toBe("TestCase")
        expect(rowNounKey("human")).toBe("Scenario")
        expect(rowNounKey("online")).toBe("Trace")
    })
})
