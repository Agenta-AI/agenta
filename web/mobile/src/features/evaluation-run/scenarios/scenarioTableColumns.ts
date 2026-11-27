import {
    INVOCATION_METRICS,
    metricKindOfValue,
    type MetricKind,
} from "@agenta/entities/evaluationRun"
import {type RunColumnGroup, unwrapStatsForCompare} from "@agenta/entities/evaluationRun/etl"
import {detectValueShape, type ValueShape} from "@agenta/shared/utils"

import {metricDisplayLabel} from "../metricLabel"

import type {ScenarioCell, ScenarioRow} from "./scenarioColumns"

/**
 * One column of the scenarios table after the lead columns (number, status, label):
 * - `field`: one value of the test case or of the app output;
 * - `evaluator`: one metric of one evaluator, under the evaluator's name;
 * - `metric`: an invocation metric of the app call (cost, duration, tokens, errors).
 */
export type ScenarioColumn = ScenarioFieldColumn | ScenarioEvaluatorColumn | ScenarioMetricColumn

export interface ScenarioFieldColumn {
    type: "field"
    key: string
    groupKey: string
    name: string
    /** The column name; null for the one output of an app, which the table calls "Output". */
    label: string | null
    section: "testcase" | "output"
    /** The shape of the first loaded value; null while no row has one. */
    shape: ValueShape | null
}

export interface ScenarioEvaluatorColumn {
    type: "evaluator"
    key: string
    groupKey: string
    name: string
    label: string
    /** From the run metric catalog, else from the first loaded value; null while none loaded. */
    metricKind: MetricKind | null
}

export interface ScenarioMetricColumn {
    type: "metric"
    key: string
    metricKey: string
    label: string
}

/** An evaluator and its metric columns: the two-level header draws its name over them. */
export interface ScenarioEvaluatorGroup {
    key: string
    label: string
    columns: ScenarioEvaluatorColumn[]
}

export interface ScenarioColumnModel {
    fields: ScenarioFieldColumn[]
    evaluators: ScenarioEvaluatorGroup[]
    metrics: ScenarioMetricColumn[]
}

/** The key of one value column of a group. */
export const valueColumnKey = (groupKey: string, name: string) => `${groupKey}::${name}`
/** The key of an invocation metric column. */
export const metricColumnKey = (metricKey: string) => `metric::${metricKey}`

/** The cell of a row for a field or evaluator column. */
export const cellOf = (
    row: ScenarioRow,
    column: {groupKey: string; name: string},
): ScenarioCell | undefined => row.cells[column.groupKey]?.find((cell) => cell.name === column.name)

/** A per-scenario metric holds a one-row stat blob: its flag or number, else the value. */
export const metricValueOf = (cell: ScenarioCell | undefined): unknown =>
    cell ? unwrapStatsForCompare(cell.value) : undefined

const isEmpty = (value: unknown) => value === undefined || value === null || value === ""

const firstValue = <T>(rows: readonly ScenarioRow[], read: (row: ScenarioRow) => T | undefined) => {
    for (const row of rows) {
        const value = read(row)
        if (!isEmpty(value)) return value
    }
    return undefined
}

/**
 * The columns of the table, from the run's column groups and the loaded rows. The rows name the
 * shape of each value column and the kind of each metric. The run's own metric mappings are left
 * out: the invocation metric columns stand for them, as in the old app.
 */
