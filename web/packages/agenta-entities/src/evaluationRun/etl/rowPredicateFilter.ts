/**
 * Post-hydrate predicate filter — drops materialized rows that don't match
 * a value-equality predicate against a resolved UI column.
 *
 * # Where this fits
 *
 * The hydrate transform joins each scenario to its testcase, results,
 * metrics, and traces. THEN this filter runs. It works on already-joined
 * data, so it can predicate on values that don't exist on the scenario
 * itself (e.g. an evaluator's `success` output, a testset column,
 * `attributes.ag.metrics.tokens.cumulative.total`).
 *
 * The pipeline shape:
 *
 *   source → [cheap scenario-level filter] → hydrate → predicateFilter → sink
 *
 * The cheap filter goes first to avoid wasted hydration; this one comes
 * after because it needs the joined data.
 *
 * # Why this isn't server-side
 *
 * `/evaluations/scenarios/query` and `/evaluations/metrics/query` don't
 * currently accept arbitrary filtering — only ID lookups and run scope.
 * Filtering on annotation values (e.g. "evaluator output success == false")
 * therefore requires the hydrate join to materialize the value first.
 *
 * For a long-tail scan this is wasteful — we hydrate every scenario then
 * drop most of them. The eval-filtering RFC's "F1 skip-ahead" optimization
 * would let the server emit a sparse cursor stream that's already filtered,
 * but that's a server-side change not in today's API.
 *
 * # Stats-blob unwrap
 *
 * Some columns resolve to a stats blob (e.g. metric.data carries
 * `{type: "binary", freq: [{value: false, density: 1}]}` instead of a
 * literal `false`). This filter unwraps known stat shapes before comparing
 * so the caller writes `value: false` and gets the natural result.
 *
 * @packageDocumentation
 */

import type {Chunk, Transform} from "../../etl/core/types"

import type {HydratedScenarioRow, HydratableScenario} from "./hydrateScenariosTransform"
import {
    resolveMappings,
    type ColumnGroup,
    type ResolvedColumn,
    type RunSchema,
} from "./resolveMappings"

/**
 * One value-comparison clause against a single resolved column.
 *
 * Targeting rules:
 *   - `groupKind` always required — "annotation", "testset", "application", "metrics"
 *   - `groupSlug` optional — when set, narrows to a specific group instance
 *     (e.g. evaluator slug "exact-match"). If null/undefined, matches the
 *     first column whose name/kind match regardless of group instance.
 *   - `columnName` required — the column's display name (e.g. "success").
 *
 * Comparison rules:
 *   - "eq"/"ne" — strict-equality on the (unwrapped) value
 *   - "in"/"nin" — membership against an array
 *   - "lt"/"lte"/"gt"/"gte" — numeric comparison after unwrap
 */
export interface RowPredicate {
    groupKind: ColumnGroup["kind"]
    groupSlug?: string | null
    columnName: string
    op: "eq" | "ne" | "in" | "nin" | "lt" | "lte" | "gt" | "gte"
    value: unknown
}

/**
 * Unwrap known stats-blob shapes to their dominant value, so callers can
 * write `value: false` against an annotation column that resolves through
 * the metric layer as `{type: "binary", freq: [{value: false, density: 1}]}`.
 *
 * Cases handled:
 *   - `{type: "binary", freq: [{value, density}]}` → value with highest density
 *   - `{type: "numeric/continuous", mean: N}` → mean
 *   - `{type: "numeric", mean: N}` → mean
 *   - everything else passes through unchanged
 */
export function unwrapStatsForCompare(v: unknown): unknown {
    if (v === null || typeof v !== "object") return v
    const t = (v as {type?: string}).type
    if (t === "binary") {
        const freq = (v as {freq?: {value: unknown; density?: number; count?: number}[]}).freq
        if (Array.isArray(freq) && freq.length > 0) {
            // Take the entry with highest density (or count if density absent)
            const sorted = [...freq].sort((a, b) => {
                const ad = a.density ?? a.count ?? 0
                const bd = b.density ?? b.count ?? 0
                return bd - ad
            })
            return sorted[0]?.value
        }
        return undefined
    }
    if (t === "numeric/continuous" || t === "numeric") {
        const obj = v as {mean?: number; sum?: number; count?: number}
        return obj.mean ?? obj.sum ?? obj.count
    }
    return v
}

