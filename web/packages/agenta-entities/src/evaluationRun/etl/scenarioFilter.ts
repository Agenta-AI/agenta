/**
 * The scenario table filter: which conditions count, which columns can be filtered, what type a
 * column holds, how typed text becomes a condition value, and when the table must read more pages
 * to find matches.
 *
 * Copied from the old app (web/oss `EvalRunDetails/etl/scenarioFilterState.ts`,
 * `ScenarioFilterBar.tsx`, `useScenarioFilter.ts`) as pure functions.
 *
 * @packageDocumentation
 */

import type {FilterOperator, FilterValueType} from "./filterSchema"
import type {ColumnGroup} from "./resolveMappings"
import {unwrapStatsForCompare, type PredicateGroup, type RowPredicate} from "./rowPredicateFilter"

/** No condition: every scenario shows. */
export const EMPTY_SCENARIO_FILTER: PredicateGroup = {op: "and", conditions: []}

/**
 * The column kinds the filter offers: evaluator outputs and metrics. The old app withholds test
 * set and application columns too.
 */
export const FILTERABLE_COLUMN_KINDS: ReadonlySet<ColumnGroup["kind"]> = new Set([
    "evaluator",
    "metrics",
])

/** While a filter is on, the table reads pages until it has this many matches or no pages remain. */
export const SCENARIO_FILTER_FILL_TARGET = 30

/** A condition counts once it names a column and has a value (a list needs one entry). */
export function isConditionComplete(condition: RowPredicate): boolean {
    if (!condition.columnName) return false
    if (Array.isArray(condition.value)) return condition.value.length > 0
    return condition.value !== undefined && condition.value !== ""
}

/** The filter as it is applied: conditions that are not complete are left out. */
export function toEffectiveFilter(group: PredicateGroup): PredicateGroup {
    return {op: group.op, conditions: group.conditions.filter(isConditionComplete)}
}

/** True when at least one condition is complete. */
export function isScenarioFilterActive(group: PredicateGroup): boolean {
    return group.conditions.some(isConditionComplete)
}

/** True for the operators whose value is a list. */
export const isListOperator = (op: FilterOperator) => op === "in" || op === "nin"

/**
 * The type of a column from the values the loaded scenarios hold for it (stat blobs read as their
 * main value). One type for every value gives that type; no value, or mixed types, give undefined.
 */
export function inferFilterValueType(values: readonly unknown[]): FilterValueType | undefined {
    const types = new Set<FilterValueType>()
    for (const raw of values) {
        const value = unwrapStatsForCompare(raw)
        if (value === undefined || value === null || value === "") continue
        if (typeof value === "boolean") types.add("boolean")
        else if (typeof value === "number") types.add("number")
        else if (typeof value === "string") types.add("string")
        else types.add("unknown")
    }
    return types.size === 1 ? [...types][0] : undefined
}

/**
 * A condition value from what the user typed. A number column takes numbers only (other text
 * gives an empty value, so the condition is not complete yet). A list operator splits the text on
 * commas.
 */
export function filterValueFromText(
    text: string,
    valueType: FilterValueType,
    op: FilterOperator,
): unknown {
    const one = (part: string): unknown => {
        const trimmed = part.trim()
        if (valueType === "number") {
            const number = trimmed === "" ? Number.NaN : Number(trimmed)
            return Number.isFinite(number) ? number : ""
        }
        if (valueType === "boolean") {
            if (trimmed === "true") return true
            if (trimmed === "false") return false
            return ""
        }
        return trimmed
    }
    if (!isListOperator(op)) return one(text)
    return text
        .split(",")
        .map(one)
        .filter((value) => value !== "")
}

/** The text an input shows for a condition value. */
export function filterValueToText(value: unknown): string {
    if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ")
    if (value === undefined || value === null) return ""
    return String(value)
}

/**
 * True when the table should read the next page to find more matches: a filter is on, fewer than
 * {@link SCENARIO_FILTER_FILL_TARGET} scenarios match, more pages exist and no read is running.
 */
export function shouldReadMoreForFilter({
    active,
    matches,
    hasMore,
    busy,
}: {
    active: boolean
    matches: number
    hasMore: boolean
    busy: boolean
}): boolean {
    return active && hasMore && !busy && matches < SCENARIO_FILTER_FILL_TARGET
}
