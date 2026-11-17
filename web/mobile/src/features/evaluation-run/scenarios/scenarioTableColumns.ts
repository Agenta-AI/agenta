import {INVOCATION_METRICS} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

/**
 * One column of the scenarios table after the first ones (number, status, actions):
 * - `group`: a test set or an app, its values stacked in one cell;
 * - `evaluator`: one metric of one evaluator, as in the old app;
 * - `metric`: an invocation metric (cost, duration, tokens, errors).
 */
export type ScenarioTableCell =
    | {type: "group"; key: string; group: RunColumnGroup; names: ReadonlySet<string>}
    | {type: "evaluator"; key: string; group: RunColumnGroup; name: string}
    | {type: "metric"; key: string; metricKey: string; label: string}

/** A group in the column settings, with the columns it can show or hide. */
export interface ScenarioColumnOption {
    key: string
    label: string
    columns: {key: string; label: string}[]
}

/** The key of one value column of a group. */
export const valueColumnKey = (groupKey: string, name: string) => `${groupKey}::${name}`
/** The key of an invocation metric column. */
export const metricColumnKey = (metricKey: string) => `metric::${metricKey}`

const METRICS_OPTION_KEY = "invocation-metrics"

/** Narrowest width of each kind of column, in px. */
export const COLUMN_MIN_WIDTH = {group: 220, evaluator: 130, metric: 90} as const

/**
 * The groups the table shows. The run's own metric mappings are left out: the invocation metric
 * columns stand for them, as in the old app.
 */
const tableGroups = (groups: readonly RunColumnGroup[]) =>
    groups.filter(({group}) => group.kind !== "metrics")

/** The column settings: every group with its value columns, then the invocation metrics. */
export function scenarioColumnOptions(
    groups: readonly RunColumnGroup[],
    labels: Record<string, string>,
): ScenarioColumnOption[] {
    return [
        ...tableGroups(groups).map(({group, columns}) => ({
            key: group.key,
            label: labels[group.key] ?? group.label,
            columns: columns.map((column) => ({
                key: valueColumnKey(group.key, column.name),
                label: column.name,
            })),
        })),
        {
            key: METRICS_OPTION_KEY,
            label: "Metrics",
            columns: INVOCATION_METRICS.map(({metricKey, label}) => ({
                key: metricColumnKey(metricKey),
                label,
            })),
        },
    ]
}

/** The value columns of the table, in order, without the hidden ones. */
export function scenarioTableCells(
    groups: readonly RunColumnGroup[],
    hidden: ReadonlySet<string>,
): ScenarioTableCell[] {
    const shown = (key: string) => !hidden.has(key)
    const cells: ScenarioTableCell[] = []
    for (const entry of tableGroups(groups)) {
        const {group, columns} = entry
        const names = columns
            .map((column) => column.name)
            .filter((name) => shown(valueColumnKey(group.key, name)))
        if (group.kind === "evaluator") {
            for (const name of names) {
                cells.push({
                    type: "evaluator",
                    key: valueColumnKey(group.key, name),
                    group: entry,
                    name,
                })
            }
        } else if (names.length > 0) {
            cells.push({type: "group", key: group.key, group: entry, names: new Set(names)})
        }
    }
    for (const {metricKey, label} of INVOCATION_METRICS) {
        const key = metricColumnKey(metricKey)
        if (shown(key)) cells.push({type: "metric", key, metricKey, label})
    }
    return cells
}
