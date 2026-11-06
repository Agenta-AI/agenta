import {useEffect, useMemo, useRef} from "react"

import {
    buildFilterSchema,
    evaluateRowFilter,
    FILTERABLE_COLUMN_KINDS,
    inferFilterValueType,
    isScenarioFilterActive,
    operatorsForType,
    SCENARIO_FILTER_FILL_TARGET,
    shouldReadMoreForFilter,
    toEffectiveFilter,
    type FilterableField,
    type RunColumnGroup,
    type RunSchema,
} from "@agenta/entities/evaluationRun/etl"
import {useAtomValue} from "jotai"

import type {ScenarioRow} from "./scenarioColumns"
import {scenarioFilterAtomFamily} from "./scenarioTableState"

/** A column the filter offers, with the name of its evaluator. */
export interface ScenarioFilterField extends FilterableField {
    /** Stable id: kind, slug and column name. */
    id: string
}

export const scenarioFilterFieldId = (field: {
    groupKind: string
    groupSlug?: string | null
    columnName: string
}) => `${field.groupKind}|${field.groupSlug ?? ""}|${field.columnName}`

const valuesOf = (rows: readonly ScenarioRow[], field: FilterableField) =>
    rows.map(
        (row) =>
            row.columns.find(
                (column) =>
                    column.group.kind === field.groupKind &&
                    (field.groupSlug == null || column.group.slug === field.groupSlug) &&
                    column.name === field.columnName,
            )?.value,
    )

/**
 * The scenario filter of a run: the columns it offers, and the rows that match it.
 *
 * The filter offers evaluator outputs and metrics, as in the old app. A column's type comes from
 * the values the loaded scenarios hold. While a filter is on, only matching rows show, plus rows
 * whose values did not load (they keep their retry). Too few matches make the table read the next
 * pages, until it has enough or no pages remain.
 */
export function useScenarioFilter({
    runId,
    schema,
    rows,
    columnGroups,
    labels,
    hasMore,
    busy,
    loadMore,
}: {
    runId: string
    schema: RunSchema
    rows: ScenarioRow[]
    columnGroups: RunColumnGroup[]
    labels: Record<string, string>
    hasMore: boolean
    busy: boolean
    loadMore: () => void
}) {
    const applied = useAtomValue(scenarioFilterAtomFamily(runId))
    const active = isScenarioFilterActive(applied)

    const fields = useMemo<ScenarioFilterField[]>(
        () =>
            buildFilterSchema(schema)
                .fields.filter((field) => FILTERABLE_COLUMN_KINDS.has(field.groupKind))
                .map((field) => {
                    const valueType = inferFilterValueType(valuesOf(rows, field)) ?? field.valueType
                    const group = columnGroups.find(
                        (entry) =>
                            entry.group.kind === field.groupKind &&
                            entry.group.slug === field.groupSlug,
                    )
                    return {
                        ...field,
                        id: scenarioFilterFieldId(field),
                        groupLabel: group
                            ? (labels[group.group.key] ?? field.groupLabel)
                            : field.groupLabel,
                        valueType,
                        operators: operatorsForType(valueType),
                    }
                }),
        [schema, rows, columnGroups, labels],
    )

    const shownRows = useMemo(() => {
        if (!active) return rows
        const filter = toEffectiveFilter(applied)
        return rows.filter((row) => row.valuesFailed || evaluateRowFilter(filter, row.columns))
    }, [rows, applied, active])

    const readMore = shouldReadMoreForFilter({active, matches: shownRows.length, hasMore, busy})
    const loadMoreRef = useRef(loadMore)
    loadMoreRef.current = loadMore
    // Each page that arrives without enough matches asks for the next one.
    const loaded = rows.length
    useEffect(() => {
        if (readMore) loadMoreRef.current()
    }, [readMore, loaded])

    /** True while the table still looks for matches in the pages it has not read. */
    const scanning = active && hasMore && shownRows.length < SCENARIO_FILTER_FILL_TARGET
    return {applied, active, fields, rows: shownRows, scanning}
}