function compare(actual: unknown, op: RowPredicate["op"], expected: unknown): boolean {
    switch (op) {
        case "eq":
            return actual === expected
        case "ne":
            return actual !== expected
        case "in":
            return Array.isArray(expected) && expected.includes(actual)
        case "nin":
            return Array.isArray(expected) && !expected.includes(actual)
        case "lt":
            return typeof actual === "number" && typeof expected === "number" && actual < expected
        case "lte":
            return typeof actual === "number" && typeof expected === "number" && actual <= expected
        case "gt":
            return typeof actual === "number" && typeof expected === "number" && actual > expected
        case "gte":
            return typeof actual === "number" && typeof expected === "number" && actual >= expected
    }
}

export interface PredicateFilterOptions {
    /**
     * One or more predicates, AND-joined. Pass a single object for the
     * common case. All must match for the row to pass.
     */
    predicates: RowPredicate | RowPredicate[]
    /** Run schema (steps + mappings), used to resolve columns per row. */
    schema: RunSchema
    /**
     * Optional callback for per-chunk filter telemetry. Called once per
     * chunk with the in/out counts so the PoC can surface filter
     * effectiveness.
     */
    onChunkFiltered?: (info: {
        chunk: number
        scanned: number
        matched: number
        droppedPredicate: RowPredicate
    }) => void
}

/**
 * Build a `Transform<HydratedScenarioRow, HydratedScenarioRow>` that keeps
 * only rows satisfying every supplied predicate (logical AND).
 *
 * Stateless — the same factory output can be reused across pipeline runs.
 */
export function makeRowPredicateFilter<TScenario extends HydratableScenario>(
    options: PredicateFilterOptions,
): Transform<HydratedScenarioRow<TScenario>, HydratedScenarioRow<TScenario>> {
    const predicates = Array.isArray(options.predicates) ? options.predicates : [options.predicates]
    const schema = options.schema
    let chunkIdx = 0

    return async (chunk: Chunk<HydratedScenarioRow<TScenario>>) => {
        chunkIdx++
        const passing = chunk.items.filter((row) => {
            const cols = resolveMappings(row, schema)
            for (const p of predicates) {
                const target = cols.find((c) => {
                    if (c.group.kind !== p.groupKind) return false
                    if (p.groupSlug !== undefined && p.groupSlug !== null) {
                        if (c.group.slug !== p.groupSlug) return false
                    }
                    return c.name === p.columnName
                })
                if (!target) return false // missing column → fail predicate
                const unwrapped = unwrapStatsForCompare(target.value)
                if (!compare(unwrapped, p.op, p.value)) return false
            }
            return true
        })

        if (options.onChunkFiltered) {
            for (const p of predicates) {
                options.onChunkFiltered({
                    chunk: chunkIdx,
                    scanned: chunk.items.length,
                    matched: passing.length,
                    droppedPredicate: p,
                })
            }
        }

        return {...chunk, items: passing}
    }
}

// ============================================================================
// Multi-predicate AND/OR composition (Phase 2 / T4 — decision D8)
//
// `RowPredicate` above is a single clause. A `PredicateGroup` joins several
// clauses with ONE boolean operator. v1 is intentionally FLAT — `conditions`
// are leaf predicates, not nested groups. That covers the real cases
// ("score > 0.8 AND exact_match == true", "country in ['US','CA']") without
// an arbitrary-tree filter UI. Nested groups can come later if needed.
// ============================================================================

/**
 * A flat group of predicates joined by a single boolean operator.
 *
 * One nesting level only: `conditions` are leaf `RowPredicate`s.
 *
 * An **empty** group (`conditions: []`) is treated as *no constraint* —
 * every row passes, regardless of `op`. An empty filter shows all rows.
 */
export interface PredicateGroup {
    op: "and" | "or"
    conditions: RowPredicate[]
}

/** A filter is either a single predicate or a flat AND/OR group. */
export type RowFilter = RowPredicate | PredicateGroup

