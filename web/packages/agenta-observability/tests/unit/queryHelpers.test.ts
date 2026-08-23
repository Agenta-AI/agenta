import {describe, expect, it} from "vitest"

import {
    buildAnnotationConditions,
    buildTraceQueryParams,
    mergeConditions,
    parseFilterJSON,
    toFilterString,
    type Condition,
} from "../../src/api/queryHelpers"
import type {Filter, SortResult} from "../../src/core/types"

const conditionsOf = (params: Record<string, unknown>): Condition[] =>
    JSON.parse(String(params.filter)).conditions

describe("buildTraceQueryParams", () => {
    it("maps the chat tab onto the span focus", () => {
        expect(buildTraceQueryParams([], undefined, "chat").params.focus).toBe("span")
        expect(buildTraceQueryParams([], undefined, "trace").params.focus).toBe("trace")
    })

    it("omits size unless a limit is given", () => {
        expect(buildTraceQueryParams([], undefined, "trace").params.size).toBeUndefined()
        expect(buildTraceQueryParams([], undefined, "trace", 25).params.size).toBe(25)
    })

    it("rewrites an attributes.* field into field+key", () => {
        const filters = [
            {field: "attributes.ag.foo", operator: "is", value: "x"},
        ] as unknown as Filter[]
        expect(conditionsOf(buildTraceQueryParams(filters, undefined, "trace").params)).toEqual([
            {field: "attributes", key: "ag.foo", operator: "is", value: "x"},
        ])
    })

    it("inverts STATUS_CODE_OK into a negated error match", () => {
        const ok = [{field: "status_code", operator: "is", value: "STATUS_CODE_OK"}] as Filter[]
        expect(conditionsOf(buildTraceQueryParams(ok, undefined, "trace").params)).toEqual([
            {field: "status_code", operator: "is_not", value: "STATUS_CODE_ERROR"},
        ])

        const notOk = [
            {field: "status_code", operator: "is_not", value: "STATUS_CODE_OK"},
        ] as Filter[]
        expect(conditionsOf(buildTraceQueryParams(notOk, undefined, "trace").params)).toEqual([
            {field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"},
        ])
    })

    it("lifts has_annotation out of the conditions and reports its operator", () => {
        const filters = [
            {field: "has_annotation", operator: "in", value: {evaluator: "exact"}},
            {field: "span_type", operator: "is", value: "chat"},
        ] as unknown as Filter[]
        const result = buildTraceQueryParams(filters, undefined, "trace")

        expect(result.isHasAnnotationSelected).toBe(0)
        expect(result.hasAnnotationOperator).toBe("in")
        expect(result.hasAnnotationConditions).toEqual([
            {
                field: "references",
                operator: "in",
                value: [{slug: "exact", "attributes.key": "evaluator"}],
            },
        ])
        expect(conditionsOf(result.params)).toEqual([
            {field: "span_type", operator: "is", value: "chat"},
        ])
    })

    it("reports -1 when no has_annotation filter is present", () => {
        expect(buildTraceQueryParams([], undefined, "trace").isHasAnnotationSelected).toBe(-1)
    })

    it("reads the window from a standard sort and from a custom range", () => {
        const standard = {type: "standard", sorted: "2026-01-01T00:00:00"} as SortResult
        expect(buildTraceQueryParams([], standard, "trace").params.oldest).toBe(
            "2026-01-01T00:00:00",
        )

        const custom = {
            type: "custom",
            sorted: "",
            customRange: {startTime: "S", endTime: "E"},
        } as SortResult
        const params = buildTraceQueryParams([], custom, "trace").params
        expect(params).toMatchObject({oldest: "S", newest: "E"})
    })
})

describe("buildAnnotationConditions", () => {
    it("emits an evaluator reference and a feedback attribute", () => {
        expect(
            buildAnnotationConditions(
                {evaluator: "exact", feedback: {field: "score", operator: "gte", value: 3}},
                "in",
            ),
        ).toEqual([
            {
                field: "references",
                operator: "in",
                value: [{slug: "exact", "attributes.key": "evaluator"}],
            },
            {field: "attributes", key: "ag.data.outputs.score", operator: "gte", value: 3},
        ])
    })

    it("unwraps an array value and tolerates an empty one", () => {
        expect(buildAnnotationConditions([{evaluator: "exact"}], "in")).toHaveLength(1)
        expect(buildAnnotationConditions(undefined, "in")).toEqual([])
    })
})

describe("mergeConditions", () => {
    const base = toFilterString([{field: "span_type", operator: "is", value: "chat"}])

    it("appends new conditions and dedupes identical ones", () => {
        const merged = mergeConditions(base, [
            {field: "span_type", operator: "is", value: "chat"},
            {field: "trace_id", operator: "in", value: ["a"]},
        ])
        expect(parseFilterJSON(merged)).toEqual([
            {field: "span_type", operator: "is", value: "chat"},
            {field: "trace_id", operator: "in", value: ["a"]},
        ])
    })

    it("drops an `in` condition with an empty value list", () => {
        const merged = mergeConditions(base, [{field: "trace_id", operator: "in", value: []}])
        expect(parseFilterJSON(merged)).toHaveLength(1)
    })

    it("survives an unparseable base filter", () => {
        expect(parseFilterJSON("not json")).toEqual([])
        expect(parseFilterJSON(undefined)).toEqual([])
    })
})
