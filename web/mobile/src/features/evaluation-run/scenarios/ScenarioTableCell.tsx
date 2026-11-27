import {metricCellText} from "@agenta/entities/evaluationRun"
import {ValueCell} from "@agenta/ui/cell-renderers"

import type {ScenarioRow} from "./scenarioColumns"
import {cellOf, metricValueOf, type ScenarioColumn} from "./scenarioTableColumns"
import type {ScenarioDensity} from "./scenarioViewDefaults"
import {ScenarioValuesError} from "./states/ScenarioValuesError"

/**
 * One value of a scenario in the table, drawn by its shape or its metric kind, never taller than
 * the row. A failed step shows an "Error" badge with its message in the title; a row whose values
 * did not load says so in the one cell given `onRetry`; its other trace cells stay empty. The
 * full value opens in the drawer, never in the cell.
 */
export const ScenarioTableCell = ({
    row,
    column,
    density,
    lines,
    onRetry,
}: {
    row: ScenarioRow
    column: ScenarioColumn
    density: ScenarioDensity
    lines: 1 | 3
    /** Only the row's first trace column: one error line and one "Try again" per row. */
    onRetry?: () => void
}) => {
    if (column.type === "metric") {
        const text = metricCellText(column.metricKey, row.metrics[column.metricKey])
        return (
            <span className="ml-auto truncate tabular-nums">
                {text === "—" ? <span className="text-muted-foreground">{text}</span> : text}
            </span>
        )
    }
    const error = row.errors[column.groupKey]
    // A step's own error is known without its trace: it shows even when the trace failed.
    if (error) {
        return (
            <span title={error} className="flex min-w-0">
                <ValueCell value={null} state="error" density={density} />
            </span>
        )
    }
    // The test case values do not come from a trace, so they show when the traces failed.
    const fromTrace = column.type === "evaluator" || column.section === "output"
    if (row.valuesFailed && fromTrace) {
        return onRetry ? <ScenarioValuesError onRetry={onRetry} /> : null
    }
    const cell = cellOf(row, column)
    if (column.type === "evaluator") {
        return (
            <ValueCell
                value={metricValueOf(cell)}
                metricKind={cell?.metricKind ?? column.metricKind ?? undefined}
                binaryWords={column.human ? "trueFalse" : "passFail"}
                density={density}
                lines={lines}
            />
        )
    }
    return <ValueCell value={cell?.value} density={density} lines={lines} />
}
