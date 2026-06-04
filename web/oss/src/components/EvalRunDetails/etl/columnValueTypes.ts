/**
 * columnValueTypes — resolves a filterable column's value type from the
 * evaluator output schema.
 *
 * The run graph does not carry column value types. The authoritative
 * source is the evaluator's JSON output schema: `extractMetrics`
 * (entities) reads each output property's `schema.type` into
 * `MetricColumnDefinition.metricType`, and the backend-metadata column
 * builder copies that onto every annotation column as
 * `EvaluationTableColumn.metricType`.
 *
 * This module turns that `metricType` into the `FilterValueType` the
 * filter bar uses, so a boolean evaluator output (e.g. an LLM-judge
 * `success` field) is offered only equality operators and a true/false
 * input — never the numeric comparators.
 */

import type {FilterValueType} from "@agenta/entities/evaluationRun/etl"

import type {EvaluationTableColumnsResult} from "../atoms/table"

/** Map a JSON-schema-derived `metricType` to a filter value type. */
function metricTypeToValueType(metricType: string | undefined): FilterValueType | undefined {
    if (!metricType) return undefined
    switch (metricType.toLowerCase()) {
        case "boolean":
        case "bool":
            return "boolean"
        case "number":
        case "integer":
        case "float":
            return "number"
        case "string":
            return "string"
        default:
            // array / object / anything else — no safe operator set.
            return "unknown"
    }
}

export interface ColumnValueTypeField {
    groupKind: string
    groupSlug: string | null
    columnName: string
}

/**
 * Build a `resolveValueType` callback for `buildFilterSchema`, sourced
 * from the evaluator output schemas (via `columnResult` column
 * `metricType`). Returns `undefined` for a column with no known type so
 * `buildFilterSchema` falls back to its schema-only default.
 */
export function buildColumnValueTypeResolver(
    columnResult: EvaluationTableColumnsResult | undefined,
): (field: ColumnValueTypeField) => FilterValueType | undefined {
    // Keyed by `<evaluatorSlug>::<columnName>` (disambiguates two
    // evaluators with same-named outputs) and by column name alone.
    const bySlugName = new Map<string, string>()
    const byName = new Map<string, string>()

    for (const col of columnResult?.columns ?? []) {
        const metricType = col.metricType
        const name = col.label
        if (!metricType || typeof name !== "string" || !name) continue
        byName.set(name, metricType)
        if (col.evaluatorSlug) bySlugName.set(`${col.evaluatorSlug}::${name}`, metricType)
    }

    return (field) => {
        const metricType =
            (field.groupSlug
                ? bySlugName.get(`${field.groupSlug}::${field.columnName}`)
                : undefined) ?? byName.get(field.columnName)
        return metricTypeToValueType(metricType)
    }
}
