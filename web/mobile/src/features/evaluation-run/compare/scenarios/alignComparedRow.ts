import {matchCompareGroupKey} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

import type {ScenarioRow} from "../../scenarios/scenarioColumns"

/**
 * A compared run's row with its values and errors keyed by the base run's column groups, so it
 * draws in the base run's columns. A group the compared run does not have stays empty.
 */
export function alignComparedRow(
    row: ScenarioRow,
    baseGroups: readonly RunColumnGroup[],
    groups: readonly RunColumnGroup[],
): ScenarioRow {
    const own = groups.map(({group}) => group)
    const cells: ScenarioRow["cells"] = {}
    const errors: ScenarioRow["errors"] = {}
    for (const {group} of baseGroups) {
        const key = matchCompareGroupKey(group, own)
        if (!key) continue
        if (row.cells[key]) cells[group.key] = row.cells[key]
        if (row.errors[key]) errors[group.key] = row.errors[key]
    }
    return {...row, cells, errors}
}