export function scenarioColumnModel(
    groups: readonly RunColumnGroup[],
    rows: readonly ScenarioRow[],
    labels: Record<string, string>,
): ScenarioColumnModel {
    const fields: ScenarioFieldColumn[] = []
    const evaluators: ScenarioEvaluatorGroup[] = []
    for (const {group, columns} of groups) {
        if (group.kind === "metrics") continue
        if (group.kind === "evaluator") {
            const groupLabel = labels[group.key] ?? group.label
            evaluators.push({
                key: group.key,
                label: groupLabel,
                columns: columns.map(({name}) => {
                    const column = {groupKey: group.key, name}
                    const kind = firstValue(rows, (row) => cellOf(row, column)?.metricKind) ?? null
                    const value = firstValue(rows, (row) => metricValueOf(cellOf(row, column)))
                    return {
                        type: "evaluator",
                        key: valueColumnKey(group.key, name),
                        groupKey: group.key,
                        name,
                        label: metricDisplayLabel(name, groupLabel),
                        metricKind: kind ?? (value === undefined ? null : metricKindOfValue(value)),
                    }
                }),
            })
            continue
        }
        const section = group.kind === "testset" ? "testcase" : "output"
        for (const {name} of columns) {
            const column = {groupKey: group.key, name}
            const value = firstValue(rows, (row) => cellOf(row, column)?.value)
            fields.push({
                type: "field",
                key: valueColumnKey(group.key, name),
                groupKey: group.key,
                name,
                label: section === "output" && columns.length === 1 ? null : name,
                section,
                shape: value === undefined ? null : detectValueShape(value).shape,
            })
        }
    }
    // The test case first, then the outputs, as the Columns menu lists them.
    fields.sort((a, b) => Number(a.section === "output") - Number(b.section === "output"))
    const metrics = INVOCATION_METRICS.map(({metricKey, label}) => ({
        type: "metric" as const,
        key: metricColumnKey(metricKey),
        metricKey,
        label,
    }))
    return {fields, evaluators, metrics}
}

/** Every column key of the model, in its natural order. */
export const columnKeysOf = (model: ScenarioColumnModel): string[] => [
    ...model.fields.map((column) => column.key),
    ...model.evaluators.flatMap((group) => group.columns.map((column) => column.key)),
    ...model.metrics.map((column) => column.key),
]

/** A value to order rows by: a number, a text, or null for no value (always last). */
export function sortValue(row: ScenarioRow, column: ScenarioColumn): number | string | null {
    let value: unknown
    if (column.type === "metric") {
        const stats = row.metrics[column.metricKey]
        value = stats?.mean ?? stats?.sum ?? null
    } else if (column.type === "evaluator") {
        value = metricValueOf(cellOf(row, column))
    } else {
        value = cellOf(row, column)?.value
    }
    if (isEmpty(value)) return null
    if (typeof value === "number") return value
    if (typeof value === "boolean") return value ? 1 : 0
    if (typeof value === "string") return value
    return JSON.stringify(value)
}

export type SortDirection = "ascending" | "descending"

const compareValues = (a: number | string, b: number | string) =>
    typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), undefined, {numeric: true})

/** The rows ordered by one column. Rows with no value stay last in both directions. */
export function sortScenarioRows<R extends ScenarioRow>(
    rows: readonly R[],
    column: ScenarioColumn,
    direction: SortDirection,
): R[] {
    const sign = direction === "ascending" ? 1 : -1
    return rows
        .map((row) => ({row, value: sortValue(row, column)}))
        .sort((a, b) => {
            if (a.value === null || b.value === null) {
                return Number(a.value === null) - Number(b.value === null)
            }
            return sign * compareValues(a.value, b.value)
        })
        .map(({row}) => row)
}

/** The loaded rows an evaluator failed: one of its true or false metrics is false. */
export const evaluatorFailures = (rows: readonly ScenarioRow[], group: ScenarioEvaluatorGroup) =>
    rows.filter((row) =>
        group.columns.some((column) => metricValueOf(cellOf(row, column)) === false),
    ).length

/**
 * One row of the table: a scenario of the base run (slot 0), or, while runs are compared, the
 * scenario of a compared run for the same test case. `row` is null when that run has none.
 */
export interface ScenarioEntry {
    key: string
    slot: number
    /** The run the row belongs to: the drawer opens on it. */
    runId: string
    runName: string
    row: ScenarioRow | null
    base: ScenarioRow
    pending: boolean
    failed: boolean
}
