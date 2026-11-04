import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

import {RunStatusTag} from "../overview/RunStatusTag"

import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioGroupCell} from "./ScenarioGroupCell"
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
        <span>
            <RunStatusTag status={row.scenario.status ?? null} />
        </span>
        {groups.map(({group}) =>
            row.valuesFailed && group.kind !== "testset" ? (
                <ScenarioValuesError key={group.key} onRetry={onRetry} />
            ) : (
                <ScenarioGroupCell key={group.key} cells={row.cells[group.key] ?? []} />
            ),
        )}
    </>
)
