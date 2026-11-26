/**
 * The scenario table logic copied from the old app: the filter rules, the per-scenario metric
 * values and their cell text, and the column settings.
 */
import {describe, expect, it} from "vitest"

import {columnGroupCheck, setColumnsVisible} from "../../src/evaluationRun/core/columnVisibility"
import {formatMetricValue} from "../../src/evaluationRun/core/metricFormat"
import {
    metricCellText,
    scenarioMetricStats,
    stepMetricStats,
} from "../../src/evaluationRun/core/scenarioMetrics"
import {
    filterValueFromText,
    filterValueToText,
    inferFilterValueType,
    isConditionComplete,
    isScenarioFilterActive,
    shouldReadMoreForFilter,
    toEffectiveFilter,
} from "../../src/evaluationRun/etl/scenarioFilter"

const COST = "attributes.ag.metrics.costs.cumulative.total"
const DURATION = "attributes.ag.metrics.duration.cumulative"
const TOKENS = "attributes.ag.metrics.tokens.cumulative.total"
const ERRORS = "attributes.ag.metrics.errors.cumulative"

const STEPS = [
    {key: "ts", type: "input"},
    {key: "ev", type: "annotation"},
    {key: "app", type: "invocation"},
]

const one = (value: number) => ({type: "numeric/continuous", count: 1, mean: value, sum: value})

describe("scenario filter", () => {
    const success = {groupKind: "evaluator" as const, columnName: "success", op: "eq" as const}

    it("A condition counts once it has a column and a value", () => {
        expect(isConditionComplete({...success, value: true})).toBe(true)
        expect(isConditionComplete({...success, value: false})).toBe(true)
        expect(isConditionComplete({...success, value: 0})).toBe(true)
        expect(isConditionComplete({...success, value: ""})).toBe(false)
        expect(isConditionComplete({...success, value: undefined})).toBe(false)
        expect(isConditionComplete({...success, columnName: "", value: true})).toBe(false)
        expect(isConditionComplete({...success, op: "in", value: []})).toBe(false)
        expect(isConditionComplete({...success, op: "in", value: [1]})).toBe(true)
    })

    it("A half-built condition is left out of the applied filter", () => {
        const group = {
            op: "or" as const,
            conditions: [
                {...success, value: true},
                {...success, columnName: "score", value: ""},
            ],
        }
        expect(toEffectiveFilter(group)).toEqual({
            op: "or",
            conditions: [{...success, value: true}],
        })
        expect(isScenarioFilterActive(group)).toBe(true)
        expect(isScenarioFilterActive({op: "and", conditions: [group.conditions[1]]})).toBe(false)
    })

    it("A column's type comes from the values the scenarios hold", () => {
        const flag = {type: "binary", count: 1, freq: [{value: false, count: 1}]}
        expect(inferFilterValueType([flag, true, undefined])).toBe("boolean")
        expect(inferFilterValueType([one(0.5), 3])).toBe("number")
        expect(inferFilterValueType(["Paris", null, ""])).toBe("string")
        expect(inferFilterValueType([])).toBeUndefined()
        expect(inferFilterValueType([true, 3])).toBeUndefined()
    })

    it("Typed text becomes a value of the column's type", () => {
        expect(filterValueFromText("0.5", "number", "gt")).toBe(0.5)
        expect(filterValueFromText("abc", "number", "gt")).toBe("")
        expect(filterValueFromText(" ", "number", "eq")).toBe("")
        expect(filterValueFromText("false", "boolean", "eq")).toBe(false)
        expect(filterValueFromText(" Paris ", "string", "eq")).toBe("Paris")
        expect(filterValueFromText("1, 2,x,", "number", "in")).toEqual([1, 2])
        expect(filterValueFromText("Paris, Lima", "unknown", "nin")).toEqual(["Paris", "Lima"])
        expect(filterValueToText([1, 2])).toBe("1, 2")
        expect(filterValueToText(undefined)).toBe("")
    })

    it("The table reads more pages only while a filter has too few matches", () => {
        const base = {active: true, matches: 2, hasMore: true, busy: false}
        expect(shouldReadMoreForFilter(base)).toBe(true)
        expect(shouldReadMoreForFilter({...base, active: false})).toBe(false)
        expect(shouldReadMoreForFilter({...base, matches: 30})).toBe(false)
        expect(shouldReadMoreForFilter({...base, hasMore: false})).toBe(false)
        expect(shouldReadMoreForFilter({...base, busy: true})).toBe(false)
    })
})

