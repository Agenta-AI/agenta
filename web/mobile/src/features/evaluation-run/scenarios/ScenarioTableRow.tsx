import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

import {RunStatusTag} from "../overview/RunStatusTag"

import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioGroupCell} from "./ScenarioGroupCell"

/** The cells of one scenario in the table: its number, its status, then one cell per group. */
export const ScenarioTableRow = ({row, groups}: {row: ScenarioRow; groups: RunColumnGroup[]}) => (
    <>
        <span className="text-sm tabular-nums text-muted-foreground">{row.index}</span>
        <span>
            <RunStatusTag status={row.scenario.status ?? null} />
        </span>
        {groups.map(({group}) => (
            <ScenarioGroupCell key={group.key} cells={row.cells[group.key] ?? []} />
        ))}
    </>
)