/** Narrow a `RowFilter` to a `PredicateGroup`. */
export function isPredicateGroup(filter: RowFilter): filter is PredicateGroup {
    return Array.isArray((filter as PredicateGroup).conditions)
}

/** Find the resolved column a predicate targets (by kind + optional slug + name). */
function findTargetColumn(
    cols: ResolvedColumn[],
    predicate: RowPredicate,
): ResolvedColumn | undefined {
    return cols.find((c) => {
        if (c.group.kind !== predicate.groupKind) return false
        if (predicate.groupSlug != null && c.group.slug !== predicate.groupSlug) return false
        return c.name === predicate.columnName
    })
}

/**
 * Evaluate one predicate against a row's already-resolved columns.
 *
 * A column the predicate references but the schema doesn't surface, or one
 * that resolved to no value, compares against `undefined` — same semantics
 * as `makeRowPredicateFilter` (so `eq`/`lt`/… fail, `ne` passes).
 *
 * This is *pure*: it does not know about hydration state. "Keep a row
 * visible until its slices are hydrated" is a wiring-layer concern — the
 * caller decides that before calling this.
 */
export function evaluateRowPredicate(predicate: RowPredicate, cols: ResolvedColumn[]): boolean {
    const target = findTargetColumn(cols, predicate)
    const actual = unwrapStatsForCompare(target?.value)
    return compare(actual, predicate.op, predicate.value)
}

/**
 * Evaluate a flat AND/OR group against a row's resolved columns.
 *
 * - `op: "and"` — every condition must match.
 * - `op: "or"`  — at least one condition must match.
 * - empty `conditions` — no constraint, the row passes.
 */
export function evaluatePredicateGroup(group: PredicateGroup, cols: ResolvedColumn[]): boolean {
    if (group.conditions.length === 0) return true
    return group.op === "and"
        ? group.conditions.every((p) => evaluateRowPredicate(p, cols))
        : group.conditions.some((p) => evaluateRowPredicate(p, cols))
}

/** Evaluate any `RowFilter` (single predicate or AND/OR group) against resolved columns. */
export function evaluateRowFilter(filter: RowFilter, cols: ResolvedColumn[]): boolean {
    return isPredicateGroup(filter)
        ? evaluatePredicateGroup(filter, cols)
        : evaluateRowPredicate(filter, cols)
}

/**
 * Convenience: resolve a hydrated row's columns from the run schema, then
 * evaluate the filter. This is the row-level entry point the scenario
 * table's `filteredRows` derivation uses.
 */
export function matchesRowFilter<TScenario extends HydratableScenario>(
    filter: RowFilter,
    schema: RunSchema,
    row: HydratedScenarioRow<TScenario>,
): boolean {
    return evaluateRowFilter(filter, resolveMappings(row, schema))
}

export interface PredicateGroupFilterOptions {
    /** The active filter — a single predicate or a flat AND/OR group. */
    filter: RowFilter
    /** Run schema (steps + mappings), used to resolve columns per row. */
    schema: RunSchema
    /** Optional per-chunk telemetry callback. */
    onChunkFiltered?: (info: {chunk: number; scanned: number; matched: number}) => void
}

/**
 * Build a `Transform` that keeps only rows satisfying a `RowFilter`
 * (single predicate or AND/OR group). The ETL-pipeline counterpart of the
 * row-level `matchesRowFilter` — use this for headless / chunked runs.
 */
export function makePredicateGroupFilter<TScenario extends HydratableScenario>(
    options: PredicateGroupFilterOptions,
): Transform<HydratedScenarioRow<TScenario>, HydratedScenarioRow<TScenario>> {
    const {filter, schema} = options
    let chunkIdx = 0

    return async (chunk: Chunk<HydratedScenarioRow<TScenario>>) => {
        chunkIdx++
        const passing = chunk.items.filter((row) =>
            evaluateRowFilter(filter, resolveMappings(row, schema)),
        )
        options.onChunkFiltered?.({
            chunk: chunkIdx,
            scanned: chunk.items.length,
            matched: passing.length,
        })
        return {...chunk, items: passing}
    }
}