describe("scenario metrics", () => {
    it("Cost, duration, tokens and errors come from the app step", () => {
        const metrics = [
            {
                data: {
                    ev: {[COST]: one(0.5), [TOKENS]: one(900)},
                    app: {
                        [COST]: one(0.000012),
                        [DURATION]: one(522),
                        [TOKENS]: one(128),
                        [ERRORS]: one(0),
                    },
                },
            },
        ]
        const text = (key: string) => metricCellText(key, scenarioMetricStats(metrics, STEPS, key))
        expect(text(COST)).toBe("$0.000012")
        expect(text(DURATION)).toBe("522ms")
        expect(text(TOKENS)).toBe("128")
        expect(text(ERRORS)).toBe("0")
    })

    it("A run without an app step reads the first step that has the metric", () => {
        const metrics = [{data: {query: {[TOKENS]: 1500}}}, {data: {ev: {[TOKENS]: one(40)}}}]
        const steps = [
            {key: "query", type: "input"},
            {key: "ev", type: "annotation"},
        ]
        expect(metricCellText(TOKENS, scenarioMetricStats(metrics, steps, TOKENS))).toBe("1.5K")
    })

    it("A step's own metrics come from that step only, not from the app call", () => {
        const metrics = [
            {data: {app: {[COST]: one(0.000012), [DURATION]: one(522)}}},
            {data: {ev: {[DURATION]: one(887), [TOKENS]: 126}}},
        ]
        const text = (step: string, key: string) =>
            formatMetricValue(key, stepMetricStats(metrics, step, key))
        expect(text("ev", DURATION)).toBe("887ms")
        expect(text("ev", TOKENS)).toBe("126")
        expect(stepMetricStats(metrics, "ev", COST)).toBeNull()
        expect(text("app", COST)).toBe("$0.000012")
        expect(stepMetricStats(metrics, "ts", DURATION)).toBeNull()
        expect(stepMetricStats([{data: null}], "ev", DURATION)).toBeNull()
    })

    it("A metric no step reports has no value and prints a dash", () => {
        expect(scenarioMetricStats([{data: {app: {}}}, {data: null}], STEPS, COST)).toBeNull()
        expect(metricCellText(COST, null)).toBe("—")
    })

    it("An evaluator value prints as the old app prints it", () => {
        const path = "attributes.ag.data.outputs.score"
        expect(metricCellText(path, 0.66666)).toBe("0.667")
        expect(metricCellText(path, one(0.25))).toBe("0.25")
        expect(metricCellText(path, true)).toBe("true")
        expect(metricCellText(path, "Looks right")).toBe("Looks right")
        expect(
            metricCellText(path, {type: "binary", count: 1, freq: [{value: false, count: 1}]}),
        ).toBe("false")
        // Not a stat blob: the caller draws it as data.
        expect(metricCellText(path, {label: "good"})).toBeNull()
    })
})

describe("column settings", () => {
    it("A group is checked, half checked or unchecked by its hidden columns", () => {
        const keys = ["a", "b"]
        expect(columnGroupCheck(keys, new Set())).toBe(true)
        expect(columnGroupCheck(keys, new Set(["a"]))).toBe("indeterminate")
        expect(columnGroupCheck(keys, new Set(["a", "b", "z"]))).toBe(false)
    })

    it("Showing and hiding columns returns a new set", () => {
        const hidden = new Set(["a"])
        const next = setColumnsVisible(hidden, ["b", "c"], false)
        expect([...next].sort()).toEqual(["a", "b", "c"])
        expect([...setColumnsVisible(next, ["a", "b"], true)]).toEqual(["c"])
        expect([...hidden]).toEqual(["a"])
    })
})
