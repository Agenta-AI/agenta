import type {ReactNode} from "react"

import {RunStatusTag} from "../overview/RunStatusTag"

import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioEvaluatorCell} from "./ScenarioEvaluatorCell"
import {ScenarioGroupCell} from "./ScenarioGroupCell"
import {ScenarioMetricText} from "./ScenarioMetricText"
import type {ScenarioTableCell} from "./scenarioTableColumns"
import {ScenarioStepError} from "./states/ScenarioStepError"
import {ScenarioValuesError} from "./states/ScenarioValuesError"

/**
 * The cells of one scenario in the table: its number, its run (while runs are compared), its
 * status, the row action (on a human run), then one cell per shown column.
 */
export const ScenarioTableRow = ({
    row,
    cells,
    run,
    action,
    onRetry,
}: {
    row: ScenarioRow
    cells: ScenarioTableCell[]
    run?: ReactNode
    action?: ReactNode
    onRetry: () => void
}) => (
    <>
        <span className="text-sm tabular-nums text-muted-foreground">{row.index}</span>
        {run}
        <span className="flex min-w-0 flex-col items-start gap-1">
            <RunStatusTag status={row.scenario.status ?? null} />
            {row.otherErrors.map((message, index) => (
                <ScenarioStepError key={index} message={message} />
            ))}
        </span>
        {action}
        {cells.map((cell) => {
            if (cell.type === "metric") {
                return (
                    <ScenarioMetricText
                        key={cell.key}
                        metricKey={cell.metricKey}
                        value={row.metrics[cell.metricKey]}
                    />
                )
            }
            if (cell.type === "evaluator") {
                return (
                    <ScenarioEvaluatorCell key={cell.key} row={row} cell={cell} onRetry={onRetry} />
                )
            }
            const {group} = cell.group
            // A step's own error is known without its trace: it shows even when the trace failed.
            if (row.valuesFailed && group.kind !== "testset" && !row.errors[group.key]) {
                return <ScenarioValuesError key={cell.key} onRetry={onRetry} />
            }
            return (
                <ScenarioGroupCell
                    key={cell.key}
                    cells={(row.cells[group.key] ?? []).filter((entry) =>
                        cell.names.has(entry.name),
                    )}
                    error={row.errors[group.key]}
                />
            )
        })}
    </>
)
