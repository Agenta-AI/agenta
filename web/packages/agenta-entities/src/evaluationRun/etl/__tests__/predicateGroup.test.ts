/**
 * Multi-predicate AND/OR filtering (Phase 2 / T4 — decision D8).
 *
 * Covers the pure predicate-evaluation core: single predicate, flat AND/OR
 * groups, the `RowFilter` dispatch, the row-level `matchesRowFilter`
 * convenience, the `makePredicateGroupFilter` pipeline transform, and the
 * `predicateToEntitySlices` union for group inputs.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import type {Chunk} from "../../../etl/core/types"
import type {HydratedScenarioRow} from "../hydrateScenariosTransform"
import {predicateToEntitySlices} from "../predicateToEntitySlices"
import type {ColumnGroup, ResolvedColumn, RunSchema} from "../resolveMappings"
import {
    evaluatePredicateGroup,
    evaluateRowFilter,
    evaluateRowPredicate,
    isPredicateGroup,
    makePredicateGroupFilter,
    matchesRowFilter,
    type PredicateGroup,
    type RowPredicate,
} from "../rowPredicateFilter"

// A resolved column fixture — the shape `resolveMappings` emits.
function col(opts: {
    name: string
    kind: ColumnGroup["kind"]
    slug?: string | null
    value: unknown
}): ResolvedColumn {
    const group: ColumnGroup = {
        kind: opts.kind,
        slug: opts.slug ?? null,
        label: opts.kind,
        key: `${opts.kind}:${opts.slug ?? "x"}`,
        refs: null,
    }
    return {
        name: opts.name,
        kind: opts.kind,
        stepKey: "step",
        stepType: opts.kind,
        path: "",
        value: opts.value,
        source: "metric",
        group,
    }
}

const COLS: ResolvedColumn[] = [
    col({name: "success", kind: "evaluator", slug: "exact-match", value: true}),
    col({name: "score", kind: "evaluator", slug: "llm-judge", value: 0.9}),
    col({name: "country", kind: "testset", slug: "ts", value: "US"}),
]

// =============================================================================
// evaluateRowPredicate — one clause
// =============================================================================

describe("evaluateRowPredicate", () => {
    it("eq / ne", () => {
        assert.equal(
            evaluateRowPredicate(
                {groupKind: "evaluator", columnName: "success", op: "eq", value: true},
                COLS,
            ),
            true,
        )
        assert.equal(
            evaluateRowPredicate(
                {groupKind: "evaluator", columnName: "success", op: "ne", value: true},
                COLS,
            ),
            false,
        )
    })

    it("numeric comparisons", () => {
        const p = (op: RowPredicate["op"], value: number): RowPredicate => ({
            groupKind: "evaluator",
            columnName: "score",
            op,
            value,
        })
        assert.equal(evaluateRowPredicate(p("gt", 0.8), COLS), true)
        assert.equal(evaluateRowPredicate(p("gte", 0.9), COLS), true)
        assert.equal(evaluateRowPredicate(p("lt", 0.8), COLS), false)
        assert.equal(evaluateRowPredicate(p("lte", 0.9), COLS), true)
    })

    it("in / nin", () => {
        assert.equal(
            evaluateRowPredicate(
                {groupKind: "testset", columnName: "country", op: "in", value: ["US", "CA"]},
                COLS,
            ),
            true,
        )
        assert.equal(
            evaluateRowPredicate(
                {groupKind: "testset", columnName: "country", op: "nin", value: ["US", "CA"]},
                COLS,
            ),
            false,
        )
    })

    it("narrows by groupSlug when set", () => {
        // Same column name across two evaluators — slug disambiguates.
        const cols = [
            col({name: "success", kind: "evaluator", slug: "a", value: true}),
            col({name: "success", kind: "evaluator", slug: "b", value: false}),
        ]
        assert.equal(
            evaluateRowPredicate(
                {
                    groupKind: "evaluator",
                    groupSlug: "b",
                    columnName: "success",
                    op: "eq",
                    value: false,
                },
                cols,
            ),
            true,
        )
    })

    it("a missing column fails eq but passes ne (compares against undefined)", () => {
        const p = (op: RowPredicate["op"]): RowPredicate => ({
            groupKind: "evaluator",
            columnName: "does-not-exist",
            op,
            value: true,
        })
        assert.equal(evaluateRowPredicate(p("eq"), COLS), false)
        assert.equal(evaluateRowPredicate(p("ne"), COLS), true)
    })

    it("unwraps a stats-blob value before comparing", () => {
        const cols = [
            col({
                name: "success",
                kind: "evaluator",
                value: {type: "binary", freq: [{value: true, density: 1}]},
            }),
        ]
        assert.equal(
            evaluateRowPredicate(
                {groupKind: "evaluator", columnName: "success", op: "eq", value: true},
                cols,
            ),
            true,
        )
    })
})

// =============================================================================
// evaluatePredicateGroup — flat AND / OR
// =============================================================================

describe("evaluatePredicateGroup", () => {
    const pass: RowPredicate = {
        groupKind: "evaluator",
        columnName: "success",
        op: "eq",
        value: true,
    }
    const fail: RowPredicate = {groupKind: "evaluator", columnName: "score", op: "gt", value: 999}

    it("AND — every condition must match", () => {
        assert.equal(evaluatePredicateGroup({op: "and", conditions: [pass, pass]}, COLS), true)
        assert.equal(evaluatePredicateGroup({op: "and", conditions: [pass, fail]}, COLS), false)
    })

    it("OR — at least one condition must match", () => {
        assert.equal(evaluatePredicateGroup({op: "or", conditions: [fail, pass]}, COLS), true)
        assert.equal(evaluatePredicateGroup({op: "or", conditions: [fail, fail]}, COLS), false)
    })

    it("an empty group is no constraint — passes for both ops", () => {
        assert.equal(evaluatePredicateGroup({op: "and", conditions: []}, COLS), true)
        assert.equal(evaluatePredicateGroup({op: "or", conditions: []}, COLS), true)
    })
})

// =============================================================================
// evaluateRowFilter — dispatch + isPredicateGroup
// =============================================================================

describe("evaluateRowFilter / isPredicateGroup", () => {
    it("isPredicateGroup distinguishes a group from a single predicate", () => {
        const single: RowPredicate = {
            groupKind: "evaluator",
            columnName: "success",
            op: "eq",
            value: true,
        }
        const group: PredicateGroup = {op: "and", conditions: [single]}
        assert.equal(isPredicateGroup(single), false)
        assert.equal(isPredicateGroup(group), true)
    })

    it("evaluates a single predicate or a group transparently", () => {
        const single: RowPredicate = {
            groupKind: "evaluator",
            columnName: "success",
            op: "eq",
            value: true,
        }
        assert.equal(evaluateRowFilter(single, COLS), true)
        assert.equal(evaluateRowFilter({op: "or", conditions: [single]}, COLS), true)
    })
})

// =============================================================================
// matchesRowFilter — resolve schema, then evaluate
// =============================================================================

const ANNOTATION_SCHEMA: RunSchema = {
    steps: [
        {key: "eval", type: "annotation", references: {evaluator: {id: "e1", slug: "exact-match"}}},
    ],
    mappings: [{column: {kind: "annotation", name: "success"}, step: {key: "eval", path: "out"}}],
}

function annotationRow(success: boolean): HydratedScenarioRow {
    return {
        scenario: {id: "s1", status: "success"},
        results: [],
        // resolveFromMetric only reads `m.data` — a minimal metric is enough.
        metrics: [{data: {eval: {out: success}}}] as unknown as HydratedScenarioRow["metrics"],
        testcase: null,
        traces: {},
    }
}

describe("matchesRowFilter", () => {
    it("resolves the run schema then evaluates the filter", () => {
        const filter: PredicateGroup = {
            op: "and",
            conditions: [{groupKind: "evaluator", columnName: "success", op: "eq", value: true}],
        }
        assert.equal(matchesRowFilter(filter, ANNOTATION_SCHEMA, annotationRow(true)), true)
        assert.equal(matchesRowFilter(filter, ANNOTATION_SCHEMA, annotationRow(false)), false)
    })
})

// =============================================================================
// makePredicateGroupFilter — pipeline transform
// =============================================================================

describe("makePredicateGroupFilter", () => {
    it("keeps only rows the filter matches", async () => {
        const transform = makePredicateGroupFilter({
            filter: {
                op: "or",
                conditions: [
                    {groupKind: "evaluator", columnName: "success", op: "eq", value: true},
                ],
            },
            schema: ANNOTATION_SCHEMA,
        })
        const chunk: Chunk<HydratedScenarioRow> = {
            items: [annotationRow(true), annotationRow(false), annotationRow(true)],
            cursor: null,
        }
        const out = await transform(chunk)
        assert.equal(out.items.length, 2)
    })
})

// =============================================================================
// predicateToEntitySlices — union across a group's conditions
// =============================================================================

const MIXED_SCHEMA: RunSchema = {
    steps: [
        {key: "in", type: "input", references: {testset: {id: "t1", slug: "ts"}}},
        {key: "ev", type: "annotation", references: {evaluator: {id: "e1", slug: "em"}}},
    ],
    mappings: [
        {column: {kind: "input", name: "question"}, step: {key: "in", path: "data.question"}},
        {column: {kind: "annotation", name: "success"}, step: {key: "ev", path: "out"}},
    ],
}

describe("predicateToEntitySlices — group input", () => {
    const testsetCond: RowPredicate = {
        groupKind: "testset",
        columnName: "question",
        op: "eq",
        value: "x",
    }
    const evaluatorCond: RowPredicate = {
        groupKind: "evaluator",
        columnName: "success",
        op: "eq",
        value: true,
    }

    it("takes the union of every condition's slices", () => {
        const group: PredicateGroup = {op: "and", conditions: [testsetCond, evaluatorCond]}
        const {slices} = predicateToEntitySlices(MIXED_SCHEMA, group)
        // testset → results + testcases; evaluator → results + metrics.
        assert.deepEqual([...slices].sort(), ["metrics", "results", "testcases"])
    })

    it("the boolean operator does not change the slice set", () => {
        const and = predicateToEntitySlices(MIXED_SCHEMA, {
            op: "and",
            conditions: [testsetCond, evaluatorCond],
        })
        const or = predicateToEntitySlices(MIXED_SCHEMA, {
            op: "or",
            conditions: [testsetCond, evaluatorCond],
        })
        assert.deepEqual([...and.slices].sort(), [...or.slices].sort())
    })

    it("an empty group needs no slices", () => {
        const {slices} = predicateToEntitySlices(MIXED_SCHEMA, {op: "and", conditions: []})
        assert.equal(slices.size, 0)
    })
})
