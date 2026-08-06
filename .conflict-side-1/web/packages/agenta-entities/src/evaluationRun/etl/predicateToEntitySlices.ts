/**
 * predicateToEntitySlices
 *
 * Given a run schema + active predicate(s), return the minimum set of
 * entity slices the hydrate stage needs to fetch in order to evaluate
 * the predicates. The downstream effect: predicate-driven hydrate skips
 * slices the predicate doesn't touch, cutting network for the common
 * filter case by ~50-75%.
 *
 * Mapping is derived from the same step.type → entity convention
 * `resolveMappings` uses on the read side:
 *
 *   testset      step.type = "input"       → reads from testcase
 *   application  step.type = "invocation"  → reads from trace (via result.trace_id)
 *   evaluator    step.type = "annotation"  → reads from result + metric
 *                                            (composeResolvers(metric, trace))
 *   metrics      (path is attributes.ag.metrics.*) → reads from metric
 *
 * Results are also fetched implicitly when any of testcase / trace / metric
 * are needed — testcase_id and trace_id live on result rows, not on the
 * scenario itself.
 *
 * @see resolveMappings.ts (the reverse-direction resolver — given a column
 *      shape, return the value from a hydrated row)
 */

import type {ColumnGroup, RunMapping, RunSchema, RunStep} from "./resolveMappings"
import {computeColumnGroup} from "./resolveMappings"
import type {PredicateGroup, RowPredicate} from "./rowPredicateFilter"
import {isPredicateGroup} from "./rowPredicateFilter"

export type EntitySlice = "results" | "metrics" | "testcases" | "traces"

const ALL_SLICES: readonly EntitySlice[] = ["results", "metrics", "testcases", "traces"] as const

export interface PredicateSliceResult {
    /** Which entity slices the predicate(s) actually need. */
    slices: Set<EntitySlice>
    /**
     * Which columns the predicate(s) match — for diagnostics + future
     * "narrowly fetch only this column" optimizations.
     */
    matchedColumns: {
        groupKind: ColumnGroup["kind"]
        groupSlug: string | null
        columnName: string
        sliceContributions: EntitySlice[]
    }[]
    /**
     * True if the resolver couldn't map a predicate's column back to a
     * step (e.g. column name doesn't appear in any mapping). When true,
     * caller should fall back to fetching all slices to stay correct —
     * over-fetching is safer than dropping a predicate silently.
     */
    fallbackToAll: boolean
}

/**
 * Compute the slice set for a single predicate against a run schema.
 * Returns `null` if the predicate references a column the schema doesn't
 * surface (signals "fall back to all slices" at the caller).
 */
function sliceForPredicate(schema: RunSchema, predicate: RowPredicate): EntitySlice[] | null {
    // 1. Find the mapping that matches this predicate's column.
    const stepByKey = new Map<string, RunStep>()
    for (const s of schema.steps) stepByKey.set(s.key, s)

    let matchedMapping: RunMapping | null = null
    let matchedGroup: ColumnGroup | null = null

    for (const m of schema.mappings) {
        const columnName = m.column?.name
        if (typeof columnName !== "string" || columnName !== predicate.columnName) continue
        const step = m.step?.key ? (stepByKey.get(m.step.key) ?? null) : null
        const group = computeColumnGroup(step, m.step?.path ?? "")
        if (group.kind !== predicate.groupKind) continue
        if (predicate.groupSlug != null && group.slug !== predicate.groupSlug) continue
        matchedMapping = m
        matchedGroup = group
        break
    }

    if (!matchedMapping || !matchedGroup) return null

    // 2. Map group → entity slices.
    //
    // results is the join graph's root for testcase + trace fetches:
    //   testcase_id lives on result rows, not scenarios
    //   trace_id lives on result rows
    // So any predicate that needs testcase or trace transitively needs results.

    const slices: EntitySlice[] = []
    switch (matchedGroup.kind) {
        case "testset":
            slices.push("results", "testcases")
            break
        case "application":
            // invocation step's value is span-resident — need trace.
            slices.push("results", "traces")
            break
        case "evaluator":
            // Annotation outputs live in metric.data — the metric writer
            // unfolds the evaluator's emitted attributes (incl.
            // `attributes.ag.data.outputs.*` AND `attributes.ag.metrics.*`)
            // as flat keys under `data[stepKey][path]`. composeResolvers
            // does (metric → trace), so trace is only used as a fallback
            // when an evaluator wrote span-only outputs that didn't make
            // it into metrics — a rare edge case.
            //
            // For predicate hydrate we trust metric is canonical. Skipping
            // traces here drops the heaviest endpoint (~70% of bytes,
            // ~60% of loop time on the 1000-scenario reference run) for
            // the common evaluator-filter case.
            //
            // If the predicate column ever turns out to be span-only
            // (evaluator didn't write to metric.data), the cell-side
            // materializer requests traces on first cell render, and the
            // predicate filter's "keep visible until known" fallback
            // keeps rows displayed during that lag. Correctness
            // preserved, performance recovered.
            slices.push("results", "metrics")
            break
        case "metrics":
            slices.push("metrics")
            break
        case "other":
            // Unknown shape — be conservative and fetch everything for this row.
            return null
    }
    return Array.from(new Set(slices))
}

/**
 * Resolve the full set of slices needed across all active predicates.
 *
 * Accepts a single predicate, a predicate array, or a `PredicateGroup`
 * (flat AND/OR — decision D8). For a group the slice set is the **union**
 * of every condition's slices: evaluating either an AND or an OR needs the
 * data behind every condition, so the boolean operator does not change the
 * fetch set.
 *
 * Empty predicate set = no filter active = no predicate-driven fetch
 * required. Caller decides what to do (fetch all for display, or wait
 * for cells to materialize themselves).
 */
export function predicateToEntitySlices(
    schema: RunSchema | null,
    predicates: RowPredicate | RowPredicate[] | PredicateGroup | null | undefined,
): PredicateSliceResult {
    if (!schema || !predicates) {
        return {slices: new Set(), matchedColumns: [], fallbackToAll: false}
    }
    const list: RowPredicate[] = Array.isArray(predicates)
        ? predicates
        : isPredicateGroup(predicates)
          ? predicates.conditions
          : [predicates]
    if (list.length === 0) {
        return {slices: new Set(), matchedColumns: [], fallbackToAll: false}
    }

    const acc = new Set<EntitySlice>()
    const matched: PredicateSliceResult["matchedColumns"] = []
    let fallback = false

    for (const p of list) {
        const slicesForP = sliceForPredicate(schema, p)
        if (slicesForP === null) {
            // Unresolvable column → over-fetch everything to stay correct.
            fallback = true
            for (const s of ALL_SLICES) acc.add(s)
            continue
        }
        for (const s of slicesForP) acc.add(s)
        matched.push({
            groupKind: p.groupKind,
            groupSlug: p.groupSlug ?? null,
            columnName: p.columnName,
            sliceContributions: slicesForP,
        })
    }

    return {slices: acc, matchedColumns: matched, fallbackToAll: fallback}
}
