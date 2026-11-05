import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

import {RunStatusTag} from "../overview/RunStatusTag"

import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioGroupCell} from "./ScenarioGroupCell"
import {ScenarioStepError} from "./states/ScenarioStepError"
import {ScenarioValuesError} from "./states/ScenarioValuesError"

/** The cells of one scenario in the table: its number, its status, then one cell per group. */
export const ScenarioTableRow = ({
    row,
    groups,
    onRetry,
}: {
    row: ScenarioRow
    groups: RunColumnGroup[]
    onRetry: () => void
}) => (
    <>
        <span className="text-sm tabular-nums text-muted-foreground">{row.index}</span>
        <span className="flex min-w-0 flex-col items-start gap-1">
            <RunStatusTag status={row.scenario.status ?? null} />
            {row.otherErrors.map((message, index) => (
                <ScenarioStepError key={index} message={message} />
            ))}
        </span>
        {groups.map(({group}) =>
            // A step's own error is known without its trace: it shows even when the trace failed.
            row.valuesFailed && group.kind !== "testset" && !row.errors[group.key] ? (
                <ScenarioValuesError key={group.key} onRetry={onRetry} />
            ) : (
                <ScenarioGroupCell
                    key={group.key}
                    cells={row.cells[group.key] ?? []}
                    error={row.errors[group.key]}
                />
            ),
        )}
    </>
)
