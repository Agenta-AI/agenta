/**
 * filterSchema — derive the set of *filterable fields* for an evaluation
 * run from its schema (steps + mappings).
 *
 * The filter UI (Phase 2 / T4) needs to know, before any scenario data is
 * loaded: which columns can be filtered, what each one's value type is,
 * and which operators that type allows. This module produces exactly
 * that, keyed the same way `RowPredicate` targets a column
 * (groupKind + groupSlug + columnName), so a UI selection maps straight
 * onto a predicate.
 *
 * # Value typing
 *
 * The run schema does not carry per-column value types — those live in
 * evaluator output schemas / sampled values, which this module does not
 * fetch. So typing is best-effort:
 *
 *   - metrics columns        → "number" (cost / duration / tokens / scores)
 *   - everything else        → "unknown"
 *
 * "unknown" still gets a safe equality-oriented operator set. Callers that
 * *can* determine a precise type (e.g. T4 wiring with access to evaluator
 * output schemas, or by sampling resolved values) pass `resolveValueType`
 * to refine it — that is the intended extension seam, not an edit here.
 *
 * @packageDocumentation
 */

import {groupRunColumns, type ColumnGroup, type RunSchema} from "./resolveMappings"
import type {RowPredicate} from "./rowPredicateFilter"

/** Value type of a filterable field — drives the operator set. */
export type FilterValueType = "string" | "number" | "boolean" | "unknown"

/** All comparison operators a `RowPredicate` supports. */
export type FilterOperator = RowPredicate["op"]

/** A single field the user can filter on. */
export interface FilterableField {
    /** Targeting triple — maps directly onto `RowPredicate`. */
    groupKind: ColumnGroup["kind"]
    groupSlug: string | null
    columnName: string
    /** Display label for the field (the column name). */
    label: string
    /** Display label for the owning group (nested-header style). */
    groupLabel: string
    /** Best-effort value type — "unknown" when undeterminable from the schema. */
    valueType: FilterValueType
    /** Operators valid for this field's type. */
    operators: FilterOperator[]
}

export interface FilterSchema {
    fields: FilterableField[]
}

const OPERATORS_BY_TYPE: Record<FilterValueType, FilterOperator[]> = {
    number: ["eq", "ne", "lt", "lte", "gt", "gte", "in", "nin"],
    string: ["eq", "ne", "in", "nin"],
    boolean: ["eq", "ne"],
    // Undeterminable type — equality + membership are always safe; ordered
    // comparisons are not, so they are withheld until the type is known.
    unknown: ["eq", "ne", "in", "nin"],
}

/** The operator set valid for a given value type. */
export function operatorsForType(type: FilterValueType): FilterOperator[] {
    return [...OPERATORS_BY_TYPE[type]]
}

/** Schema-only default value type — metrics are numeric, the rest unknown. */
function defaultValueType(kind: ColumnGroup["kind"]): FilterValueType {
    return kind === "metrics" ? "number" : "unknown"
}

export interface BuildFilterSchemaOptions {
    /**
     * Refine a field's value type. Return `undefined` to keep the
     * schema-only default. This is the seam for type information that does
     * not live in the run schema — evaluator output schemas, sampled
     * resolved values, etc.
     */
    resolveValueType?: (field: {
        groupKind: ColumnGroup["kind"]
        groupSlug: string | null
        columnName: string
    }) => FilterValueType | undefined
}

/**
 * Build the filterable-field schema for a run. Fields appear in the same
 * group order the table renders columns (testset → application →
 * evaluator → metrics → other). Duplicate (groupKind, groupSlug,
 * columnName) triples are collapsed to one field.
 */
export function buildFilterSchema(
    schema: RunSchema | null,
    options: BuildFilterSchemaOptions = {},
): FilterSchema {
    if (!schema) return {fields: []}

    const groups = groupRunColumns(schema.steps, schema.mappings)
    const fields: FilterableField[] = []
    const seen = new Set<string>()

    for (const g of groups) {
        for (const leaf of g.columns) {
            const dedupKey = `${leaf.kind}::${leaf.groupSlug ?? ""}::${leaf.name}`
            if (seen.has(dedupKey)) continue
            seen.add(dedupKey)

            const hinted = options.resolveValueType?.({
                groupKind: leaf.kind,
                groupSlug: leaf.groupSlug,
                columnName: leaf.name,
            })
            const valueType = hinted ?? defaultValueType(leaf.kind)

            fields.push({
                groupKind: leaf.kind,
                groupSlug: leaf.groupSlug,
                columnName: leaf.name,
                label: leaf.name,
                groupLabel: g.group.label,
                valueType,
                operators: operatorsForType(valueType),
            })
        }
    }

    return {fields}
}
