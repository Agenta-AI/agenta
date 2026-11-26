import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioMetricText} from "./ScenarioMetricText"
import type {ScenarioTableCell} from "./scenarioTableColumns"
import {ScenarioStepError} from "./states/ScenarioStepError"
import {ScenarioValuesError} from "./states/ScenarioValuesError"

/**
 * One metric of one evaluator for a scenario. A failed evaluator shows its error in each of its
 * columns; a scenario whose values did not load shows the retry.
 */
export const ScenarioEvaluatorCell = ({
    row,
    cell,
    onRetry,
}: {
    row: ScenarioRow
    cell: Extract<ScenarioTableCell, {type: "evaluator"}>
    onRetry: () => void
}) => {
    const groupKey = cell.group.group.key
    const error = row.errors[groupKey]
    if (error) return <ScenarioStepError message={error} />
    if (row.valuesFailed) return <ScenarioValuesError onRetry={onRetry} />
    const value = row.cells[groupKey]?.find((entry) => entry.name === cell.name)
    return <ScenarioMetricText metricKey={value?.path ?? cell.name} value={value?.value} />
}
