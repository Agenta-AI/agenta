/**
 * Scenario table filter state — the active multi-predicate filter
 * (decision D8: flat AND/OR), one per run.
 *
 * The atom holds the *raw* filter the filter bar edits — it may contain
 * half-built conditions (a column picked but no value yet). Evaluation
 * uses `toEffectiveFilter`, which drops the incomplete ones, so a
 * partially-typed condition never filters every row out.
 */

import type {PredicateGroup, RowPredicate} from "@agenta/entities/evaluationRun/etl"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

const EMPTY_FILTER: PredicateGroup = {op: "and", conditions: []}

/** Per-run active scenario filter (raw — may contain half-built conditions). */
export const scenarioFilterAtomFamily = atomFamily((_runId: string) =>
    atom<PredicateGroup>(EMPTY_FILTER),
)

/** A condition is complete once it has a column and a defined, non-empty value. */
export const isConditionComplete = (c: RowPredicate): boolean => {
    if (!c.columnName) return false
    // `in` / `nin` values are arrays — complete once non-empty.
    if (Array.isArray(c.value)) return c.value.length > 0
    return c.value !== undefined && c.value !== ""
}

/**
 * The filter actually evaluated — half-built conditions dropped. Returns
 * the same `op` with only complete conditions.
 */
export const toEffectiveFilter = (group: PredicateGroup): PredicateGroup => ({
    op: group.op,
    conditions: group.conditions.filter(isConditionComplete),
})

/** True when at least one complete condition is set. */
export const isScenarioFilterActive = (group: PredicateGroup): boolean =>
    group.conditions.some(isConditionComplete)

/** Live scan status — written by the scenarios table, read by the filter bar. */
export interface ScenarioFilterStatus {
    /** Confirmed matches found so far. */
    matchCount: number
    /** True while the filter scan is actively working. */
    scanning: boolean
}

const EMPTY_STATUS: ScenarioFilterStatus = {matchCount: 0, scanning: false}

/**
 * Per-run filter scan status. The scenarios table runs the scan and
 * writes this; the filter bar — which lives in the run header, a separate
 * part of the component tree — reads it for its match-count indicator.
 */
export const scenarioFilterStatusAtomFamily = atomFamily((_runId: string) =>
    atom<ScenarioFilterStatus>(EMPTY_STATUS),
)
