/**
 * buildFilterSchema — derives the filterable fields the Phase 2 / T4
 * filter UI offers (decision D8).
 *
 * Covers field derivation, the schema-only value-type heuristic, the
 * type-matched operator sets, the `resolveValueType` refinement seam, and
 * deduplication.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {buildFilterSchema, operatorsForType} from "../filterSchema"
import type {RunSchema} from "../resolveMappings"

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
        for (const op of ["lt", "lte", "gt", "gte"]) assert.ok(ops.includes(op as never))
    })

    it("unknown / boolean withhold ordered comparisons", () => {
        for (const op of ["lt", "gt"]) {
            assert.equal(operatorsForType("unknown").includes(op as never), false)
            assert.equal(operatorsForType("boolean").includes(op as never), false)
        }
    })

    it("returns a fresh array (callers may mutate)", () => {
        const a = operatorsForType("number")
        a.pop()
        assert.notEqual(a.length, operatorsForType("number").length)
    })
})

describe("buildFilterSchema", () => {
    it("returns an empty schema for a null run schema", () => {
        assert.deepEqual(buildFilterSchema(null), {fields: []})
    })

    it("emits one field per mapped column", () => {
        const {fields} = buildFilterSchema(SCHEMA)
        assert.deepEqual(fields.map((f) => f.columnName).sort(), ["Cost", "question", "success"])
    })

    it("types metrics columns as number, others as unknown", () => {
        const {fields} = buildFilterSchema(SCHEMA)
        const cost = fields.find((f) => f.columnName === "Cost")
        const success = fields.find((f) => f.columnName === "success")
        assert.equal(cost?.valueType, "number")
        assert.equal(success?.valueType, "unknown")
        assert.ok(cost?.operators.includes("gt"))
        assert.equal(success?.operators.includes("gt"), false)
    })

    it("carries the targeting triple + labels", () => {
        const {fields} = buildFilterSchema(SCHEMA)
        const success = fields.find((f) => f.columnName === "success")
        assert.equal(success?.groupKind, "evaluator")
        assert.equal(success?.groupSlug, "exact-match")
        assert.equal(success?.label, "success")
        assert.ok(success?.groupLabel)
    })

    it("resolveValueType refines a field's type + operators", () => {
        const {fields} = buildFilterSchema(SCHEMA, {
            resolveValueType: (f) => (f.columnName === "success" ? "boolean" : undefined),
        })
        const success = fields.find((f) => f.columnName === "success")
        assert.equal(success?.valueType, "boolean")
        assert.deepEqual(success?.operators, ["eq", "ne"])
        // Untouched fields keep the schema-only default.
        assert.equal(fields.find((f) => f.columnName === "Cost")?.valueType, "number")
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
        assert.equal(fields.filter((f) => f.columnName === "question").length, 1)
    })
})
