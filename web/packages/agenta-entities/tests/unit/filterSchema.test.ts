/**
 * buildFilterSchema — derives the filterable fields the Phase 2 / T4
 * filter UI offers (decision D8).
 *
 * Covers field derivation, the schema-only value-type heuristic, the
 * type-matched operator sets, the `resolveValueType` refinement seam, and
 * deduplication.
 */

import {describe, expect, it} from "vitest"

import {buildFilterSchema, operatorsForType} from "../../src/evaluationRun/etl/filterSchema"
import type {RunSchema} from "../../src/evaluationRun/etl/resolveMappings"

const SCHEMA: RunSchema = {
    steps: [
        {key: "in", type: "input", references: {testset: {id: "t1", slug: "ts"}}},
        {key: "ev", type: "annotation", references: {evaluator: {id: "e1", slug: "exact-match"}}},
    ],
    mappings: [
        {column: {kind: "input", name: "question"}, step: {key: "in", path: "data.question"}},
        {column: {kind: "annotation", name: "success"}, step: {key: "ev", path: "out"}},
        // Metrics path overrides step-type grouping → "metrics" group.
        {
            column: {kind: "metric", name: "Cost"},
            step: {key: "ev", path: "attributes.ag.metrics.cost"},
        },
    ],
}

describe("operatorsForType", () => {
    it("number gets ordered comparisons", () => {
        const ops = operatorsForType("number")
        for (const op of ["lt", "lte", "gt", "gte"]) expect(ops.includes(op as never)).toBeTruthy()
    })

    it("unknown / boolean withhold ordered comparisons", () => {
        for (const op of ["lt", "gt"]) {
            expect(operatorsForType("unknown").includes(op as never)).toBe(false)
            expect(operatorsForType("boolean").includes(op as never)).toBe(false)
        }
    })

    it("returns a fresh array (callers may mutate)", () => {
        const a = operatorsForType("number")
        a.pop()
        expect(a.length).not.toBe(operatorsForType("number").length)
    })
})

describe("buildFilterSchema", () => {
    it("returns an empty schema for a null run schema", () => {
        expect(buildFilterSchema(null)).toEqual({fields: []})
    })

    it("emits one field per mapped column", () => {
        const {fields} = buildFilterSchema(SCHEMA)
        expect(fields.map((f) => f.columnName).sort()).toEqual(["Cost", "question", "success"])
    })

    it("types metrics columns as number, others as unknown", () => {
        const {fields} = buildFilterSchema(SCHEMA)
        const cost = fields.find((f) => f.columnName === "Cost")
        const success = fields.find((f) => f.columnName === "success")
        expect(cost?.valueType).toBe("number")
        expect(success?.valueType).toBe("unknown")
        expect(cost?.operators.includes("gt")).toBeTruthy()
        expect(success?.operators.includes("gt")).toBe(false)
    })

    it("carries the targeting triple + labels", () => {
        const {fields} = buildFilterSchema(SCHEMA)
        const success = fields.find((f) => f.columnName === "success")
        expect(success?.groupKind).toBe("evaluator")
        expect(success?.groupSlug).toBe("exact-match")
        expect(success?.label).toBe("success")
        expect(success?.groupLabel).toBeTruthy()
    })

    it("resolveValueType refines a field's type + operators", () => {
        const {fields} = buildFilterSchema(SCHEMA, {
            resolveValueType: (f) => (f.columnName === "success" ? "boolean" : undefined),
        })
        const success = fields.find((f) => f.columnName === "success")
        expect(success?.valueType).toBe("boolean")
        expect(success?.operators).toEqual(["eq", "ne"])
        // Untouched fields keep the schema-only default.
        expect(fields.find((f) => f.columnName === "Cost")?.valueType).toBe("number")
    })

    it("deduplicates identical (groupKind, groupSlug, columnName) triples", () => {
        const dupSchema: RunSchema = {
            steps: SCHEMA.steps,
            mappings: [
                ...SCHEMA.mappings,
                // Same column name + same step as an existing mapping.
                {
                    column: {kind: "input", name: "question"},
                    step: {key: "in", path: "data.question"},
                },
            ],
        }
        const {fields} = buildFilterSchema(dupSchema)
        expect(fields.filter((f) => f.columnName === "question").length).toBe(1)
    })
})
