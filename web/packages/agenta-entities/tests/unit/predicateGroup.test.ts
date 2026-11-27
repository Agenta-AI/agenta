/**
 * Multi-predicate AND/OR filtering (Phase 2 / T4 — decision D8).
 *
 * Covers the pure predicate-evaluation core: single predicate, flat AND/OR
 * groups, and the `RowFilter` dispatch.
 */

import {describe, expect, it} from "vitest"

import type {ColumnGroup, ResolvedColumn} from "../../src/evaluationRun/etl/resolveMappings"
import {
    evaluatePredicateGroup,
    evaluateRowFilter,
    evaluateRowPredicate,
    isPredicateGroup,
    type PredicateGroup,
    type RowPredicate,
} from "../../src/evaluationRun/etl/rowPredicateFilter"

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
        expect(
            evaluateRowPredicate(
                {groupKind: "evaluator", columnName: "success", op: "eq", value: true},
                COLS,
            ),
        ).toBe(true)
        expect(
            evaluateRowPredicate(
                {groupKind: "evaluator", columnName: "success", op: "ne", value: true},
                COLS,
            ),
        ).toBe(false)
    })

    it("numeric comparisons", () => {
        const p = (op: RowPredicate["op"], value: number): RowPredicate => ({
            groupKind: "evaluator",
            columnName: "score",
            op,
            value,
        })
        expect(evaluateRowPredicate(p("gt", 0.8), COLS)).toBe(true)
        expect(evaluateRowPredicate(p("gte", 0.9), COLS)).toBe(true)
        expect(evaluateRowPredicate(p("lt", 0.8), COLS)).toBe(false)
        expect(evaluateRowPredicate(p("lte", 0.9), COLS)).toBe(true)
    })

    it("in / nin", () => {
        expect(
            evaluateRowPredicate(
                {groupKind: "testset", columnName: "country", op: "in", value: ["US", "CA"]},
                COLS,
            ),
        ).toBe(true)
        expect(
            evaluateRowPredicate(
                {groupKind: "testset", columnName: "country", op: "nin", value: ["US", "CA"]},
                COLS,
            ),
        ).toBe(false)
    })

    it("narrows by groupSlug when set", () => {
        // Same column name across two evaluators — slug disambiguates.
        const cols = [
            col({name: "success", kind: "evaluator", slug: "a", value: true}),
            col({name: "success", kind: "evaluator", slug: "b", value: false}),
        ]
        expect(
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
        ).toBe(true)
    })

    it("a missing column fails eq but passes ne (compares against undefined)", () => {
        const p = (op: RowPredicate["op"]): RowPredicate => ({
            groupKind: "evaluator",
            columnName: "does-not-exist",
            op,
            value: true,
        })
        expect(evaluateRowPredicate(p("eq"), COLS)).toBe(false)
        expect(evaluateRowPredicate(p("ne"), COLS)).toBe(true)
    })

    it("unwraps a stats-blob value before comparing", () => {
        const cols = [
            col({
                name: "success",
                kind: "evaluator",
                value: {type: "binary", freq: [{value: true, density: 1}]},
            }),
        ]
        expect(
            evaluateRowPredicate(
                {groupKind: "evaluator", columnName: "success", op: "eq", value: true},
                cols,
            ),
        ).toBe(true)
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
        expect(evaluatePredicateGroup({op: "and", conditions: [pass, pass]}, COLS)).toBe(true)
        expect(evaluatePredicateGroup({op: "and", conditions: [pass, fail]}, COLS)).toBe(false)
    })

    it("OR — at least one condition must match", () => {
        expect(evaluatePredicateGroup({op: "or", conditions: [fail, pass]}, COLS)).toBe(true)
        expect(evaluatePredicateGroup({op: "or", conditions: [fail, fail]}, COLS)).toBe(false)
    })

    it("an empty group is no constraint — passes for both ops", () => {
        expect(evaluatePredicateGroup({op: "and", conditions: []}, COLS)).toBe(true)
        expect(evaluatePredicateGroup({op: "or", conditions: []}, COLS)).toBe(true)
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
        expect(isPredicateGroup(single)).toBe(false)
        expect(isPredicateGroup(group)).toBe(true)
    })

    it("evaluates a single predicate or a group transparently", () => {
        const single: RowPredicate = {
            groupKind: "evaluator",
            columnName: "success",
            op: "eq",
            value: true,
        }
        expect(evaluateRowFilter(single, COLS)).toBe(true)
        expect(evaluateRowFilter({op: "or", conditions: [single]}, COLS)).toBe(true)
    })
})
