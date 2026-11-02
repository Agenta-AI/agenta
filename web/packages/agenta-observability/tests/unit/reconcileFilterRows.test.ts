import {describe, expect, it} from "vitest"

import type {FieldConfig} from "../../src/filters/fieldAdapter"
import {reconcileFilterRows} from "../../src/filters/reconcileFilterRows"
import type {FilterItem} from "../../src/filters/types"

const fc = (over: Partial<FieldConfig>): FieldConfig =>
    ({
        optionKey: "x",
        baseField: "references",
        label: "X",
        type: "string",
        operatorIds: [],
        ...over,
    }) as FieldConfig

const APP = fc({
    optionKey: "application.id",
    label: "Application ID",
    referenceCategory: "application",
    referenceProperty: "id",
})
const EVAL = fc({
    optionKey: "evaluator.id",
    label: "Evaluator ID",
    referenceCategory: "evaluator",
    referenceProperty: "id",
})
const EVAL_SLUG = fc({
    optionKey: "evaluator.slug",
    label: "Evaluator Slug",
    referenceCategory: "evaluator",
    referenceProperty: "slug",
})
const MAP = new Map([
    [APP.optionKey, APP],
    [EVAL.optionKey, EVAL],
    [EVAL_SLUG.optionKey, EVAL_SLUG],
])

const permanentRow = (f: FieldConfig): FilterItem =>
    ({
        field: f.optionKey,
        selectedField: f.optionKey,
        selectedLabel: f.label,
        baseField: f.baseField,
        operator: "in",
        value: ["abc"],
        isPermanent: true,
    }) as FilterItem

const traceTypeRow = (operator: string, value: unknown): FilterItem =>
    ({field: "trace_type", selectedField: "trace_type", operator, value}) as FilterItem

describe("reconcileFilterRows", () => {
    it("is a no-op for non-evaluator workflows", () => {
        const rows = [permanentRow(EVAL), traceTypeRow("is", "invocation")]
        expect(reconcileFilterRows(rows, "application", MAP)).toBe(rows)
        expect(reconcileFilterRows(rows, null, MAP)).toBe(rows)
    })

    it("flips the permanent row to application when trace_type is invocation", () => {
        const out = reconcileFilterRows(
            [permanentRow(EVAL), traceTypeRow("is", "invocation")],
            "evaluator",
            MAP,
        )
        expect(out[0].selectedLabel).toBe("Application ID")
        expect(out[0].selectedField).toBe("application.id")
        expect(out[0].field).toBe("application.id")
    })

    it("flips to evaluator when trace_type is annotation", () => {
        const out = reconcileFilterRows(
            [permanentRow(APP), traceTypeRow("is", "annotation")],
            "evaluator",
            MAP,
        )
        expect(out[0].selectedLabel).toBe("Evaluator ID")
    })

    it("honours a negated operator by flipping the enum", () => {
        const out = reconcileFilterRows(
            [permanentRow(EVAL), traceTypeRow("is_not", "annotation")],
            "evaluator",
            MAP,
        )
        expect(out[0].selectedLabel).toBe("Application ID")

        const back = reconcileFilterRows(
            [permanentRow(APP), traceTypeRow("not_in", ["invocation"])],
            "evaluator",
            MAP,
        )
        expect(back[0].selectedLabel).toBe("Evaluator ID")
    })

    it("unwraps an array value for affirmative operators", () => {
        const out = reconcileFilterRows(
            [permanentRow(EVAL), traceTypeRow("in", ["invocation"])],
            "evaluator",
            MAP,
        )
        expect(out[0].selectedLabel).toBe("Application ID")
    })

    it("keeps the row untouched when trace_type is absent or unrecognised", () => {
        const rows = [permanentRow(EVAL)]
        expect(reconcileFilterRows(rows, "evaluator", MAP)).toBe(rows)

        const odd = [permanentRow(EVAL), traceTypeRow("is", "something-else")]
        expect(reconcileFilterRows(odd, "evaluator", MAP)).toBe(odd)
    })

    it("never touches non-permanent rows", () => {
        const user = {field: "evaluator.id", operator: "in", value: ["z"]} as FilterItem
        const out = reconcileFilterRows([user, traceTypeRow("is", "invocation")], "evaluator", MAP)
        expect(out[0]).toBe(user)
    })

    it("matches the target on referenceProperty, not just category", () => {
        const out = reconcileFilterRows(
            [permanentRow(EVAL_SLUG), traceTypeRow("is", "invocation")],
            "evaluator",
            MAP,
        )
        // no application/slug config exists, so the row is left alone
        expect(out[0].selectedLabel).toBe("Evaluator Slug")
    })

    it("preserves array length and order (the dialog mutates by index)", () => {
        const rows = [
            traceTypeRow("is", "invocation"),
            permanentRow(EVAL),
            {field: "span_type", operator: "is", value: "chat"} as FilterItem,
        ]
        const out = reconcileFilterRows(rows, "evaluator", MAP)
        expect(out).toHaveLength(3)
        expect(out[0].field).toBe("trace_type")
        expect(out[2].field).toBe("span_type")
    })

    it("never rewrites a row's value", () => {
        const out = reconcileFilterRows(
            [permanentRow(EVAL), traceTypeRow("is", "invocation")],
            "evaluator",
            MAP,
        )
        expect(out[0].value).toEqual(["abc"])
    })
})
